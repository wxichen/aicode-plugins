import { hostCall } from '@jieapi/plugin-sdk';
import type { MusicSession, MusicSettings, QrCheckResult, QrCodeInfo, SearchResult, SongItem } from './shared/music';

/**
 * 酷狗接口封装（沿用 kgka_Music_hl 的公开服务）。
 *
 * 请求统一走 host.http.request：它不跟随重定向、响应体上限 1 MiB，
 * 这些接口返回的都是小 JSON，够用；登录会话放在响应头里，正好也能拿到。
 */

interface HostHttpResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  truncated?: boolean;
}

export class MusicApiError extends Error {
  code: string;

  constructor(message: string, code = 'MUSIC_API_ERROR') {
    super(message);
    this.code = code;
  }
}

function joinUrl(base: string, path: string, query: Record<string, unknown>): string {
  const url = new URL(`${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function headerOf(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string') return value;
  }
  return '';
}

async function request(
  settings: MusicSettings,
  session: MusicSession | null,
  path: string,
  query: Record<string, unknown> = {},
  method: 'GET' | 'POST' = 'GET',
  jsonBody?: Record<string, unknown>
): Promise<{ payload: unknown; headers: Record<string, string> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  const sessionId = session?.sessionId || session?.token || '';
  if (sessionId) headers['X-Kg-Session-Id'] = sessionId;
  if (session?.t1) headers.t1 = session.t1;

  let response: HostHttpResponse;
  try {
    response = await hostCall<HostHttpResponse>('host.http.request', {
      url: joinUrl(settings.apiBaseUrl, path, query),
      method,
      headers,
      // 部分接口要求 JSON 请求体（只放 query 会报「非空请求体」）。
      body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      timeout: 30
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MusicApiError(`请求失败：${message}`, 'NETWORK');
  }

  const status = response?.status ?? 0;
  const body = typeof response?.body === 'string' ? response.body : '';
  if (status < 200 || status >= 300) {
    throw new MusicApiError(`接口返回 ${status}：${body.slice(0, 200)}`, 'HTTP_STATUS');
  }
  let payload: unknown = null;
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw new MusicApiError('接口返回的不是 JSON', 'BAD_JSON');
    }
  }
  return { payload, headers: response?.headers ?? {} };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pickString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function pickNumber(input: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

/** 封面统一为 https：插件页 CSP 的 img-src 只允许 https，http 图片会被静默拦截。 */
function normalizeCover(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('//')) return 'https:' + raw;
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
  return raw;
}

/** 把接口返回的歌曲对象映射成稳定结构，字段名兼容几种写法。 */
export function mapSong(raw: unknown): SongItem | null {
  const input = asRecord(raw);
  const hash = pickString(input, ['FileHash', 'fileHash', 'hash', 'Hash']);
  if (!hash) return null;
  const fileName = pickString(input, ['FileName', 'fileName', 'name']);
  const singer = pickString(input, ['SingerName', 'singerName', 'singer']);
  const title = pickString(input, ['OriSongName', 'SongName', 'songName', 'title']) || fileName;
  return {
    hash,
    title: title || fileName || '未知歌曲',
    singer: singer || '未知歌手',
    album: pickString(input, ['AlbumName', 'albumName', 'album']),
    duration: pickNumber(input, ['Duration', 'duration', 'timelength']),
    cover: normalizeCover(pickString(input, ['Image', 'image', 'AlbumImage', 'img'])),
    fileName,
    bitrate: pickNumber(input, ['Bitrate', 'bitrate']),
    fileSize: pickNumber(input, ['FileSize', 'fileSize', 'size']),
    extName: pickString(input, ['ExtName', 'extName', 'extname']),
    albumId: pickString(input, ['AlbumID', 'albumId', 'album_id']),
    albumAudioId: pickString(input, ['MixSongID', 'mixSongId', 'album_audio_id', 'albumAudioId'])
  };
}

export async function searchSongs(
  settings: MusicSettings,
  session: MusicSession | null,
  keywords: string,
  page = 1,
  pageSize = 30
): Promise<SearchResult> {
  const word = keywords.trim();
  if (!word) throw new MusicApiError('关键词不能为空', 'PARAM_INVALID');
  const { payload } = await request(settings, session, 'search', {
    keywords: word,
    page,
    pagesize: pageSize,
    type: 'song'
  });
  const list = Array.isArray(payload)
    ? payload
    : (() => {
        const obj = asRecord(payload);
        const candidate = obj.songs ?? obj.song ?? obj.lists;
        return Array.isArray(candidate) ? candidate : [];
      })();
  const songs = list.map(mapSong).filter((song): song is SongItem => song !== null);
  return { songs, keywords: word, page, pageSize };
}

export async function fetchQrCode(settings: MusicSettings): Promise<QrCodeInfo> {
  const { payload } = await request(settings, null, 'login/qr/key');
  const obj = asRecord(payload);
  const key = pickString(obj, ['qrcode', 'key']);
  const image = pickString(obj, ['qrcode_img', 'image']);
  if (!key) throw new MusicApiError('未能获取二维码 key', 'QR_KEY_MISSING');
  return { key, image };
}

export async function checkQrStatus(
  settings: MusicSettings,
  session: MusicSession | null,
  key: string
): Promise<QrCheckResult> {
  const { payload, headers } = await request(settings, session, 'login/qr/check', { key });
  const obj = asRecord(payload);
  return {
    status: pickNumber(obj, ['status']),
    nickname: pickString(obj, ['nickname', 'nickName']),
    avatarUrl: pickString(obj, ['pic', 'avatar', 'avatarUrl']),
    userId: pickString(obj, ['userid', 'userId']),
    token: pickString(obj, ['token']),
    sessionId: headerOf(headers, 'X-Kg-Session-Id')
  };
}

export async function sendLoginCode(settings: MusicSettings, mobile: string): Promise<void> {
  // 此接口只认 query，带 JSON body 反而会报 mobile 缺失。
  const { payload } = await request(settings, null, 'captcha/sent', { mobile }, 'POST');
  const obj = asRecord(payload);
  const errorCode = pickNumber(obj, ['error_code', 'errorCode']);
  const status = pickNumber(obj, ['status', 'code']);
  // 实测成功响应为 {"code":0,"status":1,"error_code":0,"count":9}。
  const ok = errorCode === 0 || status === 1 || Object.keys(obj).length === 0;
  if (!ok) {
    throw new MusicApiError(
      pickString(obj, ['message', 'msg']) || `发送验证码失败（code=${errorCode || status}）`,
      'CAPTCHA_FAILED'
    );
  }
}

export async function loginWithPhone(
  settings: MusicSettings,
  mobile: string,
  code: string
): Promise<MusicSession> {
  // 登录接口要求 JSON body：只放 query 会返回 400「A non-empty request body is required」。
  const { payload, headers } = await request(
    settings,
    null,
    'login/cellphone',
    {},
    'POST',
    { mobile, code }
  );
  const obj = asRecord(payload);
  if (Array.isArray(obj.accounts) && obj.accounts.length > 0) {
    throw new MusicApiError(
      `该手机号关联了 ${obj.accounts.length} 个账号，需要指定 userid；当前版本先只支持单账号登录`,
      'MULTI_ACCOUNT'
    );
  }
  const session = sessionFromPayload(obj, headerOf(headers, 'X-Kg-Session-Id'));
  if (!session.token) {
    throw new MusicApiError(pickString(obj, ['message', 'msg']) || '登录失败，接口未返回 token', 'LOGIN_FAILED');
  }
  return session;
}

export async function refreshSession(settings: MusicSettings, current: MusicSession): Promise<MusicSession> {
  const { payload, headers } = await request(
    settings,
    current,
    'login/token',
    { token: current.token, userid: current.userId },
    'POST'
  );
  const next = sessionFromPayload(asRecord(payload), headerOf(headers, 'X-Kg-Session-Id'), current);
  if (!next.token) throw new MusicApiError('登录已失效，请重新登录', 'TOKEN_EXPIRED');
  return next;
}

function sessionFromPayload(
  payload: Record<string, unknown>,
  sessionId: string,
  previous?: MusicSession
): MusicSession {
  const data = asRecord(payload.data);
  const token = pickString(payload, ['token']) || pickString(data, ['token']);
  const userId = pickString(payload, ['userid', 'userId']) || pickString(data, ['userid', 'userId']);
  return {
    userId: userId && userId !== '0' ? userId : previous?.userId ?? '',
    token: token || previous?.token || '',
    t1: pickString(payload, ['t1']) || pickString(data, ['t1']) || previous?.t1 || '',
    sessionId: sessionId || previous?.sessionId || '',
    nickname: pickString(payload, ['nickname', 'nickName']) || previous?.nickname || '',
    avatarUrl: pickString(payload, ['pic', 'avatar']) || previous?.avatarUrl || '',
    savedAt: Date.now()
  };
}

/**
 * 解析播放地址。
 *
 * 实测：未登录时服务端对所有歌曲都返回 400 + errcode 20028「本次请求需要验证」，
 * 所以播放必须先登录；付费/受限歌曲登录后也可能拿不到 url，这里把原因原样带回。
 */
export async function resolvePlayUrl(
  settings: MusicSettings,
  session: MusicSession | null,
  song: { hash: string; albumId?: string; albumAudioId?: string }
): Promise<{ url: string; reason: string }> {
  if (!song.hash) return { url: '', reason: '缺少歌曲 hash' };
  if (!session) return { url: '', reason: '未登录：播放地址需要登录后才能获取' };
  const query: Record<string, unknown> = {
    hash: song.hash,
    quality: 'standard',
    free_part: false
  };
  // album_audio_id 必须是数字，否则服务端解析失败返回空地址。
  if (song.albumAudioId && /^\d+$/.test(song.albumAudioId)) query.album_audio_id = song.albumAudioId;
  if (song.albumId && /^\d+$/.test(song.albumId)) query.album_id = song.albumId;

  const { payload } = await request(settings, session, 'song/url', query);
  const obj = asRecord(payload);
  const data = Array.isArray(obj.data) ? asRecord(obj.data[0]) : asRecord(obj.data);
  const url = pickString(obj, ['url']) || pickString(data, ['url']);
  if (url) return { url, reason: '' };
  const reason = pickString(obj, ['error', 'message']) || pickString(data, ['error', 'message']);
  const errcode = pickNumber(obj, ['errcode', 'err_code']);
  return { url: '', reason: reason || (errcode ? `服务端拒绝（errcode=${errcode}）` : '未获取到播放地址') };
}
