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
    // 实测 quality 只认数字码：'standard' 会返回 20010，128 才能拿到地址。
    quality: '128',
    free_part: false
  };
  // album_audio_id 必须是数字，否则服务端解析失败返回空地址。
  if (song.albumAudioId && /^\d+$/.test(song.albumAudioId)) query.album_audio_id = song.albumAudioId;
  if (song.albumId && /^\d+$/.test(song.albumId)) query.album_id = song.albumId;

  const { payload } = await request(settings, session, 'song/url', query);
  const obj = asRecord(payload);
  const data = Array.isArray(obj.data) ? asRecord(obj.data[0]) : asRecord(obj.data);
  // url 可能是字符串或字符串数组，两种都取第一个可用地址。
  const urlList = Array.isArray(obj.url) ? obj.url : Array.isArray(data.url) ? data.url : [];
  const fromList = urlList
    .map((item) => (typeof item === 'string' ? item : ''))
    .find((item) => item.startsWith('http'));
  const url = pickString(obj, ['url']) || pickString(data, ['url']) || fromList || '';
  if (url) return { url, reason: '' };
  const reason = pickString(obj, ['error', 'message']) || pickString(data, ['error', 'message']);
  const errcode = pickNumber(obj, ['errcode', 'err_code']);
  return { url: '', reason: reason || (errcode ? `服务端拒绝（errcode=${errcode}）` : '未获取到播放地址') };
}

/** 账号里的一个歌单（酷狗侧），与插件本地收藏区分开。 */
export interface AccountPlaylist {
  /** 请求歌曲列表时用的 id（优先 global_collection_id） */
  id: string;
  name: string;
  songCount: number;
  cover: string;
  /** 是否为「我喜欢」 */
  isDefault: boolean;
  creator: string;
}

function mapAccountPlaylist(raw: unknown, currentUserId: string): AccountPlaylist | null {
  const input = asRecord(raw);
  const globalId = pickString(input, ['global_collection_id', 'globalCollectionId']);
  const listId = pickString(input, ['listid', 'list_id', 'id', 'specialid']);
  // 曲库接口优先用 global_collection_id，退回 listid。
  const id = globalId || listId;
  if (!id) return null;
  const name = pickString(input, ['name', 'specialname', 'listname', 'title']);
  const isDefault =
    pickNumber(input, ['is_def', 'is_default', 'isDefault']) === 1 ||
    /我喜欢|收藏/.test(name);
  return {
    id,
    name: name || '未命名歌单',
    songCount: pickNumber(input, ['count', 'song_count', 'songCount', 'total']),
    cover: normalizeCover(
      pickString(input, ['img', 'image', 'pic', 'flexible_cover', 'list_pic', 'cover'])
    ),
    isDefault,
    creator: pickString(input, ['list_create_username', 'nickname', 'username', 'creator']) ||
      (currentUserId ? '用户 ' + currentUserId : '')
  };
}

/** 拉取当前账号的歌单；未登录直接返回空并给出原因。 */
export async function fetchAccountPlaylists(
  settings: MusicSettings,
  session: MusicSession | null,
  page = 1,
  pageSize = 50
): Promise<{ ok: boolean; playlists: AccountPlaylist[]; reason: string }> {
  if (!session) return { ok: false, playlists: [], reason: '未登录：无法读取账号歌单' };
  const { payload } = await request(settings, session, 'user/playlist', { page, pagesize: pageSize });
  const obj = asRecord(payload);
  const currentUserId = pickString(obj, ['userid', 'userId']);
  const list = Array.isArray(obj.info)
    ? obj.info
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(obj.list)
        ? obj.list
        : [];
  const playlists = list
    .map((item) => mapAccountPlaylist(item, currentUserId))
    .filter((item): item is AccountPlaylist => item !== null);
  return { ok: true, playlists, reason: '' };
}

/** 拉取指定歌单的歌曲。 */
export async function fetchPlaylistSongs(
  settings: MusicSettings,
  session: MusicSession | null,
  playlistId: string,
  page = 1,
  pageSize = 100
): Promise<{ ok: boolean; songs: SongItem[]; reason: string }> {
  if (!session) return { ok: false, songs: [], reason: '未登录：无法读取歌单歌曲' };
  const { payload } = await request(settings, session, 'playlist/track/all', {
    id: playlistId,
    page,
    pagesize: pageSize
  });
  const obj = asRecord(payload);
  const list = Array.isArray(obj.songs)
    ? obj.songs
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];
  const songs = list.map(mapSong).filter((song): song is SongItem => song !== null);
  return { ok: true, songs, reason: '' };
}

/** 一行歌词：毫秒时间戳 + 文本。 */
export interface LyricLine {
  timeMs: number;
  text: string;
}

/** 把 LRC 文本解析成带时间轴的歌词行，过滤元信息与空行。 */
export function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const lines: LyricLine[] = [];
  const tagPattern = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const rawLine of raw.split(/\r?\n/)) {
    const times: number[] = [];
    let match: RegExpExecArray | null;
    tagPattern.lastIndex = 0;
    while ((match = tagPattern.exec(rawLine)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ?? '0';
      const ms = fraction.length === 3 ? Number(fraction) : fraction.length === 2 ? Number(fraction) * 10 : Number(fraction) * 100;
      times.push(minutes * 60_000 + seconds * 1000 + ms);
    }
    if (times.length === 0) continue;
    const text = rawLine.replace(tagPattern, '').trim();
    // 元信息（[ti:]、[ar:] 等）没有时间戳，已被过滤；纯符号行也跳过。
    if (!text) continue;
    for (const timeMs of times) lines.push({ timeMs, text });
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** 取歌曲歌词；先用 hash 找候选，再按候选的 id + accesskey 拉内容。 */
export async function fetchLyrics(
  settings: MusicSettings,
  session: MusicSession | null,
  song: { hash: string; albumAudioId?: string; title?: string; singer?: string }
): Promise<{ ok: boolean; lines: LyricLine[]; reason: string }> {
  if (!song.hash) return { ok: false, lines: [], reason: '缺少歌曲 hash' };
  const searchQuery: Record<string, unknown> = { hash: song.hash };
  if (song.albumAudioId && /^\d+$/.test(song.albumAudioId)) searchQuery.album_audio_id = song.albumAudioId;
  const { payload } = await request(settings, session, 'search/lyric', searchQuery);
  const obj = asRecord(payload);
  const candidates = Array.isArray(obj.candidates) ? obj.candidates : [];
  const first = asRecord(candidates[0]);
  const id = pickString(first, ['id', 'lyrics_id', 'lyric_id']);
  const accessKey = pickString(first, ['accesskey', 'access_key']);
  if (!id || !accessKey) return { ok: false, lines: [], reason: '没有找到这首歌的歌词' };

  const { payload: lyricPayload } = await request(settings, session, 'lyric', {
    id,
    accesskey: accessKey,
    fmt: 'lrc',
    decode: true
  });
  const lyricObj = asRecord(lyricPayload);
  const content =
    pickString(lyricObj, ['decodedContent']) ||
    pickString(lyricObj, ['rawContent']) ||
    pickString(lyricObj, ['content']) ||
    pickString(lyricObj, ['lyric']);
  const lines = parseLrc(content);
  if (lines.length === 0) return { ok: false, lines: [], reason: '歌词内容为空' };
  return { ok: true, lines, reason: '' };
}

/** 单片大小：base64 后约 267 KiB，低于页面单次可接收上限。 */
export const AUDIO_CHUNK_BYTES = 200 * 1024;

/* 音频由进程下载后保留在内存，页面按片拉取（不经文件系统，避免 data:// 映射差异）。 */

/**
 * 推断音频 MIME：CDN 常返回 application/octet-stream，必须按魔数纠正，
 * 否则 Blob 类型不对会导致 <audio> 解码失败。
 */
function guessAudioMime(contentType: string, bytes: Buffer): string {
  const header = contentType.split(';')[0].trim().toLowerCase();
  if (header.startsWith('audio/')) return header;
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'RIFF') return 'audio/wav';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  if (bytes.length >= 4 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  return 'audio/mpeg';
}

async function fetchAudioBytes(
  url: string,
  onProgress?: (received: number) => void
): Promise<{ bytes: Buffer; mimeType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MusicApiError('音频地址必须是 http 或 https', 'PARAM_INVALID');
  }
  const transport = require(parsed.protocol === 'https:' ? 'https' : 'http') as typeof import('https');
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: 60_000
      },
      (res) => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new MusicApiError(`音频下载失败 ${res.statusCode}`, 'AUDIO_HTTP'));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          // 限制单曲大小，避免把数据目录写满（128k mp3 约 4 MB）。
          if (received > 24 * 1024 * 1024) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
          onProgress?.(received);
        });
        res.on('end', () => {
          const merged = Buffer.concat(chunks);
          resolve({
            bytes: merged,
            mimeType: guessAudioMime(String(res.headers['content-type'] ?? ''), merged)
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new MusicApiError('音频下载超时', 'AUDIO_TIMEOUT'));
    });
    req.on('error', (error) =>
      reject(new MusicApiError(`音频下载失败：${error.message}`, 'AUDIO_NETWORK'))
    );
    req.end();
  });
}

/** 下载并把音频切片写入 data://audio/，返回片路径。页面负责读回拼装。 */
/** 进程内存里保留的待播音频，供页面按片拉取。 */
export interface AudioBuffer {
  bytes: Buffer;
  mimeType: string;
  totalBytes: number;
}

export async function downloadAudio(
  url: string
): Promise<AudioBuffer> {
  const { bytes, mimeType } = await fetchAudioBytes(url);
  return { bytes, mimeType, totalBytes: bytes.length };
}

/** 把音频按片切成 base64，每片不超过页面单次可接收的大小。 */
export function sliceAudioBase64(
  audio: AudioBuffer,
  chunkBytes = 200 * 1024
): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < audio.bytes.length; offset += chunkBytes) {
    chunks.push(audio.bytes.subarray(offset, offset + chunkBytes).toString('base64'));
  }
  return chunks;
}
