import { definePlugin, hostCall, emit, type PluginArgs, type PluginHandler } from '@jieapi/plugin-sdk';
import {
  DEFAULT_SETTINGS,
  MOOD_DEFAULT,
  clampMood,
  normalizeSettings,
  type PetAnimation,
  type PetSettings,
  type PetState
} from './shared/settings';
import { INTERACTIONS } from './shared/voice';
import { listVoiceOptions, speak, voiceRequested } from './voiceGen';

const CONFIG_PATH = 'data://config.json';
const STATE_PATH = 'data://state.json';
const PET_SURFACE = 'pet';
const CREATE_WIDTH = 200;
const CREATE_HEIGHT = 170;
const IDLE_TURN_MIN_MS = 25_000;
const IDLE_TURN_MAX_MS = 70_000;
const MOOD_DRIFT_MS = 10 * 60_000;
const MOOD_DRIFT_STEP = 2;
const MOOD_WORK_COST = 1;

const state: PetState = {
  sleeping: false,
  runActive: false,
  toolsActive: 0,
  mood: MOOD_DEFAULT,
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
let turnTimer: ReturnType<typeof setTimeout> | null = null;
let moodTimer: ReturnType<typeof setInterval> | null = null;
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
    mood: state.mood,
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
      state.mood = typeof saved.mood === 'number' ? clampMood(saved.mood) : MOOD_DEFAULT;
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
  await postOverlay({
    type: 'pet.settings',
    settings: settingsPayload()
  });
}

async function publishState(animation?: PetAnimation, text?: string): Promise<void> {
  const changed =
    (animation !== undefined && animation !== state.lastAnimation) ||
    (text !== undefined && text !== state.lastText);
  if (animation) state.lastAnimation = animation;
  if (text !== undefined) state.lastText = text;
  if (changed) persistState();
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

function stopIdleTurn(): void {
  if (turnTimer) {
    clearTimeout(turnTimer);
    turnTimer = null;
  }
}

function stopMoodDrift(): void {
  if (moodTimer) {
    clearInterval(moodTimer);
    moodTimer = null;
  }
}

function canPoke(): boolean {
  return Boolean(overlayId) && !state.sleeping && !state.runActive;
}

function scheduleIdleTurn(): void {
  stopIdleTurn();
  if (!settings.idleTurn) return;
  const delay = IDLE_TURN_MIN_MS + Math.random() * (IDLE_TURN_MAX_MS - IDLE_TURN_MIN_MS);
  turnTimer = setTimeout(() => {
    turnTimer = null;
    scheduleIdleTurn();
    if (!canPoke()) return;
    void publishState(settings.animations.turn).catch(() => {});
  }, delay);
}

function startIdleWhisper(): void {
  stopIdleWhisper();
  if (!settings.idleWhisper) return;
  const intervalMs = Math.max(60_000, settings.whisperIntervalMinutes * 60_000);
  idleTimer = setInterval(() => {
    if (!canPoke()) return;
    void whisper().catch(() => {});
  }, intervalMs);
}

function startMoodDrift(): void {
  stopMoodDrift();
  moodTimer = setInterval(() => {
    if (state.sleeping) return;
    const before = state.mood;
    state.mood = clampMood(before + (state.mood < 50 ? MOOD_DRIFT_STEP : -MOOD_DRIFT_STEP));
    if (state.mood !== before) void publishState().catch(() => {});
  }, MOOD_DRIFT_MS);
}

function startTimers(): void {
  startIdleWhisper();
  scheduleIdleTurn();
  startMoodDrift();
}

async function whisper(): Promise<void> {
  const line = await speak(settings, 'idle', state.mood);
  await publishState(state.mood < 30 ? settings.animations.turn : settings.animations.action, line.text);
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

/**
 * 按当前开关同步浮层：关掉「启用桌宠」要真的移除窗口，
 * 由关变开时也要真的创建出来，而不是只把配置推给一个并不存在的浮层。
 */
async function applyEnabledState(reveal: boolean): Promise<{ opened: boolean; closed: boolean }> {
  if (!settings.pet.enabled) {
    stopIdleWhisper();
    stopIdleTurn();
    await closeOverlay();
    return { opened: false, closed: true };
  }
  if (overlayId) {
    await publishSettings();
    await publishState(state.lastAnimation ?? settings.animations.idle, state.lastText);
    startTimers();
    return { opened: false, closed: false };
  }
  startTimers();
  if (!reveal) return { opened: false, closed: false };
  const result = await openPet();
  return { opened: result.ok, closed: false };
}

async function startAutomatically(): Promise<void> {
  await load();
  startTimers();
  // autoStart 只决定启动时是否自动创建，不影响使用者手动显示出来的桌宠。
  if (!settings.pet.enabled) {
    await closeOverlay();
    return;
  }
  if (!settings.pet.autoStart) return;
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

async function interact(kind: string): Promise<{ ok: boolean; mood: number; text: string; source: string }> {
  const spec = INTERACTIONS[kind];
  if (!spec) throw new Error(`未知互动：${kind}`);
  await load();
  if (!overlayId) {
    const opened = await openPet();
    if (!opened.ok) throw new Error(opened.message || opened.code || '桌宠浮层不可用');
  }
  if (state.sleeping) throw new Error('桌宠正在睡觉，请先叫醒它');
  const line = await speak(settings, spec.kind, state.mood);
  state.mood = clampMood(state.mood + spec.moodDelta);
  await publishState(spec.animation, line.text);
  return { ok: true, mood: state.mood, text: line.text, source: line.source };
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

  'hooks.disabled': async () => {
    stopIdleWhisper();
    stopIdleTurn();
    stopMoodDrift();
    await closeOverlay();
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
    const animation = !settings.workStatusEnabled
      ? state.lastAnimation ?? 'idle'
      : state.toolsActive > 1
        ? settings.animations.busy
        : settings.animations.work;
    await publishState(animation);
    return { ok: true };
  },

  'hooks.toolFinished': async (args: PluginArgs) => {
    await load();
    state.toolsActive = Math.max(0, state.toolsActive - 1);
    if (!overlayId || !settings.workStatusEnabled) return { ok: true };
    const failed = readString(args, 'status') === 'error';
    state.mood = clampMood(state.mood - MOOD_WORK_COST * (failed ? 2 : 1));
    await publishState(failed ? settings.animations.error : state.toolsActive > 0 ? settings.animations.busy : settings.animations.work);
    return { ok: true };
  },

  'hooks.runFinished': async (args: PluginArgs) => {
    await load();
    state.runActive = false;
    state.toolsActive = 0;
    const status = readString(args, 'status', 'success');
    const succeeded = status === 'success';
    if (overlayId && settings.workStatusEnabled) {
      state.mood = clampMood(state.mood + (succeeded ? 6 : -4));
      const line = await speak(settings, succeeded ? 'success' : 'error', state.mood);
      await publishState(succeeded ? settings.animations.success : settings.animations.error, line.text);
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
        state.mood = clampMood(state.mood + 1);
        await publishState(settings.animations.click);
      }
      return { ok: true };
    }
    if (type === 'pet.dragStart' || type === 'pet.dragEnd') {
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
    if (type === 'pet.interact') {
      const kind = readString(payload, 'kind');
      try {
        return await interact(kind);
      } catch (error) {
        return { ok: false, message: errorMessage(error) };
      }
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
    const wasEnabled = settings.pet.enabled;
    settings = normalizeSettings(args.settings);
    await persistSettings();
    const result = await applyEnabledState(!wasEnabled && settings.pet.enabled);
    return { settings, launchError: launchError || null, overlayOpen: overlayId !== null, ...result };
  },

  'ui.settings.reset': async () => {
    await load();
    const wasEnabled = settings.pet.enabled;
    settings = normalizeSettings(DEFAULT_SETTINGS);
    await persistSettings();
    const result = await applyEnabledState(!wasEnabled && settings.pet.enabled);
    return { settings, launchError: launchError || null, overlayOpen: overlayId !== null, ...result };
  },

  'ui.voice.options': async () => listVoiceOptions(),

  'ui.pet.open': async () => openPet(),

  'ui.pet.show': async () => {
    await load();
    // 浮层页面的「设置」提示会引导到配置页，这里只恢复显示，不强制改 autoStart。
    settings = { ...settings, pet: { ...settings.pet, enabled: true } };
    await persistSettings();
    const result = await applyEnabledState(true);
    return { settings, launchError: launchError || null, overlayOpen: overlayId !== null, ...result };
  },

  'ui.pet.hide': async () => {
    await load();
    settings = { ...settings, pet: { ...settings.pet, enabled: false } };
    await persistSettings();
    stopIdleWhisper();
    stopIdleTurn();
    await closeOverlay();
    return { settings, overlayOpen: false };
  },

  'ui.pet.state': async () => {
    await load();
    return {
      settings,
      state,
      launchError: launchError || null,
      overlayOpen: overlayId !== null,
      voiceActive: voiceRequested(settings)
    };
  },

  'ui.pet.say': async () => {
    await load();
    const line = await speak(settings, 'greet', state.mood);
    await say(line.text);
    return { ok: true, text: line.text, source: line.source };
  },

  'ui.pet.play': async (args: PluginArgs) => {
    await play(readString(args, 'animation', 'action') as PetAnimation);
    return { ok: true };
  },

  'ui.pet.interact': async (args: PluginArgs) => interact(readString(args, 'kind')),

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
          const line = await speak(settings, 'sleep', state.mood);
          await publishState('sleepStart', line.text);
        } else {
          const line = await speak(settings, 'wake', state.mood);
          await publishState('sleepEnd', line.text);
        }
      }
    }
    return { ok: true, sleeping: state.sleeping };
  },

  'tools.interact': async (args: PluginArgs) => interact(readString(args, 'kind', 'headpat'))
};

definePlugin({ handlers });
