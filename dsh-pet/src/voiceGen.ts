import { hostCall, log } from '@jieapi/plugin-sdk';
import { cannedLine, instructionFor, type VoiceKind } from './shared/voice';
import type { PetSettings } from './shared/settings';

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_LINE = 60;

interface ProviderInfo {
  id: string;
  name: string;
  /** openai / google / anthropic 等；用于推断 TTS 供应商与默认地址。 */
  type: string;
  enabled: boolean;
  hasKey: boolean;
  isPlugin: boolean;
  isDefault: boolean;
  defaultModel: string;
}

export interface VoiceModelInfo {
  id: string;
  displayName: string;
  modelType: string;
}

interface ReadResult {
  cursor: number;
  done: boolean;
  status?: 'success' | 'error' | 'cancelled';
  final?: { content: string };
  error?: { code: string; message: string };
}

interface VoiceTarget {
  providerId: string;
  model: string;
}

interface SpeakResult {
  text: string;
  source: 'model' | 'canned';
}

let lastError = '';

export function voiceError(): string {
  return lastError;
}

export function voiceRequested(settings: PetSettings): boolean {
  return settings.voice.mode === 'auto';
}

function providers(): Promise<ProviderInfo[]> {
  return hostCall<{ providers: ProviderInfo[] }>('host.model.listProviders').then((result) => result.providers);
}

function chatModels(providerId: string): Promise<VoiceModelInfo[]> {
  return hostCall<{ models: VoiceModelInfo[] }>('host.model.listModels', { providerId }).then((result) =>
    result.models.filter((item) => item.modelType === 'chat')
  );
}

async function resolveTarget(settings: PetSettings): Promise<VoiceTarget | null> {
  const { providerId, model } = settings.voice;
  const all = await providers();
  if (providerId) {
    const provider = all.find((item) => item.id === providerId);
    if (!provider || !provider.enabled || !provider.hasKey) return null;
    if (model) return { providerId, model };
    const models = await chatModels(providerId);
    return models.length > 0 ? { providerId, model: models[0].id } : null;
  }
  const usable = all.filter((item) => item.enabled && item.hasKey && !item.isPlugin && item.defaultModel);
  const preferred = usable.find((item) => item.isDefault) ?? usable[0];
  return preferred ? { providerId: preferred.id, model: preferred.defaultModel } : null;
}

async function readAll(streamId: string): Promise<ReadResult> {
  let cursor = 0;
  for (;;) {
    const chunk = await hostCall<ReadResult>('host.model.read', { streamId, cursor, waitMs: 8000 });
    if (chunk.done) return chunk;
    cursor = chunk.cursor;
  }
}

function normalizeLine(raw: string): string {
  const first =
    raw
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  return first.replace(/^["“”'「『]+|["“”'」』]+$/g, '').slice(0, MAX_LINE);
}

async function generate(settings: PetSettings, kind: VoiceKind, mood: number): Promise<string> {
  const target = await resolveTarget(settings);
  if (!target) {
    lastError = 'NO_PROVIDER';
    return '';
  }
  const created = await hostCall<{ handle: { id: string } }>('host.model.create', {
    providerId: target.providerId,
    model: target.model,
    name: 'dsh-pet-voice',
    systemPrompt: settings.persona
  });
  const handleId = created.handle.id;
  try {
    const started = await hostCall<{ streamId: string }>('host.model.start', {
      handleId,
      messages: [{ role: 'user', content: instructionFor(kind, settings.petName, mood) }],
      params: { maxOutputTokens: 120, temperature: 0.9 }
    });
    const result = await readAll(started.streamId);
    if (result.status !== 'success') {
      lastError = result.error?.code ?? 'MODEL_ERROR';
      return '';
    }
    const line = normalizeLine(result.final?.content ?? '');
    lastError = line ? '' : 'EMPTY_RESPONSE';
    return line;
  } finally {
    await hostCall('host.model.close', { handleId }).catch(() => {});
  }
}

/** 台词优先由模型按人设生成；模型不可用、超时或配置为 canned 时退回内置语料。 */
export async function speak(settings: PetSettings, kind: VoiceKind, mood: number): Promise<SpeakResult> {
  if (!voiceRequested(settings)) return { text: cannedLine(kind, settings.petName), source: 'canned' };
  try {
    const text = await Promise.race([
      generate(settings, kind, mood),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), REQUEST_TIMEOUT_MS))
    ]);
    if (text) return { text, source: 'model' };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log(`桌宠台词生成失败：${lastError}`);
  }
  return { text: cannedLine(kind, settings.petName), source: 'canned' };
}

/** 设置页用于列出可选的供应商与模型。 */
export async function listVoiceOptions(): Promise<{
  providers: Array<{ id: string; name: string; models: VoiceModelInfo[] }>;
  error: string | null;
}> {
  try {
    const all = await providers();
    const result: Array<{ id: string; name: string; models: VoiceModelInfo[] }> = [];
    for (const provider of all) {
      if (!provider.enabled || !provider.hasKey || provider.isPlugin) continue;
      result.push({ id: provider.id, name: provider.name, models: await chatModels(provider.id) });
    }
    return { providers: result, error: null };
  } catch (error) {
    return { providers: [], error: error instanceof Error ? error.message : String(error) };
  }
}
