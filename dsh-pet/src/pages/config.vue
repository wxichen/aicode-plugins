<template>
  <div class="aicode-page">
    <header class="aicode-page-header">
      <h1 class="aicode-page-title">桌宠设置</h1>
      <aicode-badge text="AiCode 浮层" kind="plugin" />
    </header>

    <aicode-group title="显示">
      <aicode-row title="启用桌宠" subtitle="关闭后会移除系统悬浮窗，配置仍保留">
        <aicode-switch v-model="settings.pet.enabled" @update:model-value="save" />
      </aicode-row>
      <aicode-divider />
      <aicode-row title="随 App 启动" subtitle="打开 AiCode 时自动创建桌宠浮层">
        <aicode-switch v-model="settings.pet.autoStart" @update:model-value="save" />
      </aicode-row>
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
        <aicode-textarea v-model="settings.persona" placeholder="决定桌宠用什么口吻说话" />
      </aicode-field>
      <div class="actions">
        <aicode-button variant="primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </aicode-button>
        <aicode-button :disabled="busy" @click="sayHello">让它说句话</aicode-button>
      </div>
    </aicode-group>

    <aicode-group title="运行状态联动">
      <aicode-row title="跟随 AI 运行状态" subtitle="思考、工具执行、完成或出错时切换动作">
        <aicode-switch v-model="settings.workStatusEnabled" @update:model-value="save" />
      </aicode-row>
      <aicode-divider />
      <aicode-row title="任务完成后通知" subtitle="AI 一轮对话结束且成功时发送系统通知">
        <aicode-switch v-model="settings.notifyOnRunFinished" @update:model-value="save" />
      </aicode-row>
      <aicode-divider />
      <aicode-row title="任务异常时通知" subtitle="失败、取消或工具出错时发送系统通知">
        <aicode-switch v-model="settings.notifyOnToolError" @update:model-value="save" />
      </aicode-row>
    </aicode-group>

    <aicode-group title="气泡">
      <div class="slider-row">
        <div class="slider-head">
          <span>气泡停留时间</span>
          <span class="value">{{ Math.round(settings.bubbleDurationMs / 1000) }} 秒</span>
        </div>
        <input v-model.number="settings.bubbleDurationMs" type="range" min="1500" max="15000" step="500" @change="save" />
      </div>
      <aicode-divider />
      <aicode-row title="自动碎碎念" subtitle="空闲时按固定间隔随机说一句">
        <aicode-switch v-model="settings.idleWhisper" @update:model-value="save" />
      </aicode-row>
      <aicode-divider />
      <aicode-field label="碎碎念间隔（分钟）">
        <aicode-input v-model.number="settings.whisperIntervalMinutes" type="number" @blur="save" />
      </aicode-field>
    </aicode-group>

    <aicode-group title="快捷操作">
      <div class="quick-actions">
        <aicode-button :disabled="busy" @click="playAction">播放动作</aicode-button>
        <aicode-button :disabled="busy" @click="toggleSleep">{{ sleeping ? '叫醒桌宠' : '哄它睡觉' }}</aicode-button>
        <aicode-button v-if="settings.pet.enabled" :disabled="busy" @click="hidePet">隐藏桌宠</aicode-button>
        <aicode-button v-else :disabled="busy" @click="showPet">显示桌宠</aicode-button>
      </div>
      <aicode-divider />
      <aicode-row title="当前状态" :subtitle="statusSubtitle" />
      <aicode-row title="插件数据" :subtitle="ctx ? ctx.dataDir : '加载中…'" />
      <aicode-row title="操作方式" subtitle="点击回应、长按睡眠、拖动换位置" />
    </aicode-group>

    <div class="footer-actions">
      <aicode-button :disabled="busy" @click="reset">恢复默认设置</aicode-button>
      <aicode-button variant="danger" :disabled="busy" @click="confirmOpen = true">重置并隐藏</aicode-button>
    </div>

    <aicode-dialog v-model="confirmOpen" title="恢复默认设置" message="会重置所有外观、人设和通知选项，桌宠浮层也会按默认配置重新创建。" @confirm="reset" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { AicodePageContext, AicodeEvent } from '@jieapi/plugin-sdk/page';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PetSettings,
  type PetState
} from '../shared/settings';

interface SettingsResult {
  settings?: PetSettings;
  launchError?: string | null;
}

interface StateResult {
  settings?: PetSettings;
  state?: PetState;
  launchError?: string | null;
  overlayOpen?: boolean;
}

interface OpenResult {
  ok: boolean;
  overlayId?: string;
  code?: string;
  message?: string;
}

const ctx = ref<AicodePageContext | null>(null);
const settings = ref<PetSettings>(normalizeSettings(DEFAULT_SETTINGS));
const petState = ref<PetState>({
  sleeping: false,
  runActive: false,
  toolsActive: 0,
  lastAnimation: null,
  lastText: '',
  updatedAt: 0
});
const saving = ref(false);
const busy = ref(false);
const confirmOpen = ref(false);
const status = ref('');
let offEvents: (() => void) | null = null;

const sleeping = computed(() => petState.value.sleeping);
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

async function load(): Promise<void> {
  try {
    const context = await aicode.context();
    if ('overlayId' in context) return;
    ctx.value = context;
    const result = await aicode.invoke<StateResult>('ui.pet.state');
    applyResult(result);
    if (result?.state) petState.value = result.state;
    if (result?.launchError) status.value = launchHint(result.launchError);
  } catch (error) {
    status.value = '读取设置失败：' + (error as Error).message;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const result = await aicode.invoke<SettingsResult>('ui.settings.save', { settings: settings.value });
    applyResult(result);
    status.value = '已保存';
    await aicode.toast('桌宠设置已保存').catch(() => {});
  } catch (error) {
    status.value = '保存失败：' + (error as Error).message;
  } finally {
    saving.value = false;
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
    await aicode.invoke('ui.pet.say', { text: `我是${settings.value.petName}，请多关照。` });
    status.value = '已让桌宠说话';
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
.aicode-page-header {
  gap: 12px;
}

.page-subtitle {
  margin: 4px 0 0;
  color: var(--aicode-on-surface-variant);
  font-size: 13px;
  line-height: 1.5;
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
