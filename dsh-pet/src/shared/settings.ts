export type PetAnimation =
  | 'idle'
  | 'turn'
  | 'click'
  | 'drag'
  | 'action'
  | 'sleepStart'
  | 'sleepLoop'
  | 'sleepEnd'
  | 'thinking'
  | 'working'
  | 'success'
  | 'error'
  | 'say';

/** 台词来源：auto 用已配置模型按人设生成，canned 只用内置语料。 */
export type VoiceMode = 'auto' | 'canned';

/** TTS 供应商：openai 兼容接口（含 xAI/DeepSeek 等），或 Google Gemini。 */
export type TtsProvider = 'none' | 'openai' | 'gemini';

export interface TtsSettings {
  provider: TtsProvider;
  /**
   * 跟随哪套供应商：
   * - follow：沿用「生成台词」的供应商
   * - custom：自定义地址与密钥（可指向任意兼容服务）
   */
  source: 'follow' | 'custom';
  /** API 地址；留空使用供应商默认域名。 */
  baseUrl: string;
  model: string;
  voice: string;
  /** 密钥存放在宿主加密存储里，这里只记键名与是否存在。 */
  hasKey: boolean;
  /** 0.5–2.0，1.0 为正常语速。 */
  speed: number;
}

export interface VoiceSettings {
  mode: VoiceMode;
  /** 空字符串表示自动挑选可用供应商与模型。 */
  providerId: string;
  model: string;
  /** 台词生成后自动朗读。 */
  speakAloud: boolean;
  tts: TtsSettings;
}

export interface PetSettings {
  pet: {
    enabled: boolean;
    autoStart: boolean;
    size: number;
    alwaysOnTop: boolean;
    clickSound: boolean;
  };
  petName: string;
  persona: string;
  voice: VoiceSettings;
  bubbleDurationMs: number;
  idleWhisper: boolean;
  whisperIntervalMinutes: number;
  idleTurn: boolean;
  notifyOnRunFinished: boolean;
  notifyOnToolError: boolean;
  workStatusEnabled: boolean;
  animations: {
    idle: PetAnimation;
    turn: PetAnimation;
    click: PetAnimation;
    drag: PetAnimation;
    action: PetAnimation;
    work: PetAnimation;
    busy: PetAnimation;
    success: PetAnimation;
    error: PetAnimation;
  };
}

export interface PetState {
  sleeping: boolean;
  runActive: boolean;
  toolsActive: number;
  mood: number;
  lastAnimation: PetAnimation | null;
  lastText: string;
  updatedAt: number;
}

/** 进程合成完成后推给浮层播放的语音。 */
export interface SpeechAudio {
  /** data URL，CSP 的 media-src 已允许 data:。 */
  url: string;
  mimeType: string;
  durationHintMs: number;
}

export interface PetSettingsMessage {
  type: 'pet.settings';
  settings: PetSettings;
}

export interface PetStateMessage {
  type: 'pet.state';
  state: PetState;
}

export type PetOverlayMessage = PetSettingsMessage | PetStateMessage;

export const DEFAULT_SETTINGS: PetSettings = {
  pet: {
    enabled: true,
    autoStart: true,
    size: 200,
    alwaysOnTop: true,
    clickSound: false
  },
  petName: '蓝毛小女仆',
  persona: '你是主人手机上的 Q 版蓝发小女仆桌宠。说话温柔、俏皮、简短，不提自己是 AI。',
  voice: {
    mode: 'auto',
    providerId: '',
    model: '',
    speakAloud: false,
    tts: {
      provider: 'none',
      source: 'follow',
      baseUrl: '',
      model: '',
      voice: '',
      hasKey: false,
      speed: 1
    }
  },
  bubbleDurationMs: 6000,
  idleWhisper: false,
  whisperIntervalMinutes: 30,
  idleTurn: true,
  notifyOnRunFinished: true,
  notifyOnToolError: true,
  workStatusEnabled: true,
  animations: {
    idle: 'idle',
    turn: 'turn',
    click: 'click',
    drag: 'drag',
    action: 'action',
    work: 'thinking',
    busy: 'working',
    success: 'success',
    error: 'error'
  }
};

export const MOOD_MIN = 0;
export const MOOD_MAX = 100;
export const MOOD_DEFAULT = 70;

const CLAMP_MIN = 140;
const CLAMP_MAX = 320;

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readAnimation(value: unknown, fallback: PetAnimation): PetAnimation {
  const allowed: PetAnimation[] = [
    'idle',
    'turn',
    'click',
    'drag',
    'action',
    'sleepStart',
    'sleepLoop',
    'sleepEnd',
    'thinking',
    'working',
    'success',
    'error',
    'say'
  ];
  return allowed.includes(value as PetAnimation) ? (value as PetAnimation) : fallback;
}

export function clampMood(value: number): number {
  return Math.min(MOOD_MAX, Math.max(MOOD_MIN, Math.round(value)));
}

function readTtsProvider(value: unknown, fallback: TtsProvider): TtsProvider {
  return value === 'openai' || value === 'gemini' || value === 'none' ? value : fallback;
}

function normalizeTts(raw: unknown): TtsSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    provider: readTtsProvider(input.provider, DEFAULT_SETTINGS.voice.tts.provider),
    source: input.source === 'custom' ? 'custom' : 'follow',
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '',
    model: typeof input.model === 'string' ? input.model.trim() : '',
    voice: typeof input.voice === 'string' ? input.voice.trim() : '',
    hasKey: readBoolean(input.hasKey, false),
    speed: Math.min(2, Math.max(0.5, readNumber(input.speed, DEFAULT_SETTINGS.voice.tts.speed)))
  };
}

export function normalizeSettings(raw: unknown): PetSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const petRaw = input.pet && typeof input.pet === 'object' ? (input.pet as Record<string, unknown>) : {};
  const voiceRaw = input.voice && typeof input.voice === 'object' ? (input.voice as Record<string, unknown>) : {};
  const animationsRaw =
    input.animations && typeof input.animations === 'object'
      ? (input.animations as Record<string, unknown>)
      : {};
  return {
    pet: {
      enabled: readBoolean(petRaw.enabled, DEFAULT_SETTINGS.pet.enabled),
      autoStart: readBoolean(petRaw.autoStart, DEFAULT_SETTINGS.pet.autoStart),
      size: Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, Math.round(readNumber(petRaw.size, DEFAULT_SETTINGS.pet.size)))),
      alwaysOnTop: readBoolean(petRaw.alwaysOnTop, DEFAULT_SETTINGS.pet.alwaysOnTop),
      clickSound: readBoolean(petRaw.clickSound, DEFAULT_SETTINGS.pet.clickSound)
    },
    petName: readText(input.petName, DEFAULT_SETTINGS.petName),
    persona: readText(input.persona, DEFAULT_SETTINGS.persona),
    voice: {
      mode: voiceRaw.mode === 'canned' ? 'canned' : 'auto',
      providerId: typeof voiceRaw.providerId === 'string' ? voiceRaw.providerId : '',
      model: typeof voiceRaw.model === 'string' ? voiceRaw.model : '',
      speakAloud: readBoolean(voiceRaw.speakAloud, DEFAULT_SETTINGS.voice.speakAloud),
      tts: normalizeTts(voiceRaw.tts)
    },
    bubbleDurationMs: Math.min(30000, Math.max(1500, readNumber(input.bubbleDurationMs, DEFAULT_SETTINGS.bubbleDurationMs))),
    idleWhisper: readBoolean(input.idleWhisper, DEFAULT_SETTINGS.idleWhisper),
    whisperIntervalMinutes: Math.min(720, Math.max(1, readNumber(input.whisperIntervalMinutes, DEFAULT_SETTINGS.whisperIntervalMinutes))),
    idleTurn: readBoolean(input.idleTurn, DEFAULT_SETTINGS.idleTurn),
    notifyOnRunFinished: readBoolean(input.notifyOnRunFinished, DEFAULT_SETTINGS.notifyOnRunFinished),
    notifyOnToolError: readBoolean(input.notifyOnToolError, DEFAULT_SETTINGS.notifyOnToolError),
    workStatusEnabled: readBoolean(input.workStatusEnabled, DEFAULT_SETTINGS.workStatusEnabled),
    animations: {
      idle: readAnimation(animationsRaw.idle, DEFAULT_SETTINGS.animations.idle),
      turn: readAnimation(animationsRaw.turn, DEFAULT_SETTINGS.animations.turn),
      click: readAnimation(animationsRaw.click, DEFAULT_SETTINGS.animations.click),
      drag: readAnimation(animationsRaw.drag, DEFAULT_SETTINGS.animations.drag),
      action: readAnimation(animationsRaw.action, DEFAULT_SETTINGS.animations.action),
      work: readAnimation(animationsRaw.work, DEFAULT_SETTINGS.animations.work),
      busy: readAnimation(animationsRaw.busy, DEFAULT_SETTINGS.animations.busy),
      success: readAnimation(animationsRaw.success, DEFAULT_SETTINGS.animations.success),
      error: readAnimation(animationsRaw.error, DEFAULT_SETTINGS.animations.error)
    }
  };
}
