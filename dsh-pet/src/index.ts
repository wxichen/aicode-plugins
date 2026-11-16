import { definePlugin, hostCall, emit, type PluginArgs, type PluginHandler } from '@aicode/plugin-sdk';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PetAnimation,
  type PetSettings,
  type PetState
} from './shared/settings';

const CONFIG_PATH = 'data://config.json';
const STATE_PATH = 'data://state.json';
const PET_SURFACE = 'pet';
const CREATE_WIDTH = 200;
const CREATE_HEIGHT = 170;

const state: PetState = {
  sleeping: false,
  runActive: false,
  toolsActive: 0,
  lastAnimation: null,
  lastText: '',
  updatedAt: Date.now()
};

let settings: PetSettings = DEFAULT_SETTINGS;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let overlayId: string | null = null;
let overlayPromise: Promise<string> | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let launchError = '';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(args: PluginArgs, key: string, fallback = ''): string {
  const value = args[key];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function settingsPayload(): Record<string, unknown> {
  return settings as unknown as Record<string, unknown>;
}

function statePayload(): Record<string, unknown> {
  return {
    sleeping: state.sleeping,
    runActive: state.runActive,
    toolsActive: state.toolsActive,
    lastAnimation: state.lastAnimation,
    lastText: state.lastText,
    updatedAt: state.updatedAt
  };
}

function persistState(): void {
  state.updatedAt = Date.now();
  void hostCall('host.fs.write', { path: STATE_PATH, content: JSON.stringify(state) }).catch(() => {});
}

async function loadState(): Promise<void> {
  try {
    const file = await hostCall<{ content?: unknown }>('host.fs.read', { path: STATE_PATH });
    const raw = typeof file?.content === 'string' ? JSON.parse(file.content) : null;
    if (raw && typeof raw === 'object') {
      const saved = raw as Partial<PetState>;
      state.sleeping = saved.sleeping === true;
      state.runActive = saved.runActive === true;
      state.toolsActive = typeof saved.toolsActive === 'number' ? saved.toolsActive : 0;
      state.lastAnimation = (saved.lastAnimation as PetAnimation | null) ?? null;
      state.lastText = typeof saved.lastText === 'string' ? saved.lastText : '';
      state.updatedAt = typeof saved.updatedAt === 'number' ? saved.updatedAt : Date.now();
    }
  } catch {
    // 首次运行没有保存的状态，使用默认值即可。
  }
}

async function loadSettings(): Promise<void> {
  try {
    const file = await hostCall<{ content?: unknown }>('host.fs.read', { path: CONFIG_PATH });
    settings = normalizeSettings(typeof file?.content === 'string' ? JSON.parse(file.content) : null);
  } catch {
    settings = DEFAULT_SETTINGS;
  }
}

function load(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (loaded) return;
      await loadSettings();
      await loadState();
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

async function ensureOverlay(): Promise<string> {
  if (overlayId) return overlayId;
  if (!overlayPromise) {
    overlayPromise = hostCall<{ overlayId?: unknown }>('host.overlay.create', {
      surface: PET_SURFACE,
      width: CREATE_WIDTH,
      height: CREATE_HEIGHT,
      visibilityPolicy: 'always'
    })
      .then((info) => {
        const id = info?.overlayId ? String(info.overlayId) : '';
        if (!id) throw new Error('桌宠浮层未返回 overlayId');
        overlayId = id;
        return id;
      })
      .finally(() => {
        overlayPromise = null;
      });
  }
  return overlayPromise;
}

async function postOverlay(payload: Record<string, unknown>): Promise<void> {
  if (!overlayId) return;
  try {
    await hostCall('host.overlay.postMessage', { overlayId, payload });
  } catch (error) {
    if (errorCode(error) !== 'OVERLAY_NOT_FOUND') throw error;
    overlayId = null;
    await ensureOverlay();
    await hostCall('host.overlay.postMessage', { overlayId, payload });
  }
}

async function publishSettings(): Promise<void> {
  await postOverlay({ type: 'pet.settings', settings: settingsPayload() });
}

async function publishState(animation?: PetAnimation, text?: string): Promise<void> {
  if (animation) state.lastAnimation = animation;
  if (text !== undefined) state.lastText = text;
  persistState();
  await postOverlay({ type: 'pet.state', state: statePayload() });
}

async function closeOverlay(): Promise<void> {
  const current = overlayId;
  overlayId = null;
  if (!current) return;
  await hostCall('host.overlay.close', { overlayId: current }).catch(() => {});
}

function stopIdleWhisper(): void {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

const WHISPERS = [
  '主人今天也要好好休息哦。',
  '有点无聊，陪我玩一会儿嘛。',
  '写代码别忘了喝水呀。',
  '我在这儿看着你呢。',
  '要不要摸摸我的头？'
];
let whisperCursor = 0;

function startIdleWhisper(): void {
  stopIdleWhisper();
  if (!settings.idleWhisper) return;
  const intervalMs = Math.max(60_000, settings.whisperIntervalMinutes * 60_000);
  idleTimer = setInterval(() => {
    if (!overlayId || state.sleeping || state.runActive) return;
    const text = WHISPERS[whisperCursor % WHISPERS.length];
    whisperCursor += 1;
    void publishState(settings.animations.action, text).catch(() => {});
  }, intervalMs);
}

async function openPet(): Promise<{ ok: boolean; overlayId?: string; code?: string; message?: string }> {
  await load();
  try {
    await ensureOverlay();
    launchError = '';
    await publishSettings();
    await publishState(state.lastAnimation ?? settings.animations.idle, state.lastText);
    return { ok: true, overlayId: overlayId ?? undefined };
  } catch (error) {
    launchError = errorCode(error) ?? errorMessage(error);
    return { ok: false, code: launchError, message: errorMessage(error) };
  }
}

async function startAutomatically(): Promise<void> {
  await load();
  startIdleWhisper();
  if (!settings.pet.enabled || !settings.pet.autoStart) {
    await closeOverlay();
    return;
  }
  const opened = await openPet();
  if (opened.ok) return;
  // 浮层授权或系统权限未开启时保持安静：用户在插件详情授权后再打开设置页即可重新显示。
  if (launchError !== 'OVERLAY_NOT_AUTHORIZED' && launchError !== 'OVERLAY_SYSTEM_PERMISSION_MISSING') {
    emit('pet.error', { code: launchError || 'OVERLAY_FAILED', message: launchError });
  }
}

async function play(animation: PetAnimation, text?: string): Promise<void> {
  await load();
  if (state.sleeping && !['sleepStart', 'sleepLoop', 'sleepEnd'].includes(animation)) {
    throw new Error('桌宠正在睡觉，请先叫醒它');
  }
  if (!overlayId) {
    const opened = await openPet();
    if (!opened.ok) throw new Error(opened.message || opened.code || '桌宠浮层不可用');
  }
  await publishState(animation, text);
}

async function say(text: string, animation?: PetAnimation): Promise<void> {
  await play(animation ?? 'say', text);
}

const handlers: Record<string, PluginHandler> = {
  'hooks.boot': async () => {
    await startAutomatically();
    return { ok: true, overlay: overlayId, error: launchError || undefined };
  },

  'hooks.enabled': async () => {
    await startAutomatically();
    return { ok: true };
  },

  'hooks.runStarted': async () => {
    await load();
    state.runActive = true;
    state.toolsActive = 0;
    if (!overlayId) return { ok: true };
    await publishState(settings.workStatusEnabled ? settings.animations.work : settings.animations.idle);
    return { ok: true };
  },

  'hooks.toolStarted': async () => {
    await load();
    state.runActive = true;
    state.toolsActive += 1;
    if (!overlayId) return { ok: true };
    await publishState(settings.workStatusEnabled ? settings.animations.work : state.lastAnimation ?? 'idle');
    return { ok: true };
  },

  'hooks.toolFinished': async (args: PluginArgs) => {
    await load();
    state.toolsActive = Math.max(0, state.toolsActive - 1);
    if (!overlayId || !settings.workStatusEnabled) return { ok: true };
    await publishState(readString(args, 'status') === 'error' ? settings.animations.error : settings.animations.action);
    return { ok: true };
  },

  'hooks.runFinished': async (args: PluginArgs) => {
    await load();
    state.runActive = false;
    state.toolsActive = 0;
    const status = readString(args, 'status', 'success');
    const succeeded = status === 'success';
    if (overlayId && settings.workStatusEnabled) {
      await publishState(succeeded ? settings.animations.success : settings.animations.error);
    }
    if (succeeded ? settings.notifyOnRunFinished : settings.notifyOnToolError) {
      await hostCall('host.notify', {
        title: `${settings.petName} · ${succeeded ? '任务完成' : '任务结束'}`,
        body: succeeded ? '这一轮已经跑完啦，可以来看看结果。' : `这一轮状态：${status}`,
        key: 'dsh-pet-run'
      }).catch(() => {});
    }
    return { ok: true };
  },

  'overlay.message': async (args: PluginArgs) => {
    await load();
    const payload =
      args.payload && typeof args.payload === 'object' ? (args.payload as Record<string, unknown>) : {};
    const type = typeof payload.type === 'string' ? payload.type : '';
    if (type === 'pet.ready') {
      await publishSettings();
      await publishState(state.lastAnimation ?? settings.animations.idle, state.lastText);
      return { ok: true };
    }
    if (type === 'pet.click') {
      if (state.sleeping) {
        await publishState('sleepLoop', '唔……我在睡觉呢。');
      } else {
        await publishState(settings.animations.click);
      }
      return { ok: true };
    }
    if (type === 'pet.dragStart') {
      return { ok: true };
    }
    if (type === 'pet.dragEnd') {
      return { ok: true };
    }
    if (type === 'pet.action') {
      const requested = typeof payload.animation === 'string' ? (payload.animation as PetAnimation) : undefined;
      await publishState(requested ?? settings.animations.action);
      return { ok: true };
    }
    if (type === 'pet.say') {
      await say(readString(payload, 'text', '嗯？'));
      return { ok: true };
    }
    if (type === 'pet.refresh') {
      await publishSettings();
      await publishState(state.lastAnimation ?? settings.animations.idle, state.lastText);
      return { ok: true };
    }
    return { ok: true };
  },

  'ui.settings.get': async () => {
    await load();
    return { settings, launchError: launchError || null };
  },

  'ui.settings.save': async (args: PluginArgs) => {
    await load();
    settings = normalizeSettings(args.settings);
    await persistSettings();
    startIdleWhisper();
    if (overlayId) {
      await publishSettings();
      await publishState(state.lastAnimation ?? settings.animations.idle, state.lastText);
    }
    return { settings };
  },

  'ui.settings.reset': async () => {
    await load();
    settings = normalizeSettings(DEFAULT_SETTINGS);
    await persistSettings();
    startIdleWhisper();
    if (overlayId) {
      await publishSettings();
      await publishState(settings.animations.idle, '');
    }
    return { settings };
  },

  'ui.pet.open': async () => openPet(),

  'ui.pet.show': async () => {
    await load();
    settings = { ...settings, pet: { ...settings.pet, enabled: true, autoStart: true } };
    await persistSettings();
    startIdleWhisper();
    return { settings };
  },

  'ui.pet.hide': async () => {
    await load();
    settings = { ...settings, pet: { ...settings.pet, enabled: false } };
    await persistSettings();
    stopIdleWhisper();
    await closeOverlay();
    return { settings };
  },

  'ui.pet.state': async () => {
    await load();
    return { settings, state, launchError: launchError || null, overlayOpen: overlayId !== null };
  },

  'ui.pet.say': async (args: PluginArgs) => {
    await say(readString(args, 'text', '你好呀。'));
    return { ok: true };
  },

  'ui.pet.play': async (args: PluginArgs) => {
    await play(readString(args, 'animation', 'action') as PetAnimation);
    return { ok: true };
  },

  'tools.say': async (args: PluginArgs) => {
    const text = readString(args, 'text');
    if (!text) throw new Error('text 不能为空');
    const animation = readString(args, 'animation', 'say') as PetAnimation;
    await say(text.slice(0, 240), animation);
    return { ok: true, text, pet: settings.petName };
  },

  'tools.play': async (args: PluginArgs) => {
    const animation = readString(args, 'animation', 'action') as PetAnimation;
    await play(animation);
    return { ok: true, animation };
  },

  'tools.sleep': async (args: PluginArgs) => {
    await load();
    const action = readString(args, 'action', 'toggle');
    const nextSleeping = action === 'sleep' ? true : action === 'wake' ? false : !state.sleeping;
    if (nextSleeping !== state.sleeping) {
      state.sleeping = nextSleeping;
      if (overlayId) {
        if (nextSleeping) {
          await publishState('sleepStart', '晚安……');
        } else {
          await publishState('sleepEnd', '我醒啦！');
        }
      }
    }
    return { ok: true, sleeping: state.sleeping };
  }
};

definePlugin({ handlers });
