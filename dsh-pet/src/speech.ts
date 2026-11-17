import { hostCall, log } from '@jieapi/plugin-sdk';
import type { PetSettings, SpeechAudio, TtsSettings } from './shared/settings';

/**
 * 台词朗读的音频合成。
 *
 * 必须在插件进程内直接发请求：host.http.request 会把响应体按 UTF-8 解码成字符串，
 * 音频二进制会被破坏，而且响应上限只有 1 MiB。插件进程与 Bash 同级，可用 Node 的 https。
 */

const SECRET_KEY = 'tts.apiKey';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_OPENAI_VOICE = 'alloy';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-preview-tts';
const DEFAULT_GEMINI_VOICE = 'Kore';
/** 合成文本上限：音频按 base64 传回浮层，宿主单行上限 4 MiB。 */
const MAX_TTS_CHARS = 300;
const REQUEST_TIMEOUT_MS = 30_000;

interface TtsRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function baseUrlOf(tts: TtsSettings): string {
  if (tts.baseUrl) return trimSlash(tts.baseUrl);
  return tts.provider === 'gemini' ? DEFAULT_GEMINI_BASE : DEFAULT_OPENAI_BASE;
}

async function readKey(): Promise<string> {
  try {
    const result = await hostCall<{ value?: unknown }>('host.secrets.get', { key: SECRET_KEY });
    return typeof result?.value === 'string' ? result.value : '';
  } catch {
    return '';
  }
}

export async function ttsKeyPresent(): Promise<boolean> {
  return Boolean(await readKey());
}

export async function saveTtsKey(key: string): Promise<void> {
  const value = key.trim();
  if (!value) {
    await hostCall('host.secrets.delete', { key: SECRET_KEY }).catch(() => {});
    return;
  }
  await hostCall('host.secrets.set', { key: SECRET_KEY, value });
}

/** 生成与供应商对应的请求；Gemini 的接口形状与 OpenAI 差异较大，单独拼。 */
function buildRequest(tts: TtsSettings, apiKey: string, text: string): TtsRequest {
  const speed = Math.min(2, Math.max(0.5, tts.speed));
  if (tts.provider === 'gemini') {
    const model = tts.model || DEFAULT_GEMINI_MODEL;
    const voice = tts.voice || DEFAULT_GEMINI_VOICE;
    return {
      url: `${baseUrlOf(tts)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
        }
      })
    };
  }
  const model = tts.model || DEFAULT_OPENAI_MODEL;
  const voice = tts.voice || DEFAULT_OPENAI_VOICE;
  // OpenAI 兼容接口没有统一个语速字段，用 instructions 描述比乱塞未知字段更稳。
  const instructions = speed === 1 ? undefined : `请以约 ${speed} 倍速朗读。`;
  return {
    url: `${baseUrlOf(tts)}/audio/speech`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: 'mp3',
      ...(instructions ? { instructions } : {})
    })
  };
}

export interface HttpAudioResult {
  status: number;
  mimeType: string;
  bytes: Buffer;
}

/** 用 Node 原生 https 取二进制；容器内可直接联网，不经过宿主的文本响应体。 */
export function fetchBinary(request: TtsRequest): Promise<HttpAudioResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(new Error('TTS 地址无效'));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const isHttp = parsed.protocol === 'http:';
    if (!isHttps && !isHttp) {
      reject(new Error('TTS 地址必须是 http 或 https'));
      return;
    }
    // 延迟 require，避免把 Node 模块打进其它运行路径。
    const transport = require(isHttps ? 'https' : 'http') as typeof import('https');
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...request.headers, 'Content-Length': Buffer.byteLength(request.body) },
        timeout: REQUEST_TIMEOUT_MS
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          // 兜底，避免异常响应把内存占满。
          if (size > 8 * 1024 * 1024) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          const contentType = String(res.headers['content-type'] ?? '');
          if (status < 200 || status >= 300) {
            const detail = bytes.toString('utf8').slice(0, 300);
            reject(new Error(`TTS 请求失败 ${status}：${detail}`));
            return;
          }
          if (!/audio|octet-stream|mpeg/i.test(contentType) && bytes.length < 512) {
            reject(new Error(`TTS 返回的不是音频：${contentType || 'unknown'}`));
            return;
          }
          resolve({ status, mimeType: contentType.split(';')[0] || 'audio/mpeg', bytes });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TTS 请求超时'));
    });
    req.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
    req.write(request.body);
    req.end();
  });
}

/** Gemini 返回的是裸 PCM，需要补 WAV 头才能被 <audio> 播放。 */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function geminiAudio(bytes: Buffer): { bytes: Buffer; mimeType: string } {
  const payload = JSON.parse(bytes.toString('utf8')) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
      };
    }>;
  };
  const inline = payload.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('Gemini 未返回音频数据');
  const raw = Buffer.from(inline.data, 'base64');
  const mimeType = inline.mimeType ?? '';
  // Gemini 返回 audio/L16;codec=pcm;rate=24000，需转成 WAV 才能播。
  if (/l16|pcm/i.test(mimeType)) {
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24_000);
    return { bytes: pcmToWav(raw, rate), mimeType: 'audio/wav' };
  }
  return { bytes: raw, mimeType: mimeType || 'audio/mpeg' };
}

/** 合成一句台词。返回 null 表示未配置 TTS 或不可用，调用方应继续用纯文字。 */
export async function synthesize(settings: PetSettings, text: string): Promise<SpeechAudio | null> {
  const tts = settings.voice.tts;
  if (tts.provider === 'none') return null;
  const input = text.trim().slice(0, MAX_TTS_CHARS);
  if (!input) return null;
  const apiKey = await readKey();
  if (!apiKey) {
    log('TTS 未配置密钥，跳过朗读');
    return null;
  }
  const result = await fetchBinary(buildRequest(tts, apiKey, input));
  const normalized = tts.provider === 'gemini' ? geminiAudio(result.bytes) : { bytes: result.bytes, mimeType: result.mimeType };
  const url = `data:${normalized.mimeType};base64,${normalized.bytes.toString('base64')}`;
  if (url.length > 3.5 * 1024 * 1024) throw new Error('合成音频过大，请缩短台词');
  // 粗略估算时长，供页面规划气泡停留时间。
  const durationHintMs = Math.min(30_000, Math.max(800, Math.round(input.length * 220)));
  return { url, mimeType: normalized.mimeType, durationHintMs };
}

/**
 * 从使用者已在 AiCode 配好的供应商推断 TTS 预设。
 *
 * 宿主只暴露 id/name/type/defaultModel，且明确不返回 baseUrl 与 Key，
 * 所以这里只能带入「供应商类型、默认地址、可用模型」，Key 仍需单独保存一次。
 */
export interface TtsPreset {
  providerId: string;
  providerName: string;
  tts: Pick<TtsSettings, 'provider' | 'baseUrl' | 'model'>;
  /** 该供应商是否已配置可用的 Key（仅供参考，插件读不到 Key 本身）。 */
  hasKey: boolean;
}

interface ListedProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  hasKey: boolean;
  isPlugin: boolean;
  defaultModel: string;
}

function presetFor(provider: ListedProvider): TtsPreset['tts'] | null {
  const type = provider.type.toLowerCase();
  if (type === 'google' || type === 'gemini') {
    return { provider: 'gemini', baseUrl: '', model: DEFAULT_GEMINI_MODEL };
  }
  // OpenAI 兼容协议是绝大多数第三方站点的形态（xAI、DeepSeek、Groq 等）。
  if (type === 'openai' || type === 'openai-compatible' || type === 'custom') {
    return { provider: 'openai', baseUrl: '', model: DEFAULT_OPENAI_MODEL };
  }
  return null;
}

export async function listTtsPresets(): Promise<{ presets: TtsPreset[]; error: string | null }> {
  try {
    const result = await hostCall<{ providers: ListedProvider[] }>('host.model.listProviders');
    const presets: TtsPreset[] = [];
    for (const provider of result.providers) {
      if (!provider.enabled || provider.isPlugin) continue;
      const tts = presetFor(provider);
      if (!tts) continue;
      presets.push({
        providerId: provider.id,
        providerName: provider.name,
        tts,
        hasKey: provider.hasKey
      });
    }
    return { presets, error: null };
  } catch (error) {
    return { presets: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 探测某个地址是否真的提供语音接口。
 *
 * 有些 OpenAI 兼容服务只有 /v1/chat/completions（例如本地聚合网关），
 * 拿对话模型去合成语音只会得到 404。这里只发一次极小的请求，看路由是否存在。
 */
export async function probeTtsEndpoint(baseUrl: string, protocol: 'openai' | 'gemini'): Promise<{ ok: boolean; reason?: string }> {
  const base = trimSlash(baseUrl || (protocol === 'gemini' ? DEFAULT_GEMINI_BASE : DEFAULT_OPENAI_BASE));
  const url = protocol === 'gemini' ? `${base}/models` : `${base}/audio/speech`;
  try {
    const result = await hostCall<{ status?: number; body?: string }>('host.http.request', {
      url,
      method: protocol === 'gemini' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: protocol === 'gemini' ? undefined : JSON.stringify({ model: 'probe', voice: 'alloy', input: '.' }),
      timeout: 15
    });
    const status = result?.status ?? 0;
    // 401/403 说明路由存在、只是没鉴权；404 才是根本没有这个接口。
    if (status === 404) {
      const detail = typeof result?.body === 'string' ? result.body.slice(0, 200) : '';
      return { ok: false, reason: `该地址没有语音接口（404）。${detail}` };
    }
    return { ok: true };
  } catch (error) {
    // 网络不可达等无法判定路由的情况交给试听去暴露，不在这里拦。
    return { ok: true, reason: error instanceof Error ? error.message : String(error) };
  }
}
