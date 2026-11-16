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
  bubbleDurationMs: number;
  idleWhisper: boolean;
  whisperIntervalMinutes: number;
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
    success: PetAnimation;
    error: PetAnimation;
  };
}

export interface PetState {
  sleeping: boolean;
  runActive: boolean;
  toolsActive: number;
  lastAnimation: PetAnimation | null;
  lastText: string;
  updatedAt: number;
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
  bubbleDurationMs: 6000,
  idleWhisper: false,
  whisperIntervalMinutes: 30,
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
    success: 'success',
    error: 'error'
  }
};

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

export function normalizeSettings(raw: unknown): PetSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const petRaw = input.pet && typeof input.pet === 'object' ? (input.pet as Record<string, unknown>) : {};
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
    bubbleDurationMs: Math.min(30000, Math.max(1500, readNumber(input.bubbleDurationMs, DEFAULT_SETTINGS.bubbleDurationMs))),
    idleWhisper: readBoolean(input.idleWhisper, DEFAULT_SETTINGS.idleWhisper),
    whisperIntervalMinutes: Math.min(720, Math.max(1, readNumber(input.whisperIntervalMinutes, DEFAULT_SETTINGS.whisperIntervalMinutes))),
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
      success: readAnimation(animationsRaw.success, DEFAULT_SETTINGS.animations.success),
      error: readAnimation(animationsRaw.error, DEFAULT_SETTINGS.animations.error)
    }
  };
}
