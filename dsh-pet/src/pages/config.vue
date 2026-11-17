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
      <aicode-divider />
      <setting-switch
        :model-value="settings.voice.speakAloud"
        title="朗读台词"
        subtitle="气泡出现时用云端语音念出来，需先配置 TTS"
        @update:model-value="toggleSpeakAloud"
      />
      <template v-if="settings.voice.speakAloud">
        <aicode-divider />
        <button class="setting-line" type="button" @click="openTtsSheet">
          <span class="setting-text">
            <span class="setting-title">语音合成（TTS）</span>
            <span class="setting-subtitle">{{ ttsSubtitle }}</span>
          </span>
          <span class="setting-action">配置</span>
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

    <aicode-dialog v-model="ttsOpen" title="语音合成（TTS）" confirm-text="保存" @confirm="saveTts">
      <aicode-field label="供应商来源">
        <aicode-select v-model="ttsDraft.source" :options="ttsSourceOptions" @update:model-value="onTtsSourceKindChange" />
      </aicode-field>
      <template v-if="ttsDraft.source === 'follow'">
        <aicode-info-row label="跟随" :value="ttsProviderLabel" />
        <p class="voice-hint">
          沿用「生成台词」的供应商。Gemini 走原生语音接口，其余按 OpenAI 兼容接口处理。
        </p>
        <aicode-field label="语音模型（该供应商已配置的）">
          <aicode-select v-model="ttsModelPick" :options="ttsModelOptions" @update:model-value="onTtsModelPick" />
        </aicode-field>
        <p v-if="ttsModelHint" class="voice-hint">{{ ttsModelHint }}</p>
      </template>
      <aicode-field :label="ttsDraft.source === 'custom' ? '语音模型' : '模型名（可手动改）'">
        <aicode-input v-model="ttsDraft.model" :placeholder="ttsModelPlaceholder" />
      </aicode-field>
      <aicode-field label="音色">
        <aicode-input v-model="ttsDraft.voice" :placeholder="ttsVoicePlaceholder" />
      </aicode-field>
      <aicode-field label="API 地址">
        <aicode-input v-model="ttsDraft.baseUrl" :placeholder="ttsBaseUrlPlaceholder" />
      </aicode-field>
      <aicode-field label="API Key">
        <aicode-input v-model="ttsKeyInput" type="password" :placeholder="ttsHasKey ? '已保存，留空则不修改' : '填入后保存'" />
      </aicode-field>
      <p class="voice-hint">{{ ttsAddressHint }}</p>
      <div class="tts-actions">
        <aicode-button :disabled="busy" @click="previewTts">试听</aicode-button>
        <aicode-button v-if="settings.voice.tts.provider !== 'none'" :disabled="busy" @click="disableTts">关闭朗读</aicode-button>
      </div>
      <p v-if="ttsHint" class="voice-hint">{{ ttsHint }}</p>
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
  type PetState,
  type TtsProvider
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
const ttsOpen = ref(false);
const ttsHint = ref('');
const ttsHasKey = ref(false);
const ttsKeyInput = ref('');
const ttsDraft = ref({
  provider: 'none' as TtsProvider,
  source: 'follow' as 'follow' | 'custom',
  baseUrl: '',
  model: '',
  voice: '',
  speed: 1
});
const ttsSourceOptions = [
  { value: 'follow', label: '跟随生成台词的供应商' },
  { value: 'custom', label: '自定义（任意兼容服务）' }
];
const ttsAddressHint = computed(() =>
  ttsDraft.value.source === 'custom'
    ? '自定义服务需填完整地址（例如 http://127.0.0.1:8788/v1）与密钥；留空则用该协议的官方地址。'
    : '宿主不会把 AiCode 里的供应商地址与密钥交给插件，所以这两项需在这里各填一次；密钥由宿主加密存储。'
);
const ttsModelPick = ref('');
const ttsPresets = ref<Array<{ providerId: string; providerName: string; tts: { provider: TtsProvider; baseUrl: string; model: string }; hasKey: boolean }>>([]);
/** 朗读跟随「生成台词」的供应商；未指定时自动用默认供应商。 */
const ttsProviderId = computed(() => {
  if (settings.value.voice.providerId) return settings.value.voice.providerId;
  return ttsPresets.value.find((item) => item.hasKey)?.providerId ?? '';
});
const ttsProviderLabel = computed(() => {
  const id = ttsProviderId.value;
  if (!id) return '未找到可用供应商';
  const preset = ttsPresets.value.find((item) => item.providerId === id);
  const name = preset ? preset.providerName : id;
  return settings.value.voice.providerId ? name : name + '（默认供应商）';
});
/** 该供应商实际已配置的模型，用于避免填一个它并不支持的语音模型。 */
const ttsProviderModels = computed(() => voiceOptions.value.find((p) => p.id === ttsProviderId.value)?.models ?? []);
const ttsModelOptions = computed(() => [
  { value: '', label: '手动输入' },
  ...ttsProviderModels.value.map((model) => ({ value: model.id, label: model.displayName || model.id }))
]);
const ttsModelHint = computed(() => {
  if (ttsProviderModels.value.length === 0) {
    return '这个供应商没有可枚举的模型，请在下方直接填语音模型名。';
  }
  return '这些是该供应商已配置的模型；其中不一定包含语音模型，请确认后填写。';
});
const ttsModelPlaceholder = computed(() =>
  ttsDraft.value.provider === 'gemini' ? 'gemini-2.5-flash-preview-tts' : 'gpt-4o-mini-tts'
);
const ttsVoicePlaceholder = computed(() =>
  ttsDraft.value.provider === 'gemini' ? 'Kore' : 'alloy / nova / shimmer …'
);
const ttsBaseUrlPlaceholder = computed(() =>
  ttsDraft.value.provider === 'gemini'
    ? 'https://generativelanguage.googleapis.com/v1beta'
    : 'https://api.openai.com/v1'
);
const ttsSubtitle = computed(() => {
  const tts = settings.value.voice.tts;
  if (tts.provider === 'none') return '未启用';
  const name = tts.provider === 'gemini' ? 'Gemini' : 'OpenAI 兼容';
  const voice = tts.voice ? ` · ${tts.voice}` : '';
  const key = ttsHasKey || tts.hasKey ? '' : ' · 缺少密钥';
  return name + voice + key;
});
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
    voice: { ...settings.value.voice, providerId: voiceDraft.value.providerId, model: voiceDraft.value.model }
  };
  // 换了供应商类型，协议也要跟着走；否则会把 Gemini 的请求打到 OpenAI 兼容地址。
  const preset = ttsPresets.value.find((item) => item.providerId === voiceDraft.value.providerId);
  if (preset && settings.value.voice.tts.provider !== 'none' && settings.value.voice.tts.provider !== preset.tts.provider) {
    settings.value = {
      ...settings.value,
      voice: {
        ...settings.value.voice,
        tts: { ...settings.value.voice.tts, provider: preset.tts.provider, model: '' }
      }
    };
  }
  await save();
}

async function loadTtsState(): Promise<void> {
  try {
    const [result, presets] = await Promise.all([
      aicode.invoke<{ tts?: PetSettings['voice']['tts']; hasKey?: boolean }>('ui.tts.state'),
      aicode.invoke<{ presets?: typeof ttsPresets.value; error?: string | null }>('ui.tts.presets')
    ]);
    if (result?.tts) settings.value = { ...settings.value, voice: { ...settings.value.voice, tts: result.tts } };
    ttsHasKey.value = result?.hasKey === true;
    ttsPresets.value = presets?.presets ?? [];
    if (presets?.error) ttsHint.value = '读取供应商失败：' + presets.error;
  } catch (error) {
    ttsHint.value = '读取 TTS 状态失败：' + (error as Error).message;
  }
}

/** 选已有供应商：带入协议与默认模型，让使用者不必自己查参数。 */
/** 选一个该供应商已有的模型名。 */
function onTtsModelPick(): void {
  if (ttsModelPick.value) ttsDraft.value.model = ttsModelPick.value;
}

async function toggleSpeakAloud(enabled: boolean): Promise<void> {
  settings.value = { ...settings.value, voice: { ...settings.value.voice, speakAloud: enabled } };
  await save();
  if (enabled) {
    await loadTtsState();
    if (settings.value.voice.tts.provider === 'none') openTtsSheet();
  }
}

function openTtsSheet(): void {
  const tts = settings.value.voice.tts;
  ttsDraft.value = {
    provider: tts.provider,
    source: tts.source,
    baseUrl: tts.baseUrl,
    model: tts.model,
    voice: tts.voice,
    speed: tts.speed
  };
  ttsKeyInput.value = '';
  ttsHint.value = '';
  ttsModelPick.value = '';
  // 首次打开时按当前供应商类型推断协议，避免默认落到不匹配的接口。
  if (tts.provider === 'none') {
    const preset = ttsPresets.value.find((item) => item.providerId === ttsProviderId.value)
      ?? ttsPresets.value.find((item) => item.hasKey);
    if (preset) {
      ttsDraft.value.provider = preset.tts.provider;
      ttsDraft.value.model = preset.tts.model;
    }
  }
  void loadTtsState();
  ttsOpen.value = true;
}

/** 切换跟随/自定义；自定义时按地址形状猜协议，避免还要多选一次。 */
function onTtsSourceKindChange(): void {
  if (ttsDraft.value.source === 'custom') {
    const looksGemini = /generativelanguage\.googleapis\.com/i.test(ttsDraft.value.baseUrl);
    ttsDraft.value.provider = looksGemini ? 'gemini' : 'openai';
    return;
  }
  const preset = ttsPresets.value.find((item) => item.providerId === ttsProviderId.value)
    ?? ttsPresets.value.find((item) => item.hasKey);
  if (preset) {
    ttsDraft.value.provider = preset.tts.provider;
    ttsDraft.value.model = preset.tts.model;
    ttsDraft.value.baseUrl = '';
  }
}

/** 关闭朗读：把供应商置为 none，保留其他字段以便下次打开。 */
async function disableTts(): Promise<void> {
  settings.value = {
    ...settings.value,
    voice: {
      ...settings.value.voice,
      speakAloud: false,
      tts: { ...settings.value.voice.tts, provider: 'none' }
    }
  };
  await save();
  ttsOpen.value = false;
}

async function saveTts(): Promise<void> {
  busy.value = true;
  try {
    if (ttsKeyInput.value.trim()) {
      const saved = await aicode.invoke<{ hasKey?: boolean }>('ui.tts.saveKey', { apiKey: ttsKeyInput.value.trim() });
      ttsHasKey.value = saved?.hasKey === true;
      ttsKeyInput.value = '';
    }
    const draft = ttsDraft.value;
    settings.value = {
      ...settings.value,
      voice: {
        ...settings.value.voice,
        speakAloud: settings.value.voice.speakAloud,
        tts: {
          provider: draft.provider,
          source: draft.source,
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          voice: draft.voice.trim(),
          hasKey: ttsHasKey.value,
          speed: draft.speed
        }
      }
    };
    await save();
    ttsHint.value = draft.provider === 'none' ? '已关闭 TTS' : '已保存，可试听确认';
  } catch (error) {
    ttsHint.value = '保存失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function previewTts(): Promise<void> {
  busy.value = true;
  ttsHint.value = '正在合成…';
  try {
    // 先确认地址上真的有语音接口，避免拿着对话模型合成而只看到 404。
    const probe = await aicode.invoke<{ ok?: boolean; reason?: string }>('ui.tts.probe', {
      baseUrl: ttsDraft.value.baseUrl,
      provider: ttsDraft.value.provider
    });
    if (probe && probe.ok === false) {
      ttsHint.value = probe.reason || '该地址没有语音合成接口';
      return;
    }
    const result = await aicode.invoke<{ ok?: boolean; reason?: string }>('ui.tts.preview');
    ttsHint.value = result?.ok ? '已发送到桌宠播放' : result?.reason || '试听失败';
  } catch (error) {
    ttsHint.value = '试听失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
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
  await loadTtsState();
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

.tts-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
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
