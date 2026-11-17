<template>
  <div class="aicode-page">
    <header class="aicode-page-header">
      <h1 class="aicode-page-title">桌宠设置</h1>
      <aicode-badge text="AiCode 浮层" kind="plugin" />
    </header>

    <aicode-group title="显示">
      <setting-switch v-model="settings.pet.enabled" title="启用桌宠" subtitle="关闭后会移除系统悬浮窗，配置仍保留" @update:model-value="save" />
      <aicode-divider />
      <setting-switch v-model="settings.pet.autoStart" title="随 App 启动" subtitle="打开 AiCode 时自动创建桌宠浮层" @update:model-value="save" />
      <aicode-divider />
      <setting-switch v-model="settings.pet.alwaysOnTop" title="始终置顶" subtitle="关闭后桌宠只在 AiCode 位于前台时显示" @update:model-value="save" />
      <aicode-divider />
      <setting-switch v-model="settings.pet.clickSound" title="点击音效" subtitle="点一下桌宠时播放合成的提示音" @update:model-value="save" />
      <aicode-divider />
      <div class="slider-row">
        <div class="slider-head">
          <span>桌宠宽度</span>
          <span class="value">{{ settings.pet.size }} dp</span>
        </div>
        <input v-model.number="settings.pet.size" type="range" min="140" max="320" step="10" @change="save" />
      </div>
    </aicode-group>

    <aicode-group title="身份与说话">
      <aicode-field label="桌宠名字">
        <aicode-input v-model="settings.petName" placeholder="蓝毛小女仆" @blur="save" />
      </aicode-field>
      <aicode-field label="人设">
        <aicode-textarea v-model="settings.persona" placeholder="决定桌宠用什么口吻说话" @blur="save" />
      </aicode-field>
      <aicode-divider />
      <setting-switch
        :model-value="settings.voice.mode === 'auto'"
        title="用模型生成台词"
        subtitle="按人设生成碎碎念与状态反馈；关闭后只用内置语料"
        @update:model-value="toggleVoice"
      />
      <template v-if="settings.voice.mode === 'auto'">
        <aicode-divider />
        <button class="setting-line" type="button" @click="openModelPicker">
          <span class="setting-text">
            <span class="setting-title">供应商</span>
            <span class="setting-subtitle">{{ providerSubtitle }}</span>
          </span>
          <span class="setting-action">选择</span>
        </button>
      </template>
      <div class="actions">
        <aicode-button variant="primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </aicode-button>
        <aicode-button :disabled="busy" @click="sayHello">让它说句话</aicode-button>
      </div>
    </aicode-group>

    <aicode-group title="运行状态联动">
      <setting-switch v-model="settings.workStatusEnabled" title="跟随 AI 运行状态" subtitle="思考、工具执行、完成或出错时切换动作" @update:model-value="save" />
      <aicode-divider />
      <setting-switch v-model="settings.notifyOnRunFinished" title="任务完成后通知" subtitle="AI 一轮对话结束且成功时发送系统通知" @update:model-value="save" />
      <aicode-divider />
      <setting-switch v-model="settings.notifyOnToolError" title="任务异常时通知" subtitle="失败、取消或工具出错时发送系统通知" @update:model-value="save" />
    </aicode-group>

    <aicode-group title="气泡">
      <setting-switch v-model="settings.idleTurn" title="空闲时东张西望" subtitle="没有任务时偶尔换成左右张望的待机动作" @update:model-value="save" />
      <aicode-divider />
      <div class="slider-row">
        <div class="slider-head">
          <span>气泡停留时间</span>
          <span class="value">{{ Math.round(settings.bubbleDurationMs / 1000) }} 秒</span>
        </div>
        <input v-model.number="settings.bubbleDurationMs" type="range" min="1500" max="15000" step="500" @change="save" />
      </div>
      <aicode-divider />
      <setting-switch v-model="settings.idleWhisper" title="自动碎碎念" subtitle="空闲时按固定间隔说一句" @update:model-value="save" />
      <aicode-divider />
      <aicode-field label="碎碎念间隔（分钟）">
        <aicode-input v-model.number="settings.whisperIntervalMinutes" type="number" @blur="save" />
      </aicode-field>
    </aicode-group>

    <aicode-group title="互动与快捷操作">
      <div class="quick-actions">
        <aicode-button :disabled="busy" @click="interact('headpat')">摸摸头</aicode-button>
        <aicode-button :disabled="busy" @click="interact('feed')">喂点心</aicode-button>
        <aicode-button :disabled="busy" @click="playAction">播放动作</aicode-button>
        <aicode-button :disabled="busy" @click="toggleSleep">{{ sleeping ? '叫醒桌宠' : '哄它睡觉' }}</aicode-button>
        <aicode-button v-if="settings.pet.enabled" :disabled="busy" @click="hidePet">隐藏桌宠</aicode-button>
        <aicode-button v-else :disabled="busy" @click="showPet">显示桌宠</aicode-button>
      </div>
      <aicode-divider />
      <aicode-info-row label="当前状态" :value="statusSubtitle" />
      <aicode-divider />
      <aicode-info-row label="心情值" :value="`${petState.mood} / 100`" />
      <aicode-divider />
      <aicode-info-row label="插件数据" :value="ctx ? ctx.dataDir : '加载中…'" />
      <aicode-divider />
      <aicode-info-row label="操作方式" value="点击回应、长按打开菜单、拖动换位置" />
    </aicode-group>

    <div class="footer-actions">
      <aicode-button :disabled="busy" @click="reset">恢复默认设置</aicode-button>
      <aicode-button variant="danger" :disabled="busy" @click="confirmOpen = true">重置并隐藏</aicode-button>
    </div>

    <aicode-dialog v-model="confirmOpen" title="恢复默认设置" message="会重置所有外观、人设和通知选项，桌宠浮层也会按默认配置重新创建。" @confirm="reset" />

    <aicode-dialog v-model="modelPickerOpen" title="选择说话用的模型" confirm-text="确定" :confirm-disabled="voiceDraft.providerId === ''" @confirm="applyModelChoice">
      <aicode-field label="供应商">
        <aicode-select v-model="voiceDraft.providerId" :options="providerOptions" @update:model-value="onProviderChange" />
      </aicode-field>
      <aicode-field label="模型">
        <aicode-select v-model="voiceDraft.model" :options="modelOptions" />
      </aicode-field>
      <p v-if="voiceHint" class="voice-hint">{{ voiceHint }}</p>
    </aicode-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, resolveComponent } from 'vue';
import type { AicodePageContext, AicodeEvent } from '@jieapi/plugin-sdk/page';
import {
  DEFAULT_SETTINGS,
  MOOD_DEFAULT,
  normalizeSettings,
  type PetSettings,
  type PetState
} from '../shared/settings';

/**
 * 宿主的 aicode-row 只渲染 title/subtitle 等 props，不渲染默认插槽，
 * 因此开关必须和标题写在同一行内，不能塞进 aicode-row。
 */
const SettingSwitch = defineComponent({
  name: 'SettingSwitch',
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const Switch = resolveComponent('aicode-switch');
    return () =>
      h('div', { class: 'setting-line' }, [
        h('span', { class: 'setting-text' }, [
          h('span', { class: 'setting-title' }, props.title),
          props.subtitle ? h('span', { class: 'setting-subtitle' }, props.subtitle) : null
        ]),
        h(Switch, {
          modelValue: props.modelValue,
          disabled: props.disabled,
          'onUpdate:modelValue': (value: boolean) => emit('update:modelValue', value)
        })
      ]);
  }
});

interface SettingsResult {
  settings?: PetSettings;
  launchError?: string | null;
  overlayOpen?: boolean;
}

interface StateResult {
  settings?: PetSettings;
  state?: PetState;
  launchError?: string | null;
  overlayOpen?: boolean;
  voiceActive?: boolean;
}

interface OpenResult {
  ok: boolean;
  overlayId?: string;
  code?: string;
  message?: string;
}

interface VoiceModel {
  id: string;
  displayName: string;
  modelType: string;
}

interface VoiceOptionsResult {
  providers?: Array<{ id: string; name: string; models: VoiceModel[] }>;
  error?: string | null;
}

const ctx = ref<AicodePageContext | null>(null);
const settings = ref<PetSettings>(normalizeSettings(DEFAULT_SETTINGS));
const petState = ref<PetState>({
  sleeping: false,
  runActive: false,
  toolsActive: 0,
  mood: MOOD_DEFAULT,
  lastAnimation: null,
  lastText: '',
  updatedAt: 0
});
const saving = ref(false);
const busy = ref(false);
const confirmOpen = ref(false);
const modelPickerOpen = ref(false);
const voiceOptions = ref<Array<{ id: string; name: string; models: VoiceModel[] }>>([]);
const voiceHint = ref('');
const voiceDraft = ref({ providerId: '', model: '' });
const status = ref('');
let offEvents: (() => void) | null = null;

const sleeping = computed(() => petState.value.sleeping);
const providerOptions = computed(() => [
  { value: '', label: '未选择' },
  ...voiceOptions.value.map((provider) => ({ value: provider.id, label: provider.name }))
]);
const modelOptions = computed(() => [
  { value: '', label: '使用该供应商的默认模型' },
  ...(voiceOptions.value.find((provider) => provider.id === voiceDraft.value.providerId)?.models ?? []).map(
    (model) => ({ value: model.id, label: model.displayName || model.id })
  )
]);
const providerSubtitle = computed(() => {
  const { providerId, model } = settings.value.voice;
  if (!providerId) return '自动挑选已配置的默认供应商';
  const provider = voiceOptions.value.find((item) => item.id === providerId);
  const name = provider?.name ?? providerId;
  return model ? `${name} · ${model}` : `${name} · 默认模型`;
});
const statusSubtitle = computed(() => {
  const parts: string[] = [];
  if (petState.value.sleeping) parts.push('睡眠中');
  if (petState.value.runActive) parts.push('AI 运行中');
  if (petState.value.toolsActive > 0) parts.push(`${petState.value.toolsActive} 个工具执行中`);
  if (parts.length === 0) parts.push('空闲');
  if (petState.value.lastText) parts.push(petState.value.lastText);
  if (status.value) parts.push(status.value);
  return parts.join(' · ');
});

function applyResult(result: SettingsResult | undefined): void {
  if (result?.settings) settings.value = normalizeSettings(result.settings);
}

function launchHint(code: string): string {
  if (code === 'OVERLAY_NOT_AUTHORIZED') return '尚未在插件详情中开启悬浮窗授权';
  if (code === 'OVERLAY_SYSTEM_PERMISSION_MISSING') return '系统尚未允许 AiCode 显示在其他应用上层';
  return '桌宠浮层暂不可用：' + code;
}

async function loadVoiceOptions(): Promise<void> {
  try {
    const result = await aicode.invoke<VoiceOptionsResult>('ui.voice.options');
    voiceOptions.value = result?.providers ?? [];
    voiceHint.value = result?.error ? '读取供应商失败：' + result.error : '';
  } catch (error) {
    voiceHint.value = '读取供应商失败：' + (error as Error).message;
  }
}

async function load(): Promise<void> {
  try {
    const context = await aicode.context();
    if ('overlayId' in context) return;
    ctx.value = context;
    const result = await aicode.invoke<StateResult>('ui.pet.state');
    applyResult(result);
    if (result?.state) petState.value = result.state;
    if (result?.launchError) status.value = launchHint(result.launchError);
    await loadVoiceOptions();
  } catch (error) {
    status.value = '读取设置失败：' + (error as Error).message;
  }
}

/** 保存后按返回的 overlayOpen 复核浮层是否真的按开关打开或移除。 */
async function save(): Promise<void> {
  saving.value = true;
  try {
    const result = await aicode.invoke<SettingsResult>('ui.settings.save', { settings: settings.value });
    applyResult(result);
    if (result?.overlayOpen === false && settings.value.pet.enabled) {
      status.value = launchHint(result.launchError || 'OVERLAY_FAILED');
    } else {
      status.value = settings.value.pet.enabled ? '已保存' : '已保存，桌宠浮层已移除';
    }
    await aicode.toast('桌宠设置已保存').catch(() => {});
  } catch (error) {
    status.value = '保存失败：' + (error as Error).message;
  } finally {
    saving.value = false;
  }
}

async function toggleVoice(enabled: boolean): Promise<void> {
  settings.value = {
    ...settings.value,
    voice: { ...settings.value.voice, mode: enabled ? 'auto' : 'canned' }
  };
  if (enabled) await loadVoiceOptions();
  await save();
}

function openModelPicker(): void {
  voiceDraft.value = { providerId: settings.value.voice.providerId, model: settings.value.voice.model };
  modelPickerOpen.value = true;
}

function onProviderChange(): void {
  voiceDraft.value.model = '';
}

async function applyModelChoice(): Promise<void> {
  settings.value = {
    ...settings.value,
    voice: { mode: 'auto', providerId: voiceDraft.value.providerId, model: voiceDraft.value.model }
  };
  await save();
}

async function ensureOpen(): Promise<boolean> {
  const opened = await aicode.invoke<OpenResult>('ui.pet.open');
  if (opened?.ok) return true;
  status.value = launchHint(opened?.code || 'OVERLAY_FAILED');
  return false;
}

async function reset(): Promise<void> {
  busy.value = true;
  try {
    const result = await aicode.invoke<SettingsResult>('ui.settings.reset');
    applyResult(result);
    status.value = (await ensureOpen()) ? '已恢复默认设置' : '已恢复默认设置，但桌宠浮层暂不可用';
    await aicode.toast('已恢复默认设置').catch(() => {});
  } catch (error) {
    status.value = '重置失败：' + (error as Error).message;
  } finally {
    busy.value = false;
    confirmOpen.value = false;
  }
}

async function sayHello(): Promise<void> {
  busy.value = true;
  try {
    await save();
    if (!(await ensureOpen())) return;
    const result = await aicode.invoke<{ text?: string; source?: string }>('ui.pet.say');
    status.value = result?.source === 'model' ? '模型已按人设说话' : '已用内置语料说话';
  } catch (error) {
    status.value = '操作失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function interact(kind: 'headpat' | 'feed'): Promise<void> {
  busy.value = true;
  try {
    if (!(await ensureOpen())) return;
    const result = await aicode.invoke<{ ok?: boolean; mood?: number; source?: string }>('ui.pet.interact', { kind });
    petState.value = { ...petState.value, mood: result?.mood ?? petState.value.mood };
    status.value = (kind === 'headpat' ? '已摸摸头' : '已喂点心') + (result?.source === 'model' ? '（模型回应）' : '');
  } catch (error) {
    status.value = '操作失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function playAction(): Promise<void> {
  busy.value = true;
  try {
    if (!(await ensureOpen())) return;
    await aicode.invoke('ui.pet.play', { animation: settings.value.animations.action });
    status.value = '已播放动作';
  } catch (error) {
    status.value = '操作失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function toggleSleep(): Promise<void> {
  busy.value = true;
  try {
    if (!(await ensureOpen())) return;
    petState.value = { ...petState.value, sleeping: !petState.value.sleeping };
    await aicode.invoke('tools.sleep', { action: 'toggle' });
    status.value = petState.value.sleeping ? '已哄它睡觉' : '已叫醒';
  } catch (error) {
    status.value = '操作失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function hidePet(): Promise<void> {
  busy.value = true;
  try {
    const result = await aicode.invoke<SettingsResult>('ui.pet.hide');
    applyResult(result);
    status.value = '桌宠浮层已隐藏';
  } catch (error) {
    status.value = '操作失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function showPet(): Promise<void> {
  busy.value = true;
  try {
    const result = await aicode.invoke<SettingsResult>('ui.pet.show');
    applyResult(result);
    status.value = (await ensureOpen()) ? '已重新显示桌宠' : '设置已保存，但桌宠浮层暂不可用';
  } catch (error) {
    status.value = '操作失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  offEvents = aicode.events.on((event: AicodeEvent) => {
    if (event.name === 'pet.state' && event.payload && typeof event.payload === 'object') {
      petState.value = event.payload as unknown as PetState;
    } else if (event.name === 'pet.error') {
      const payload = event.payload as unknown as { code?: string } | null;
      if (payload?.code) status.value = launchHint(payload.code);
    }
  });
  await load();
});

onBeforeUnmount(() => {
  if (offEvents) offEvents();
});
</script>

<style scoped>
/* 宿主 ui.css 只给个别组件设了 border-box，这里是页面级重置，避免 padding 撑出视口。 */
.aicode-page,
.aicode-page *,
.aicode-page *::before,
.aicode-page *::after {
  box-sizing: border-box;
}

.aicode-page-header {
  gap: 12px;
}

/* 与 aicode-row 同样的内边距与排版，用来承载 title/subtitle + 控件的行。 */
.setting-line {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 16px;
  border: none;
  background: transparent;
  color: var(--aicode-on-surface);
  text-align: left;
  font: inherit;
}

.setting-line:active {
  background: var(--aicode-surface-variant);
}

.setting-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.setting-title {
  color: var(--aicode-on-surface);
  font-size: calc(16px * var(--aicode-font-scale));
  line-height: 1.4;
}

.setting-subtitle {
  overflow: hidden;
  color: var(--aicode-on-surface-variant);
  font-size: calc(14px * var(--aicode-font-scale));
  line-height: 1.4;
}

.setting-action {
  flex: none;
  color: var(--aicode-primary);
  font-size: calc(14px * var(--aicode-font-scale));
}

.slider-row {
  padding: 12px 16px;
}

.slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 14px;
}

.slider-head .value {
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
}

input[type='range'] {
  width: 100%;
  accent-color: var(--aicode-primary);
}

.voice-hint {
  margin: 8px 2px 0;
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
  line-height: 1.5;
}

.actions,
.quick-actions,
.footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
}

.actions {
  padding-top: 0;
}

.footer-actions {
  margin: 4px 0 24px;
}

@media (max-width: 520px) {
  .footer-actions {
    flex-direction: column;
  }
}
</style>
