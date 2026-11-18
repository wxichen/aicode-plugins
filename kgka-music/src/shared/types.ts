/** 插件使用的接口地址：沿用 kgka_Music_hl 的公开服务，可在设置里改成自建地址。 */
export interface MusicSettings {
  /** 接口根地址，例如 https://music.api.hoilai.cn */
  apiBaseUrl: string;
  /** 每页条数 */
  pageSize: number;
}

export interface MusicSession {
  userId: string;
  token: string;
  /** 酷狗部分接口需要的 t1 票据 */
  t1: string;
  sessionId: string;
  nickname: string;
  avatarUrl: string;
  /** 毫秒时间戳，用于展示与判断是否过期 */
  savedAt: number;
}

export interface SongItem {
  hash: string;
  title: string;
  singer: string;
  album: string;
  /** 秒 */
  duration: number;
  cover: string;
  fileName: string;
  bitrate: number;
  fileSize: number;
  extName: string;
  albumId: string;
}

export interface SearchResult {
  songs: SongItem[];
  keywords: string;
  page: number;
  pageSize: number;
}

export interface QrCodeInfo {
  /** 轮询用 */
  key: string;
  /** data:image/png;base64,... 可直接作为 img.src */
  image: string;
}

export interface QrCheckResult {
  /** 1 等待扫描、2 已扫描待确认、4 已确认、0 过期 */
  status: number;
  nickname: string;
  avatarUrl: string;
  userId: string;
  token: string;
  /** 响应头里的会话标识，缺省时用 token 代替 */
  sessionId: string;
}

export const DEFAULT_SETTINGS: MusicSettings = {
  apiBaseUrl: 'https://music.api.hoilai.cn',
  pageSize: 30
};

const MAX_BASE_URL = 2048;

export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_SETTINGS.apiBaseUrl;
  const value = raw.trim().replace(/\/+$/, '');
  if (!value || value.length > MAX_BASE_URL) return DEFAULT_SETTINGS.apiBaseUrl;
  if (!/^https?:\/\//i.test(value)) return DEFAULT_SETTINGS.apiBaseUrl;
  return value;
}

export function normalizeSettings(raw: unknown): MusicSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const size = typeof input.pageSize === 'number' && Number.isFinite(input.pageSize) ? input.pageSize : DEFAULT_SETTINGS.pageSize;
  return {
    apiBaseUrl: normalizeBaseUrl(input.apiBaseUrl),
    pageSize: Math.min(50, Math.max(1, Math.round(size)))
  };
}

export function normalizeSession(raw: unknown): MusicSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const token = typeof input.token === 'string' ? input.token : '';
  if (!token) return null;
  return {
    userId: typeof input.userId === 'string' ? input.userId : '',
    token,
    t1: typeof input.t1 === 'string' ? input.t1 : '',
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
    nickname: typeof input.nickname === 'string' ? input.nickname : '',
    avatarUrl: typeof input.avatarUrl === 'string' ? input.avatarUrl : '',
    savedAt: typeof input.savedAt === 'number' ? input.savedAt : Date.now()
  };
}
