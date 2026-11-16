<template>
  <div class="pet-window" :class="{ 'is-dragging': dragging }" :style="windowStyle">
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
      <span v-if="dragging" class="drag-mark" aria-hidden="true">~</span>
    </div>

    <div class="action-bar">
      <transition name="menu">
        <div v-if="menuOpen" class="menu">
          <button type="button" @click="doSay">说话</button>
          <button type="button" @click="doAction">玩耍</button>
          <button type="button" @click="toggleSleep">{{ state.sleeping ? '起床' : '睡觉' }}</button>
          <button type="button" @click="showSettingsTip">设置</button>
          <button type="button" class="hide" @click="hidePet">隐藏</button>
          <button type="button" class="close" aria-label="收起菜单" @click="menuOpen = false">×</button>
        </div>
      </transition>
      <button
        v-if="!menuOpen"
        class="menu-toggle"
        type="button"
        aria-label="桌宠菜单"
        @click="menuOpen = true"
      >···</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { OverlayMessage } from '@jieapi/plugin-sdk/page';
import { ANIMATION_ASSETS } from '../shared/animations';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PetAnimation,
  type PetSettings,
  type PetState
} from '../shared/settings';

const CREATE_WIDTH = 200;
const CREATE_HEIGHT = 170;
const BUBBLE_HEIGHT = 40;
const ACTION_HEIGHT = 26;
const SIDE_PADDING = 10;

const state = ref<PetState>({
  sleeping: false,
  runActive: false,
  toolsActive: 0,
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

const whispers = [
  '主人今天也要好好休息哦。',
  '有点无聊，陪我玩一会儿嘛。',
  '写代码别忘了喝水呀。',
  '我在这儿看着你呢。',
  '要不要摸摸我的头？'
];
let whisperIndex = 0;

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
    void playAnimation(settings.value.animations.idle);
    return;
  }
  if (['click', 'action', 'success', 'error'].includes(animation)) {
    void playAnimation(settings.value.animations.idle);
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

function showBubble(text: string): void {
  if (!text) return;
  bubbleText.value = text.slice(0, 240);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleText.value = '';
    bubbleTimer = null;
  }, Math.max(1500, settings.value.bubbleDurationMs));
}

async function updateDragRegion(): Promise<void> {
  const stage = stageEl.value;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  await aicode.overlay
    .setDragRegion({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    .catch(() => {});
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
  await nextTick();
  await applySize();
  if (currentAnimation === null || !ANIMATION_ASSETS[currentAnimation]) {
    await playAnimation(settings.value.animations.idle, true);
  }
}

function applyState(next: PetState): void {
  const previous = state.value;
  const animationChanged = next.lastAnimation !== previous.lastAnimation;
  const textChanged = (next.lastText || '') !== (previous.lastText || '');
  state.value = {
    sleeping: next.sleeping === true,
    runActive: next.runActive === true,
    toolsActive: typeof next.toolsActive === 'number' ? next.toolsActive : 0,
    lastAnimation: (next.lastAnimation as PetAnimation | null) ?? null,
    lastText: typeof next.lastText === 'string' ? next.lastText : '',
    updatedAt: typeof next.updatedAt === 'number' ? next.updatedAt : Date.now()
  };
  if (textChanged && state.value.lastText) showBubble(state.value.lastText);
  if (animationChanged && state.value.lastAnimation) void playAnimation(state.value.lastAnimation, true);
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
      void aicode.overlay.postMessage({ type: 'pet.click' }).catch(() => {});
    }
  } else if (message.type === 'longPress') {
    menuOpen.value = true;
  } else if (message.type === 'dragStart') {
    menuOpen.value = false;
    dragging.value = true;
  } else if (message.type === 'dragEnd') {
    dragging.value = false;
  } else if (message.type === 'snap') {
    document.body.dataset.edge = String(message.edge ?? '');
  } else if (message.type === 'appState' && message.foreground === true) {
    menuOpen.value = false;
  }
}

async function doSay(): Promise<void> {
  menuOpen.value = false;
  const text = whispers[whisperIndex % whispers.length];
  whisperIndex += 1;
  await aicode.invoke('ui.pet.say', { text }).catch(() => {});
}

async function doAction(): Promise<void> {
  menuOpen.value = false;
  await aicode.invoke('ui.pet.play', { animation: 'action' }).catch(() => {});
}

async function toggleSleep(): Promise<void> {
  menuOpen.value = false;
  await aicode.invoke('tools.sleep', { action: 'toggle' }).catch(() => {});
}

async function showSettingsTip(): Promise<void> {
  menuOpen.value = false;
  await aicode
    .tip({ text: '在「设置 → 插件 → AiCode 桌宠 → 插件配置」里修改桌宠设置。' })
    .catch(() => {});
}

async function hidePet(): Promise<void> {
  menuOpen.value = false;
  await aicode.invoke('ui.pet.hide').catch(() => {});
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
.pet-window.is-dragging .sleep-mark,
.pet-window.is-dragging .drag-mark {
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

.drag-mark {
  position: absolute;
  left: 50%;
  bottom: -2px;
  transform: translateX(-50%);
  color: var(--aicode-primary);
  font-size: 16px;
  font-weight: 700;
}

.action-bar {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  pointer-events: none;
}

.menu-toggle {
  pointer-events: auto;
  width: 30px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: rgba(20, 24, 34, 0.42);
  color: #fff;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

.menu {
  width: 100%;
  display: flex;
  gap: 4px;
  pointer-events: auto;
}

.menu button {
  flex: 1;
  height: 24px;
  padding: 0 4px;
  border: 0;
  border-radius: 7px;
  background: rgba(20, 24, 34, 0.7);
  color: #fff;
  font-size: 10px;
  line-height: 24px;
  white-space: nowrap;
  cursor: pointer;
}

.menu button.hide {
  background: rgba(160, 40, 50, 0.78);
}

.menu button.close {
  flex: none;
  width: 24px;
  background: rgba(20, 24, 34, 0.5);
  font-size: 14px;
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
