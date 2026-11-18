import { definePlugin, hostCall, type PluginArgs, type PluginHandler } from '@jieapi/plugin-sdk';
import {
  checkQrStatus,
  fetchQrCode,
  loginWithPhone,
  MusicApiError,
  refreshSession,
  searchSongs,
  sendLoginCode
} from './shared/api';
import {
  DEFAULT_SETTINGS,
  normalizeSession,
  normalizeSettings,
  type MusicSession,
  type MusicSettings
} from './shared/types';

const CONFIG_PATH = 'data://config.json';
const SESSION_PATH = 'data://session.json';

let settings: MusicSettings = DEFAULT_SETTINGS;
let session: MusicSession | null = null;
let loaded = false;
let loadPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  if (error instanceof MusicApiError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
  }
  return 'PLUGIN_ERROR';
}

function readString(args: PluginArgs, key: string, fallback = ''): string {
  const value = args[key];
  return value === undefined || value === null ? fallback : String(value).trim();
}

async function loadSettings(): Promise<void> {
  try {
    const file = await hostCall<{ content?: unknown }>('host.fs.read', { path: CONFIG_PATH });
    settings = normalizeSettings(typeof file?.content === 'string' ? JSON.parse(file.content) : null);
  } catch {
    settings = DEFAULT_SETTINGS;
  }
}

async function loadSession(): Promise<void> {
  try {
    const file = await hostCall<{ content?: unknown }>('host.fs.read', { path: SESSION_PATH });
    session = normalizeSession(typeof file?.content === 'string' ? JSON.parse(file.content) : null);
  } catch {
    session = null;
  }
}

function load(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (loaded) return;
      await loadSettings();
      await loadSession();
      loaded = true;
    })().finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

async function persistSettings(): Promise<void> {
  await hostCall('host.fs.write', {
    path: CONFIG_PATH,
    content: JSON.stringify(settings, null, 2)
  });
}

async function persistSession(): Promise<void> {
  if (!session) {
    await hostCall('host.fs.delete', { path: SESSION_PATH }).catch(() => {});
    return;
  }
  await hostCall('host.fs.write', {
    path: SESSION_PATH,
    content: JSON.stringify(session, null, 2)
  });
}

function publicSession(): Record<string, unknown> | null {
  if (!session) return null;
  // 不回传 token：页面只需要展示身份。
  return {
    userId: session.userId,
    nickname: session.nickname || (session.userId ? `用户 ${session.userId}` : '已登录'),
    avatarUrl: session.avatarUrl,
    savedAt: session.savedAt
  };
}

const handlers: Record<string, PluginHandler> = {
  'ui.settings.get': async () => {
    await load();
    return { settings };
  },

  'ui.settings.save': async (args: PluginArgs) => {
    await load();
    settings = normalizeSettings(args.settings);
    await persistSettings();
    return { settings };
  },

  'ui.account.state': async () => {
    await load();
    return { signedIn: session !== null, account: publicSession(), apiBaseUrl: settings.apiBaseUrl };
  },

  'ui.account.logout': async () => {
    await load();
    session = null;
    await persistSession();
    return { ok: true };
  },

  'ui.search': async (args: PluginArgs) => {
    await load();
    const keywords = readString(args, 'keywords');
    const page = Math.max(1, Number(args.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(args.pageSize ?? settings.pageSize) || settings.pageSize));
    try {
      const result = await searchSongs(settings, session, keywords, page, pageSize);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, code: errorCode(error), message: errorMessage(error) };
    }
  },

  'ui.login.sendCode': async (args: PluginArgs) => {
    await load();
    const mobile = readString(args, 'mobile');
    if (!/^\d{6,15}$/.test(mobile)) {
      return { ok: false, code: 'PARAM_INVALID', message: '手机号格式不正确' };
    }
    try {
      await sendLoginCode(settings, mobile);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: errorCode(error), message: errorMessage(error) };
    }
  },

  'ui.login.phone': async (args: PluginArgs) => {
    await load();
    const mobile = readString(args, 'mobile');
    const code = readString(args, 'code');
    if (!mobile || !code) return { ok: false, code: 'PARAM_INVALID', message: '手机号与验证码都要填' };
    try {
      session = await loginWithPhone(settings, mobile, code);
      await persistSession();
      return { ok: true, account: publicSession() };
    } catch (error) {
      return { ok: false, code: errorCode(error), message: errorMessage(error) };
    }
  },

  'ui.login.qr': async () => {
    await load();
    try {
      const qr = await fetchQrCode(settings);
      return { ok: true, ...qr };
    } catch (error) {
      return { ok: false, code: errorCode(error), message: errorMessage(error) };
    }
  },

  'ui.login.qrCheck': async (args: PluginArgs) => {
    await load();
    const key = readString(args, 'key');
    if (!key) return { ok: false, code: 'PARAM_INVALID', message: '缺少二维码 key' };
    try {
      const result = await checkQrStatus(settings, session, key);
      // 扫码确认后接口直接给出 token，这里落盘成会话。
      if (result.status === 4 && result.token) {
        session = {
          userId: result.userId,
          token: result.token,
          t1: session?.t1 ?? '',
          sessionId: result.sessionId || result.token,
          nickname: result.nickname,
          avatarUrl: result.avatarUrl,
          savedAt: Date.now()
        };
        await persistSession();
        return { ok: true, ...result, account: publicSession() };
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, code: errorCode(error), message: errorMessage(error) };
    }
  },

  'ui.login.refresh': async () => {
    await load();
    if (!session) return { ok: false, code: 'NO_SESSION', message: '尚未登录' };
    try {
      session = await refreshSession(settings, session);
      await persistSession();
      return { ok: true, account: publicSession() };
    } catch (error) {
      return { ok: false, code: errorCode(error), message: errorMessage(error) };
    }
  },

  'tools.search': async (args: PluginArgs) => {
    await load();
    const keywords = readString(args, 'keywords');
    const page = Math.max(1, Number(args.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(args.pageSize ?? 10) || 10));
    const result = await searchSongs(settings, session, keywords, page, pageSize);
    return {
      keywords: result.keywords,
      page: result.page,
      count: result.songs.length,
      songs: result.songs.map((song) => ({
        title: song.title,
        singer: song.singer,
        album: song.album,
        hash: song.hash,
        duration: song.duration
      }))
    };
  },

  'tools.loginStatus': async () => {
    await load();
    return {
      signedIn: session !== null,
      userId: session?.userId ?? '',
      nickname: session?.nickname ?? ''
    };
  }
};

definePlugin({ handlers });
