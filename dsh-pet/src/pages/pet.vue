<template>
  <div class="pet-window" :class="{ 'is-dragging': dragging, 'is-sleeping': state.sleeping }" :style="windowStyle">
    <transition name="bubble">
      <div v-if="bubbleText" class="bubble" :class="{ sleeping: state.sleeping }">
        <span class="bubble-text">{{ bubbleText }}</span>
        <button class="bubble-close" type="button" aria-label="收起气泡" @click="bubbleText = ''">×</button>
      </div>
    </transition>

    <div ref="stageEl" class="pet-stage" :style="stageStyle">
      <video
        ref="videoA"
        class="pet-video"
        :class="{ show: activeLayer === 0 }"
        muted
        playsinline
        preload="auto"
        @ended="onVideoEnded(0)"
        @error="onVideoError(0)"
      ></video>
      <video
        ref="videoB"
        class="pet-video"
        :class="{ show: activeLayer === 1 }"
        muted
        playsinline
        preload="auto"
        @ended="onVideoEnded(1)"
        @error="onVideoError(1)"
      ></video>
      <div v-if="activeLayer < 0" class="pet-placeholder" aria-hidden="true">
        <span class="eye left"></span>
        <span class="eye right"></span>
        <span class="mouth"></span>
      </div>
      <span v-if="state.sleeping" class="sleep-mark" aria-hidden="true">Z</span>
      <span v-if="state.mood <= 30" class="mood-mark" aria-hidden="true">…</span>
    </div>

    <transition name="menu">
      <div v-if="menuOpen" class="menu">
        <button type="button" @click="doInteract('headpat')">摸头</button>
        <button type="button" @click="doInteract('feed')">喂食</button>
        <button type="button" @click="toggleSleep">{{ state.sleeping ? '起床' : '睡觉' }}</button>
        <button type="button" @click="showSettingsTip">设置</button>
        <button type="button" class="hide" @click="hidePet">隐藏</button>
        <button type="button" class="close" aria-label="收起菜单" @click="closeMenu">×</button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { OverlayMessage } from '@jieapi/plugin-sdk/page';
import { ANIMATION_ASSETS } from '../shared/animations';
import {
  DEFAULT_SETTINGS,
  MOOD_DEFAULT,
  normalizeSettings,
  type PetAnimation,
  type PetSettings,
  type PetState
} from '../shared/settings';

const CREATE_WIDTH = 200;
const CREATE_HEIGHT = 200;
const BUBBLE_HEIGHT = 40;
const ACTION_HEIGHT = 30;
const SIDE_PADDING = 10;

const state = ref<PetState>({
  sleeping: false,
  runActive: false,
  toolsActive: 0,
  mood: MOOD_DEFAULT,
  lastAnimation: null,
  lastText: '',
  updatedAt: 0
});
const settings = ref<PetSettings>(DEFAULT_SETTINGS);
const bubbleText = ref('');
const menuOpen = ref(false);
const dragging = ref(false);
const activeLayer = ref(-1);
const stageEl = ref<HTMLElement | null>(null);
const videoA = ref<HTMLVideoElement | null>(null);
const videoB = ref<HTMLVideoElement | null>(null);

let currentAnimation: PetAnimation | null = null;
let switchSeq = 0;
let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let offMessage: (() => void) | null = null;
let lastWidth = 0;
let lastHeight = 0;

const assetUrls = new Map<PetAnimation, string>();
const layerAnimations: Array<PetAnimation | null> = [null, null];
const layerReady: Array<Promise<void> | null> = [null, null];

function videoOf(index: number): HTMLVideoElement | null {
  return index === 0 ? videoA.value : videoB.value;
}

function resolveAsset(animation: PetAnimation): string {
  const cached = assetUrls.get(animation);
  if (cached) return cached;
  const asset = ANIMATION_ASSETS[animation];
  // 页面在 /plugin/pages/ 下，动画资源在包内上一级的 assets/。
  const url = new URL('../' + asset.file, window.location.href).href;
  assetUrls.set(animation, url);
  return url;
}

const petSize = computed(() => settings.value.pet.size);
const petHeight = computed(() => Math.round((petSize.value * 9) / 16));
const windowWidth = computed(() => Math.max(140, Math.min(720, petSize.value + SIDE_PADDING * 2)));
const windowHeight = computed(() => Math.max(120, Math.min(1200, BUBBLE_HEIGHT + petHeight.value + ACTION_HEIGHT)));
const windowStyle = computed(() => ({
  width: windowWidth.value + 'px',
  height: windowHeight.value + 'px'
}));
const stageStyle = computed(() => ({
  left: SIDE_PADDING + 'px',
  top: BUBBLE_HEIGHT + 'px',
  width: petSize.value + 'px',
  height: petHeight.value + 'px'
}));

/** 心情低时待机动作换成东张西望，避免一直是同一段呼吸动画。 */
function idleAnimation(): PetAnimation {
  return state.value.mood <= 30 ? settings.value.animations.turn : settings.value.animations.idle;
}

function waitReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      video.removeEventListener('canplay', done);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', done);
      resolve();
    };
    video.addEventListener('canplay', done, { once: true });
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', done, { once: true });
  });
}

/** 把一个动画装进指定图层；同一动画已在该层就绪时直接复用，不重新加载。 */
function prepareLayer(index: number, animation: PetAnimation): Promise<void> {
  const video = videoOf(index);
  if (!video) return Promise.resolve();
  if (layerAnimations[index] === animation && layerReady[index]) return layerReady[index] as Promise<void>;
  const asset = ANIMATION_ASSETS[animation];
  const url = resolveAsset(animation);
  layerAnimations[index] = animation;
  video.loop = asset.loop;
  video.muted = true;
  if (video.src !== url) {
    video.src = url;
    video.load();
  }
  const ready = waitReady(video);
  layerReady[index] = ready;
  return ready;
}

async function playAnimation(animation: PetAnimation, force = false): Promise<void> {
  const asset = ANIMATION_ASSETS[animation];
  if (!asset) return;
  if (!force && animation === currentAnimation) return;
  const seq = ++switchSeq;

  let index = layerAnimations.indexOf(animation);
  if (index < 0 || !layerReady[index]) {
    index = activeLayer.value === 0 ? 1 : 0;
  }
  await prepareLayer(index, animation);
  if (seq !== switchSeq) return;

  const video = videoOf(index);
  if (!video) return;
  try {
    await video.play();
  } catch {
    return;
  }
  if (seq !== switchSeq) return;

  const previous = activeLayer.value;
  activeLayer.value = index;
  currentAnimation = animation;
  if (previous >= 0 && previous !== index) {
    window.setTimeout(() => {
      if (seq === switchSeq) videoOf(previous)?.pause();
    }, 200);
  }
}

function onVideoEnded(index: number): void {
  if (index !== activeLayer.value) return;
  const animation = currentAnimation;
  if (!animation) return;
  if (animation === 'sleepStart') {
    void playAnimation('sleepLoop');
    return;
  }
  if (animation === 'sleepEnd') {
    void playAnimation(idleAnimation());
    return;
  }
  if (['click', 'action', 'success', 'error', 'turn'].includes(animation)) {
    void playAnimation(idleAnimation());
  }
}

function onVideoError(index: number): void {
  layerAnimations[index] = null;
  layerReady[index] = null;
  if (activeLayer.value === index) {
    activeLayer.value = -1;
    currentAnimation = null;
  }
}

function parseMessage(raw: OverlayMessage): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

let audioCtx: AudioContext | null = null;

/** 点击音效用 WebAudio 现场合成，包内没有音频素材，也避免额外解码开销。 */
function playClickSound(): void {
  if (!settings.value.pet.clickSound) return;
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    // 浮层没有音频焦点时静默跳过。
  }
}

function showBubble(text: string): void {
  if (!text) return;
  bubbleText.value = text.slice(0, 240);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleText.value = '';
    bubbleTimer = null;
  }, Math.max(1500, settings.value.bubbleDurationMs));
}

/**
 * 宿主的拖拽手柄会盖在页面声明的拖拽区域上并吃掉触摸，只把手势通过消息回传。
 * 手柄尺寸不能为 0（宿主会报 PARAM_INVALID），菜单展开时缩成一条 1px 的细缝，
 * 把整个窗口的触摸都还给页面。
 */
async function updateDragRegion(): Promise<void> {
  const stage = stageEl.value;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const region = menuOpen.value
    ? { left: rect.left, top: rect.top, width: 1, height: 1 }
    : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  await aicode.overlay.setDragRegion(region).catch(() => {});
}

async function applySize(): Promise<void> {
  if (lastWidth === windowWidth.value && lastHeight === windowHeight.value) return;
  lastWidth = windowWidth.value;
  lastHeight = windowHeight.value;
  await aicode.overlay.resize(windowWidth.value, windowHeight.value).catch(() => {});
  await updateDragRegion();
}

async function applySettings(next: PetSettings): Promise<void> {
  settings.value = normalizeSettings(next);
  await nextTick();  // 桌宠浮层始终悬浮在其它应用之上，设置关掉「置顶」时退回仅 App 前台可见。
  await aicode.overlay
    .setVisibilityPolicy(settings.value.pet.alwaysOnTop ? 'always' : 'foreground')
    .catch(() => {});
  await applySize();
  if (currentAnimation === null || !ANIMATION_ASSETS[currentAnimation]) {
    await playAnimation(idleAnimation(), true);
  }
}

function applyState(next: PetState): void {
  const previous = state.value;
  const animationChanged = next.lastAnimation !== previous.lastAnimation;
  const textChanged = (next.lastText || '') !== (previous.lastText || '');
  const moodDropped = typeof next.mood === 'number' && next.mood <= 30 && previous.mood > 30;
  state.value = {
    sleeping: next.sleeping === true,
    runActive: next.runActive === true,
    toolsActive: typeof next.toolsActive === 'number' ? next.toolsActive : 0,
    mood: typeof next.mood === 'number' ? next.mood : MOOD_DEFAULT,
    lastAnimation: (next.lastAnimation as PetAnimation | null) ?? null,
    lastText: typeof next.lastText === 'string' ? next.lastText : '',
    updatedAt: typeof next.updatedAt === 'number' ? next.updatedAt : Date.now()
  };
  if (textChanged && state.value.lastText) showBubble(state.value.lastText);
  if (animationChanged && state.value.lastAnimation) {
    void playAnimation(state.value.lastAnimation, true);
  } else if (moodDropped && !state.value.runActive && !state.value.sleeping) {
    void playAnimation(settings.value.animations.turn);
  }
}

function onMessage(raw: OverlayMessage): void {
  const message = parseMessage(raw);
  if (message.type === 'pet.settings' && message.settings) {
    void applySettings(message.settings as PetSettings);
  } else if (message.type === 'pet.state' && message.state) {
    applyState(message.state as PetState);
  } else if (message.type === 'click') {
    menuOpen.value = false;
    if (state.value.sleeping) {
      showBubble('唔……我在睡觉呢。');
    } else {
      playClickSound();
      void aicode.overlay.postMessage({ type: 'pet.click' }).catch(() => {});
    }
  } else if (message.type === 'longPress') {
    openMenu();
  } else if (message.type === 'dragStart') {
    closeMenu();
    dragging.value = true;
  } else if (message.type === 'dragEnd') {
    dragging.value = false;
  } else if (message.type === 'snap') {
    document.body.dataset.edge = String(message.edge ?? '');
  } else if (message.type === 'appState' && message.foreground === true) {
    closeMenu();
  }
}

function openMenu(): void {
  menuOpen.value = true;
  void updateDragRegion();
}

function closeMenu(): void {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  void updateDragRegion();
}

/**
 * 浮层桥只提供 overlay.* / context / app.isForeground，没有 plugin.invoke，
 * 需要副作用时一律用 overlay.postMessage 交给插件进程的 overlay.message。
 */
function request(type: string, extra: Record<string, unknown> = {}): void {
  void aicode.overlay.postMessage({ type, ...extra }).catch(() => {});
}

async function doInteract(kind: 'headpat' | 'feed'): Promise<void> {
  closeMenu();
  request('pet.interact', { kind });
}
async function toggleSleep(): Promise<void> {
  closeMenu();
  request('pet.toggleSleep');
}

async function showSettingsTip(): Promise<void> {
  closeMenu();
  bubbleText.value = '';
  showBubble('在「设置 → 插件 → AiCode 桌宠 → 插件配置」里修改设置。');
}

async function hidePet(): Promise<void> {
  closeMenu();
  request('pet.hide');
}

onMounted(async () => {
  offMessage = aicode.overlay.onMessage(onMessage);
  await applySize();
  await prepareLayer(0, settings.value.animations.idle);
  await prepareLayer(1, settings.value.animations.drag);
  void aicode.overlay.postMessage({ type: 'pet.ready' }).catch(() => {});
});

onBeforeUnmount(() => {
  if (offMessage) offMessage();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  void audioCtx?.close().catch(() => {});
  audioCtx = null;
  videoA.value?.pause();
  videoB.value?.pause();
  videoA.value?.removeAttribute('src');
  videoB.value?.removeAttribute('src');
});
</script>

<style>
html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  color: var(--aicode-on-surface);
  font-family: var(--aicode-font-sans, system-ui, sans-serif);
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

* {
  box-sizing: border-box;
}

button {
  font: inherit;
}

.pet-window {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.pet-window.is-dragging .pet-placeholder,
.pet-window.is-dragging .sleep-mark {
  animation-play-state: paused;
}

.bubble {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 0;
  z-index: 3;
  min-height: 30px;
  max-height: 38px;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 12px;
  background: var(--aicode-surface);
  color: var(--aicode-on-surface);
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.18);
  font-size: calc(12px * var(--aicode-font-scale));
  line-height: 1.35;
}

.bubble.sleeping {
  opacity: 0.88;
}

.bubble-text {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.bubble-close {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--aicode-on-surface-variant);
  font-size: 14px;
  line-height: 18px;
  cursor: pointer;
}

.pet-stage {
  position: absolute;
  overflow: visible;
  touch-action: none;
}

/* 无过渡：两帧直接切换，避免透明浮层上出现半透明残影。 */
.pet-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  background: transparent;
  opacity: 0;
}

.pet-video.show {
  opacity: 1;
}

.pet-placeholder {
  position: absolute;
  left: 50%;
  top: 54%;
  width: 52%;
  height: 40%;
  transform: translate(-50%, -50%);
  border-radius: 46% 46% 44% 44% / 52% 52% 48% 48%;
  background: linear-gradient(160deg, #9ec5ff 0%, #6f9cf5 58%, #5a86e6 100%);
  box-shadow: inset 0 -6px 14px rgba(30, 60, 130, 0.22), 0 6px 16px rgba(40, 70, 140, 0.22);
  animation: pet-breathe 3.2s ease-in-out infinite;
  pointer-events: none;
}

.pet-placeholder .eye {
  position: absolute;
  top: 38%;
  width: 11%;
  height: 16%;
  border-radius: 50%;
  background: #1d2b4d;
  animation: pet-blink 4.8s ease-in-out infinite;
}

.pet-placeholder .eye.left {
  left: 27%;
}

.pet-placeholder .eye.right {
  right: 27%;
}

.pet-placeholder .mouth {
  position: absolute;
  left: 50%;
  top: 60%;
  width: 18%;
  height: 9%;
  transform: translateX(-50%);
  border-bottom: 2px solid #1d2b4d;
  border-radius: 0 0 50% 50%;
}

.sleep-mark {
  position: absolute;
  right: 4px;
  top: -6px;
  color: var(--aicode-primary);
  font-size: calc(18px * var(--aicode-font-scale));
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  animation: sleep-float 2.6s ease-in-out infinite;
}

.mood-mark {
  position: absolute;
  left: 2px;
  top: -4px;
  color: var(--aicode-on-surface-variant);
  font-size: calc(16px * var(--aicode-font-scale));
  font-weight: 700;
}

/* 拖动时只做一点极淡的整体下沉，不在脚下画任何线条。 */
.pet-window.is-dragging .pet-stage {
  transform: translateY(-2px);
}

/* 菜单固定在宠物下方的整行，落在拖拽区域之外，展开时也不会被手柄挡住。 */
.menu {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 4px;
  height: 30px;
  display: flex;
  gap: 4px;
}

.menu button {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 2px;
  border: 0;
  border-radius: 9px;
  background: rgba(20, 24, 34, 0.82);
  color: #fff;
  font-size: 12px;
  line-height: 30px;
  white-space: nowrap;
  cursor: pointer;
}

.menu button.hide {
  background: rgba(170, 44, 56, 0.86);
}

.menu button.close {
  flex: none;
  width: 26px;
  background: rgba(20, 24, 34, 0.56);
  font-size: 15px;
}

.bubble-enter-active,
.bubble-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(3px);
}

@keyframes pet-breathe {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.04, 0.97);
  }
}

@keyframes pet-blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }
  95% {
    transform: scaleY(0.1);
  }
}

@keyframes sleep-float {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.65;
  }
  50% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bubble-enter-active,
  .bubble-leave-active,
  .menu-enter-active,
  .menu-leave-active {
    transition: none;
  }
  .sleep-mark,
  .pet-placeholder,
  .pet-placeholder .eye {
    animation: none;
  }
}
</style>
