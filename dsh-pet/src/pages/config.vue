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

    <aicode-group title="音乐搜索">
      <div class="music-search">
        <input
          v-model="musicKeywords"
          class="music-input"
          type="search"
          placeholder="搜索歌曲、歌手"
          enterkeyhint="search"
          @keyup.enter="searchMusic(1)"
        />
        <aicode-button :disabled="musicLoading || !musicKeywords.trim()" @click="searchMusic(1)">
          {{ musicLoading ? '搜索中' : '搜索' }}
        </aicode-button>
      </div>
      <button class="music-account-line" type="button" @click="openMusicAccount">
        <span class="music-account-text">
          <span class="music-account-title">音乐账号</span>
          <span class="music-account-sub">{{ musicAccount ? musicAccount.nickname : '未登录（搜索无需登录）' }}</span>
        </span>
        <span class="music-account-action">{{ musicAccount ? '管理' : '登录' }}</span>
      </button>
      <p v-if="musicHint" class="voice-hint">{{ musicHint }}</p>
      <div v-if="musicSongs.length" class="music-results">
        <div v-for="song in musicSongs" :key="song.hash" class="music-item">
          <img v-if="song.cover" class="music-cover" :src="song.cover" alt="" loading="lazy" />
          <div v-else class="music-cover music-cover-empty"></div>
          <div class="music-main">
            <span class="music-title">{{ song.title }}</span>
            <span class="music-meta">{{ song.singer }} · {{ song.album || '未知专辑' }}</span>
            <span class="music-detail">{{ formatMusicDuration(song.duration) }}<template v-if="song.bitrate"> · {{ song.bitrate }}kbps</template></span>
          </div>
          <button class="music-play" type="button" :disabled="musicBusy" @click="playSongItem(song)">▶</button>
          <button class="music-fav" type="button" :class="{ on: favoriteHashes.includes(song.hash) }" @click="toggleFavorite(song)">
            {{ favoriteHashes.includes(song.hash) ? '★' : '☆' }}
          </button>
        </div>
        <div class="music-pager">
          <aicode-button :disabled="musicLoading || musicPage <= 1" @click="searchMusic(musicPage - 1)">上一页</aicode-button>
          <span class="music-page-text">第 {{ musicPage }} 页</span>
          <aicode-button :disabled="musicLoading" @click="searchMusic(musicPage + 1)">下一页</aicode-button>
        </div>
      </div>
      <aicode-divider />
      <aicode-field label="接口地址">
        <aicode-input v-model="musicApiBaseUrl" placeholder="https://music.api.hoilai.cn" @blur="saveMusicSettings" />
      </aicode-field>
      <p class="voice-hint">
        默认接口来自开源项目 kgka_Music_hl 的公开服务，可改为自建地址。
      </p>
      <aicode-divider />
      <button class="music-account-line" type="button" @click="openAccountPlaylists">
        <span class="music-account-text">
          <span class="music-account-title">我的歌单（账号）</span>
          <span class="music-account-sub">{{ accountPlaylistSub }}</span>
        </span>
        <span class="music-account-action">查看</span>
      </button>
      <button class="music-account-line" type="button" @click="openFavorites">
        <span class="music-account-text">
          <span class="music-account-title">收藏歌单</span>
          <span class="music-account-sub">{{ favoriteSummaryText }}</span>
        </span>
        <span class="music-account-action">管理</span>
      </button>
      <div class="music-actions-row">
        <aicode-button :disabled="musicBusy || favoriteTotalCount === 0" @click="singFromPet">让桌宠唱一首</aicode-button>
      </div>
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

    <aicode-dialog v-model="musicAccountOpen" title="音乐账号" @confirm="musicAccountOpen = false">
      <template v-if="musicAccount">
        <div class="music-account-row">
          <img v-if="musicAccount.avatarUrl" class="music-avatar" :src="musicAccount.avatarUrl" alt="" />
          <div>
            <div class="music-account-name">{{ musicAccount.nickname }}</div>
            <div class="music-account-id">ID {{ musicAccount.userId || '未知' }}</div>
          </div>
        </div>
        <div class="music-dialog-actions">
          <aicode-button :disabled="musicBusy" @click="logoutMusic">退出登录</aicode-button>
        </div>
      </template>
      <template v-else>
        <div class="music-tabs">
          <button class="music-tab" :class="{ active: musicTab === 'qr' }" type="button" @click="openMusicQr">扫码登录</button>
          <button class="music-tab" :class="{ active: musicTab === 'phone' }" type="button" @click="musicTab = 'phone'">手机号</button>
        </div>
        <template v-if="musicTab === 'qr'">
          <div class="music-qr-area">
            <img v-if="musicQrImage" class="music-qr" :src="musicQrImage" alt="登录二维码" />
            <span v-else class="music-qr-placeholder">正在获取二维码…</span>
          </div>
          <p class="voice-hint">{{ musicQrHint }}</p>
        </template>
        <template v-else>
          <aicode-field label="手机号">
            <aicode-input v-model="musicMobile" placeholder="11 位手机号" />
          </aicode-field>
          <aicode-field label="验证码">
            <aicode-input v-model="musicCode" placeholder="短信验证码" />
          </aicode-field>
          <div class="music-dialog-actions">
            <aicode-button :disabled="musicBusy || !musicMobile.trim()" @click="sendMusicCode">发送验证码</aicode-button>
            <aicode-button variant="primary" :disabled="musicBusy || !musicMobile.trim() || !musicCode.trim()" @click="loginMusicByPhone">
              登录
            </aicode-button>
          </div>
        </template>
      </template>
      <p v-if="musicLoginHint" class="voice-hint">{{ musicLoginHint }}</p>
    </aicode-dialog>

    <aicode-dialog v-model="accountListsOpen" title="我的歌单" @confirm="accountListsOpen = false">
      <template v-if="!musicAccount">
        <p class="voice-hint">未登录：账号歌单需要先登录才能读取。</p>
      </template>
      <template v-else>
        <p v-if="accountListHint" class="voice-hint">{{ accountListHint }}</p>
        <div v-if="accountPlaylists.length" class="music-results">
          <button
            v-for="list in accountPlaylists"
            :key="list.id"
            class="music-account-line"
            type="button"
            @click="openAccountPlaylist(list)"
          >
            <img v-if="list.cover" class="music-cover" :src="list.cover" alt="" loading="lazy" />
            <div v-else class="music-cover music-cover-empty"></div>
            <span class="music-account-text">
              <span class="music-account-title">{{ list.name }}</span>
              <span class="music-account-sub">{{ list.songCount }} 首{{ list.isDefault ? ' · 我喜欢' : '' }}</span>
            </span>
            <span class="music-account-action">›</span>
          </button>
        </div>
        <p v-else class="voice-hint">账号里没有读到歌单。若刚登录，先刷新一次。</p>
        <div class="music-dialog-actions">
          <aicode-button :disabled="musicBusy" @click="loadAccountPlaylists">刷新</aicode-button>
        </div>
      </template>
    </aicode-dialog>

    <aicode-dialog v-model="accountSongsOpen" :title="currentAccountList ? currentAccountList.name : '歌单'" @confirm="accountSongsOpen = false">
      <p v-if="accountSongHint" class="voice-hint">{{ accountSongHint }}</p>
      <div v-if="accountSongs.length" class="music-results">
        <div v-for="song in accountSongs" :key="song.hash" class="music-item">
          <img v-if="song.cover" class="music-cover" :src="song.cover" alt="" loading="lazy" />
          <div v-else class="music-cover music-cover-empty"></div>
          <div class="music-main">
            <span class="music-title">{{ song.title }}</span>
            <span class="music-meta">{{ song.singer }} · {{ song.album || '未知专辑' }}</span>
            <span class="music-detail">{{ formatMusicDuration(song.duration) }}</span>
          </div>
          <button class="music-play" type="button" :disabled="musicBusy" @click="playSongItem(song)">▶</button>
          <button class="music-fav" type="button" :class="{ on: favoriteHashes.includes(song.hash) }" @click="toggleFavorite(song)">
            {{ favoriteHashes.includes(song.hash) ? '★' : '☆' }}
          </button>
        </div>
      </div>
      <div v-if="accountSongs.length" class="music-dialog-actions">
        <aicode-button :disabled="musicBusy" @click="singCurrentPlaylist">让桌宠从这个歌单唱一首</aicode-button>
      </div>
    </aicode-dialog>

    <aicode-dialog v-model="favoritesOpen" title="收藏歌单" @confirm="favoritesOpen = false">
      <div class="music-tabs">
        <button
          v-for="list in favoriteLists"
          :key="list.id"
          class="music-tab"
          :class="{ active: currentListId === list.id }"
          type="button"
          @click="selectList(list.id)"
        >
          {{ list.name }}（{{ list.count }}）
        </button>
      </div>
      <div class="music-dialog-actions">
        <aicode-button :disabled="musicBusy" @click="createFavoriteList">新建歌单</aicode-button>
        <aicode-button v-if="currentListId" :disabled="musicBusy" @click="removeCurrentList">删除歌单</aicode-button>
      </div>
      <p v-if="favoriteHint" class="voice-hint">{{ favoriteHint }}</p>
      <div v-if="favoriteSongs.length" class="music-results">
        <div v-for="song in favoriteSongs" :key="song.hash" class="music-item">
          <img v-if="song.cover" class="music-cover" :src="song.cover" alt="" loading="lazy" />
          <div v-else class="music-cover music-cover-empty"></div>
          <div class="music-main">
            <span class="music-title">{{ song.title }}</span>
            <span class="music-meta">{{ song.singer }} · {{ song.album || '未知专辑' }}</span>
          </div>
          <button class="music-play" type="button" :disabled="musicBusy" @click="playSongItem(song)">▶</button>
          <button class="music-fav on" type="button" @click="removeFavoriteSong(song)">★</button>
        </div>
      </div>
      <p v-else class="voice-hint">这个歌单还没有歌，去搜索里点 ☆ 收藏。</p>
    </aicode-dialog>

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
      <aicode-field label="供应商">
        <aicode-select v-model="ttsDraft.providerId" :options="ttsProviderPickerOptions" @update:model-value="onTtsProviderPick" />
      </aicode-field>
      <p v-if="!ttsDraft.providerId" class="voice-hint">
        选「自定义」可填任意兼容服务的地址与密钥，不要求在 AiCode 里预先配置。
      </p>
      <aicode-field label="模型">
        <aicode-select v-model="ttsModelPick" :options="ttsModelOptions" @update:model-value="onTtsModelPick" />
      </aicode-field>
      <aicode-field v-if="ttsModelPick === '__manual__'" label="模型名">
        <aicode-input v-model="ttsDraft.model" :placeholder="ttsModelPlaceholder" />
      </aicode-field>
      <p class="voice-hint">{{ ttsModelHint }}</p>
      <aicode-field label="音色">
        <aicode-input v-model="ttsDraft.voice" :placeholder="ttsVoicePlaceholder" />
      </aicode-field>
      <aicode-field label="API 地址（可留空）">
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
  providerId: '',
  baseUrl: '',
  model: '',
  voice: '',
  speed: 1
});
const ttsProviderPickerOptions = computed(() => [
  { value: '', label: '未选择' },
  { value: '__custom__', label: '自定义（任意兼容服务）' },
  ...ttsPresets.value.map((preset) => ({
    value: preset.providerId,
    label: preset.providerName + (preset.hasKey ? '' : '（未配置密钥）')
  }))
]);
const ttsAddressHint = computed(() =>
  ttsDraft.value.providerId
    ? '宿主不会把该供应商的地址与密钥交给插件，所以这两项需在这里各填一次；密钥由宿主加密存储。'
    : '自定义服务需填完整地址（例如 http://127.0.0.1:8788/v1）与密钥；留空则用该协议的官方地址。'
);
const ttsModelPick = ref('');
const ttsPresets = ref<Array<{ providerId: string; providerName: string; tts: { provider: TtsProvider; baseUrl: string; model: string }; hasKey: boolean }>>([]);
/** 自定义模式下没有可枚举的模型，一律手填。 */
const isCustomProvider = computed(() => ttsDraft.value.providerId === '__custom__');
/** 该供应商在 AiCode 里已配置的模型；宿主返回的是它实际配置的名单，包含非对话模型。 */
const ttsProviderModels = computed(() =>
  isCustomProvider.value ? [] : voiceOptions.value.find((p) => p.id === ttsDraft.value.providerId)?.models ?? []
);
const ttsModelOptions = computed(() => [
  ...ttsProviderModels.value.map((model) => ({ value: model.id, label: model.displayName || model.id })),
  { value: '__manual__', label: '以上都不是，手动填写' }
]);
const ttsModelHint = computed(() => {
  if (isCustomProvider.value) return '自定义服务没有可列举的模型，请直接填写语音模型名。';
  if (!ttsDraft.value.providerId) return '先选一个供应商，就能列出它已配置的模型。';
  if (ttsProviderModels.value.length === 0) {
    return '这个供应商没有可枚举的模型，请把语音模型名填到下面的输入框。';
  }
  return '这些是你在 AiCode 里为该供应商配置的模型；若语音模型不在列表里，选「手动填写」后输入名称。';
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
  // 「手动填写」不是模型名，保留输入框，由用户自己键入。
  if (ttsModelPick.value === '__manual__') return;
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
    providerId: tts.providerId,
    baseUrl: tts.baseUrl,
    model: tts.model,
    voice: tts.voice,
    speed: tts.speed
  };
  ttsKeyInput.value = '';
  ttsHint.value = '';
  // 已存过供应商才回填它；否则进自定义（地址与模型手动填）。
  if (!tts.providerId) ttsDraft.value.providerId = '__custom__';
  if (tts.provider === 'none') {
    const preset = ttsPresets.value.find((item) => item.providerId === tts.providerId);
    ttsDraft.value.provider = preset ? preset.tts.provider : 'openai';
  }
  syncTtsModelPick();
  ttsOpen.value = true;
  // 预设可能要现拉，拉完再对齐一次模型下拉。
  void loadTtsState().then(syncTtsModelPick);
}

/** 根据当前供应商与已存模型，决定模型下拉应停在哪一项。 */
function syncTtsModelPick(): void {
  const models = voiceOptions.value.find((p) => p.id === ttsDraft.value.providerId)?.models ?? [];
  ttsModelPick.value = models.some((m) => m.id === ttsDraft.value.model) ? ttsDraft.value.model : '__manual__';
}

/** 换供应商：同步协议，并把模型候选换成该供应商的。 */
function onTtsProviderPick(): void {
  if (ttsDraft.value.providerId === '__custom__') {
    // 自定义：按地址形状猜协议，模型一律手填。
    const looksGemini = /generativelanguage\.googleapis\.com/i.test(ttsDraft.value.baseUrl);
    ttsDraft.value.provider = looksGemini ? 'gemini' : 'openai';
    ttsModelPick.value = '__manual__';
    return;
  }
  const preset = ttsPresets.value.find((item) => item.providerId === ttsDraft.value.providerId);
  if (!preset) {
    ttsModelPick.value = '__manual__';
    return;
  }
  ttsDraft.value.provider = preset.tts.provider;
  ttsDraft.value.baseUrl = '';
  // 保留当前模型名，若该供应商有同名模型则直接对上。
  const keep = ttsDraft.value.model;
  const exists = (voiceOptions.value.find((p) => p.id === ttsDraft.value.providerId)?.models ?? []).some(
    (model) => model.id === keep
  );
  if (!exists) ttsDraft.value.model = '';
  ttsModelPick.value = exists ? keep : '__manual__';
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
          providerId: draft.providerId === '__custom__' ? '' : draft.providerId,
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
    // 合成用的是已保存配置，先把草稿落盘再试听。
    await saveTts();
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

// ---- 音乐：搜索与账号登录 ----

interface MusicAccount {
  userId: string;
  nickname: string;
  avatarUrl: string;
  savedAt: number;
}

interface MusicSong {
  hash: string;
  title: string;
  singer: string;
  album: string;
  duration: number;
  cover: string;
  bitrate: number;
  albumId?: string;
  albumAudioId?: string;
}

interface MusicSearchPayload {
  ok?: boolean;
  code?: string;
  message?: string;
  songs?: MusicSong[];
  page?: number;
}

const musicKeywords = ref('');
const musicSongs = ref<MusicSong[]>([]);
const musicPage = ref(1);
const musicLoading = ref(false);
const musicHint = ref('');
const musicApiBaseUrl = ref('https://music.api.hoilai.cn');

const musicAccount = ref<MusicAccount | null>(null);
const musicAccountOpen = ref(false);
const musicTab = ref<'qr' | 'phone'>('qr');
const musicQrImage = ref('');
const musicQrKey = ref('');
const musicQrHint = ref('');
const musicMobile = ref('');
const musicCode = ref('');
const musicLoginHint = ref('');
const musicBusy = ref(false);
let musicQrTimer: ReturnType<typeof setInterval> | null = null;

function stopMusicQrPolling(): void {
  if (musicQrTimer) {
    clearInterval(musicQrTimer);
    musicQrTimer = null;
  }
}

function formatMusicDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return mm + ':' + String(ss).padStart(2, '0');
}

async function refreshMusicAccount(): Promise<void> {
  try {
    const result = await aicode.invoke<{ signedIn?: boolean; account?: MusicAccount | null }>('ui.music.account');
    musicAccount.value = result?.signedIn && result.account ? result.account : null;
  } catch {
    musicAccount.value = null;
  }
}

async function loadMusicSettings(): Promise<void> {
  const current = settings.value.music;
  if (current?.apiBaseUrl) musicApiBaseUrl.value = current.apiBaseUrl;
}

async function saveMusicSettings(): Promise<void> {
  try {
    const result = await aicode.invoke<{ settings?: PetSettings }>('ui.settings.save', {
      settings: { ...settings.value, music: { ...settings.value.music, apiBaseUrl: musicApiBaseUrl.value } }
    });
    if (result?.settings) settings.value = normalizeSettings(result.settings);
    musicApiBaseUrl.value = settings.value.music.apiBaseUrl;
  } catch (error) {
    musicHint.value = '保存接口地址失败：' + (error as Error).message;
  }
}

async function searchMusic(target: number): Promise<void> {
  const word = musicKeywords.value.trim();
  if (!word) return;
  musicLoading.value = true;
  musicHint.value = '';
  try {
    const result = await aicode.invoke<MusicSearchPayload>('ui.music.search', {
      keywords: word,
      page: target
    });
    if (result?.ok !== true) {
      musicHint.value = result?.message || '搜索失败';
      musicSongs.value = [];
      return;
    }
    musicSongs.value = result.songs ?? [];
    musicPage.value = result.page ?? target;
    if (musicSongs.value.length === 0) musicHint.value = '没有找到结果，换个关键词试试。';
  } catch (error) {
    musicHint.value = '搜索失败：' + (error as Error).message;
  } finally {
    musicLoading.value = false;
  }
}

function openMusicAccount(): void {
  musicAccountOpen.value = true;
  musicLoginHint.value = '';
  if (musicAccount.value) return;
  if (musicTab.value === 'qr') void openMusicQr();
}

async function openMusicQr(): Promise<void> {
  musicTab.value = 'qr';
  stopMusicQrPolling();
  musicQrImage.value = '';
  musicQrHint.value = '正在获取二维码…';
  try {
    const result = await aicode.invoke<{ ok?: boolean; key?: string; image?: string; message?: string }>('ui.music.qr');
    if (result?.ok !== true || !result.key) {
      musicQrHint.value = result?.message || '二维码获取失败';
      return;
    }
    musicQrKey.value = result.key;
    musicQrImage.value = result.image ?? '';
    musicQrHint.value = '用酷狗音乐 App 扫码登录';
    musicQrTimer = setInterval(() => {
      void pollMusicQr();
    }, 3000);
  } catch (error) {
    musicQrHint.value = '二维码获取失败：' + (error as Error).message;
  }
}

async function pollMusicQr(): Promise<void> {
  if (!musicQrKey.value || musicAccount.value) {
    stopMusicQrPolling();
    return;
  }
  try {
    const result = await aicode.invoke<{
      ok?: boolean;
      status?: number;
      message?: string;
      account?: MusicAccount | null;
    }>('ui.music.qrCheck', { key: musicQrKey.value });
    if (result?.ok !== true) {
      musicQrHint.value = result?.message || '二维码状态查询失败';
      stopMusicQrPolling();
      return;
    }
    const status = result.status ?? 0;
    if (status === 2) musicQrHint.value = '已扫码，请在手机上确认';
    else if (status === 4) {
      musicQrHint.value = '登录成功';
      stopMusicQrPolling();
      musicAccount.value = result.account ?? null;
      await refreshMusicAccount();
    } else if (status === 0) {
      musicQrHint.value = '二维码已过期，请重新打开';
      stopMusicQrPolling();
    }
  } catch (error) {
    musicQrHint.value = '状态查询失败：' + (error as Error).message;
    stopMusicQrPolling();
  }
}

async function sendMusicCode(): Promise<void> {
  musicBusy.value = true;
  musicLoginHint.value = '';
  try {
    const result = await aicode.invoke<{ ok?: boolean; message?: string }>('ui.music.sendCode', {
      mobile: musicMobile.value.trim()
    });
    musicLoginHint.value = result?.ok === true ? '验证码已发送' : result?.message || '发送失败';
  } catch (error) {
    musicLoginHint.value = '发送失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

async function loginMusicByPhone(): Promise<void> {
  musicBusy.value = true;
  musicLoginHint.value = '';
  try {
    const result = await aicode.invoke<{ ok?: boolean; message?: string; account?: MusicAccount | null }>(
      'ui.music.loginPhone',
      { mobile: musicMobile.value.trim(), code: musicCode.value.trim() }
    );
    if (result?.ok === true) {
      musicLoginHint.value = '登录成功';
      await refreshMusicAccount();
      musicAccountOpen.value = false;
    } else {
      musicLoginHint.value = result?.message || '登录失败';
    }
  } catch (error) {
    musicLoginHint.value = '登录失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

async function logoutMusic(): Promise<void> {
  musicBusy.value = true;
  try {
    await aicode.invoke('ui.music.logout');
    musicAccount.value = null;
    musicLoginHint.value = '已退出登录';
    musicQrImage.value = '';
    musicQrHint.value = '';
  } catch (error) {
    musicLoginHint.value = '退出失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

// ---- 账号歌单（酷狗侧，与本地收藏分开） ----

interface AccountPlaylist {
  id: string;
  name: string;
  songCount: number;
  cover: string;
  isDefault: boolean;
  creator: string;
}

const accountPlaylists = ref<AccountPlaylist[]>([]);
const accountListsOpen = ref(false);
const accountListHint = ref('');
const accountSongsOpen = ref(false);
const accountSongs = ref<MusicSong[]>([]);
const accountSongHint = ref('');
const currentAccountList = ref<AccountPlaylist | null>(null);

const accountPlaylistSub = computed(() => {
  if (!musicAccount.value) return '未登录';
  if (accountPlaylists.value.length === 0) return '点击读取账号歌单';
  return accountPlaylists.value.length + ' 个歌单';
});

async function loadAccountPlaylists(): Promise<void> {
  musicBusy.value = true;
  accountListHint.value = '';
  try {
    const result = await aicode.invoke<{
      ok?: boolean;
      playlists?: AccountPlaylist[];
      message?: string;
      code?: string;
    }>('ui.music.accountPlaylists');
    if (result?.ok !== true) {
      accountListHint.value = result?.message || '读取账号歌单失败';
      accountPlaylists.value = [];
      return;
    }
    accountPlaylists.value = result.playlists ?? [];
    if (accountPlaylists.value.length === 0) {
      accountListHint.value = '账号里没有歌单，或登录态已失效，可重新登录后再试。';
    }
  } catch (error) {
    accountListHint.value = '读取账号歌单失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

async function openAccountPlaylists(): Promise<void> {
  accountListsOpen.value = true;
  accountListHint.value = '';
  if (!musicAccount.value) {
    accountListHint.value = '未登录：账号歌单需要先登录。';
    return;
  }
  await loadAccountPlaylists();
}

async function openAccountPlaylist(list: AccountPlaylist): Promise<void> {
  currentAccountList.value = list;
  accountSongs.value = [];
  accountSongHint.value = '';
  accountSongsOpen.value = true;
  musicBusy.value = true;
  try {
    const result = await aicode.invoke<{ ok?: boolean; songs?: MusicSong[]; message?: string }>(
      'ui.music.playlistSongs',
      { id: list.id }
    );
    if (result?.ok !== true) {
      accountSongHint.value = result?.message || '读取歌单歌曲失败';
      return;
    }
    accountSongs.value = result.songs ?? [];
    if (accountSongs.value.length === 0) accountSongHint.value = '这个歌单里没有歌曲。';
  } catch (error) {
    accountSongHint.value = '读取歌单歌曲失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

async function singCurrentPlaylist(): Promise<void> {
  if (!currentAccountList.value) return;
  musicBusy.value = true;
  try {
    const result = await aicode.invoke<{ ok?: boolean; message?: string; song?: { title: string } }>(
      'ui.pet.singPlaylist',
      { playlistId: currentAccountList.value.id }
    );
    accountSongHint.value =
      result?.ok === true ? '桌宠正在唱：' + (result.song?.title ?? '') : result?.message || '唱歌失败';
  } catch (error) {
    accountSongHint.value = '唱歌失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

// ---- 收藏歌单 ----

interface FavoriteSummary {
  id: string;
  name: string;
  count: number;
  updatedAt: number;
}

const favoriteLists = ref<FavoriteSummary[]>([]);
const favoriteHashes = ref<string[]>([]);
const favoriteSongs = ref<MusicSong[]>([]);
const currentListId = ref('');
const favoritesOpen = ref(false);
const favoriteHint = ref('');

const favoriteTotalCount = computed(() => favoriteLists.value.reduce((sum, list) => sum + list.count, 0));
const favoriteSummaryText = computed(() => {
  if (favoriteLists.value.length === 0) return '还没有歌单';
  return favoriteLists.value.map((list) => list.name + ' ' + list.count).join(' · ');
});

async function refreshFavorites(): Promise<void> {
  try {
    const [lists, hashes] = await Promise.all([
      aicode.invoke<{ lists?: FavoriteSummary[] }>('ui.music.favorites'),
      aicode.invoke<{ hashes?: string[] }>('ui.music.favoriteHashes')
    ]);
    favoriteLists.value = lists?.lists ?? [];
    favoriteHashes.value = hashes?.hashes ?? [];
    if (!currentListId.value && favoriteLists.value.length > 0) {
      currentListId.value = favoriteLists.value[0].id;
    }
  } catch (error) {
    favoriteHint.value = '读取收藏失败：' + (error as Error).message;
  }
}

async function loadListSongs(id: string): Promise<void> {
  if (!id) {
    favoriteSongs.value = [];
    return;
  }
  try {
    const result = await aicode.invoke<{ ok?: boolean; list?: { songs?: MusicSong[] }; message?: string }>(
      'ui.music.favoriteList',
      { id }
    );
    if (result?.ok === true) favoriteSongs.value = result.list?.songs ?? [];
    else favoriteHint.value = result?.message || '读取歌单失败';
  } catch (error) {
    favoriteHint.value = '读取歌单失败：' + (error as Error).message;
  }
}

async function toggleFavorite(song: MusicSong): Promise<void> {
  const isFav = favoriteHashes.value.includes(song.hash);
  try {
    const result = await aicode.invoke<{ ok?: boolean; message?: string }>('ui.music.toggleFavorite', {
      song,
      listId: currentListId.value,
      remove: isFav
    });
    if (result?.ok !== true) {
      musicHint.value = result?.message || '收藏失败';
      return;
    }
    await refreshFavorites();
    await loadListSongs(currentListId.value);
    musicHint.value = isFav ? '已取消收藏' : '已加入收藏';
  } catch (error) {
    musicHint.value = '收藏失败：' + (error as Error).message;
  }
}

async function openFavorites(): Promise<void> {
  favoritesOpen.value = true;
  favoriteHint.value = '';
  await refreshFavorites();
  if (!currentListId.value && favoriteLists.value.length === 0) {
    await createFavoriteList();
    return;
  }
  await loadListSongs(currentListId.value);
}

async function selectList(id: string): Promise<void> {
  currentListId.value = id;
  await loadListSongs(id);
}

async function createFavoriteList(): Promise<void> {
  try {
    const result = await aicode.invoke<{ ok?: boolean; list?: { id: string } }>('ui.music.createList', {
      name: '收藏 ' + (favoriteLists.value.length + 1)
    });
    if (result?.ok === true && result.list) {
      currentListId.value = result.list.id;
      await refreshFavorites();
      await loadListSongs(currentListId.value);
    }
  } catch (error) {
    favoriteHint.value = '新建失败：' + (error as Error).message;
  }
}

async function removeCurrentList(): Promise<void> {
  if (!currentListId.value) return;
  try {
    await aicode.invoke('ui.music.deleteList', { id: currentListId.value });
    currentListId.value = '';
    favoriteSongs.value = [];
    await refreshFavorites();
    await loadListSongs(currentListId.value);
  } catch (error) {
    favoriteHint.value = '删除失败：' + (error as Error).message;
  }
}

async function removeFavoriteSong(song: MusicSong): Promise<void> {
  try {
    await aicode.invoke('ui.music.removeSong', { listId: currentListId.value, hash: song.hash });
    await refreshFavorites();
    await loadListSongs(currentListId.value);
  } catch (error) {
    favoriteHint.value = '移除失败：' + (error as Error).message;
  }
}

/** 让桌宠随机唱一首收藏里的歌。 */
async function singFromPet(): Promise<void> {
  musicBusy.value = true;
  try {
    const result = await aicode.invoke<{ ok?: boolean; message?: string; song?: { title: string } }>(
      'ui.pet.sing',
      { listId: currentListId.value }
    );
    musicHint.value =
      result?.ok === true
        ? '桌宠正在唱：' + (result.song?.title ?? '（若无声，先点一下桌宠再试）')
        : result?.message || '唱歌失败';
  } catch (error) {
    musicHint.value = '唱歌失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
  }
}

/** 点搜索结果里的播放：先取地址，再交给桌宠浮层播放。 */
async function playSongItem(song: MusicSong): Promise<void> {
  musicBusy.value = true;
  try {
    const result = await aicode.invoke<{
      ok?: boolean;
      url?: string;
      reason?: string;
      code?: string;
      message?: string;
      audioToken?: string;
      mimeType?: string;
    }>('ui.music.playUrl', { song });
    if (result?.ok !== true) {
      musicHint.value = result?.reason || result?.message || '无法播放';
      return;
    }
    const token = result.audioToken ?? '';
    musicHint.value =
      token ? '正在播放：' + song.title + '（若无声，先点一下桌宠）' : '音频准备失败，请重试';
  } catch (error) {
    musicHint.value = '播放失败：' + (error as Error).message;
  } finally {
    musicBusy.value = false;
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
  await loadMusicSettings();
  await refreshMusicAccount();
  await refreshFavorites();
  if (musicAccount.value) await loadAccountPlaylists();
});

onBeforeUnmount(() => {
  if (offEvents) offEvents();
  stopMusicQrPolling();
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

.music-play {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--aicode-surface-variant);
  color: var(--aicode-on-surface);
  font-size: 13px;
  line-height: 34px;
  cursor: pointer;
}

.music-play:disabled {
  opacity: 0.5;
}

.music-fav {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--aicode-on-surface-variant);
  font-size: 18px;
  line-height: 34px;
  cursor: pointer;
}

.music-fav.on {
  color: #f0a020;
}

.music-actions-row {
  display: flex;
  gap: 8px;
  padding: 0 16px 12px;
}

.music-search {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 16px 4px;
}

.music-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--aicode-outline-variant);
  border-radius: 10px;
  background: var(--aicode-surface-container);
  color: var(--aicode-on-surface);
  font: inherit;
}

.music-account-line {
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

.music-account-line:active {
  background: var(--aicode-surface-variant);
}

.music-account-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.music-account-title {
  font-size: calc(16px * var(--aicode-font-scale));
  line-height: 1.4;
}

.music-account-sub {
  overflow: hidden;
  color: var(--aicode-on-surface-variant);
  font-size: calc(14px * var(--aicode-font-scale));
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-account-action {
  flex: none;
  color: var(--aicode-primary);
  font-size: calc(14px * var(--aicode-font-scale));
}

.music-results {
  padding: 0 8px;
}

.music-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
}

.music-cover {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--aicode-surface-variant);
}

.music-cover-empty {
  display: block;
}

.music-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.music-title {
  overflow: hidden;
  font-size: 14px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-meta {
  overflow: hidden;
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-detail {
  color: var(--aicode-on-surface-variant);
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.8;
}

.music-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 0;
}

.music-page-text {
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
}

.music-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.music-tab {
  flex: 1;
  height: 34px;
  border: 1px solid var(--aicode-outline-variant);
  border-radius: 10px;
  background: transparent;
  color: var(--aicode-on-surface-variant);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.music-tab.active {
  border-color: var(--aicode-primary);
  color: var(--aicode-primary);
}

.music-qr-area {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 170px;
}

.music-qr {
  width: 156px;
  height: 156px;
  border-radius: 8px;
  background: #fff;
}

.music-qr-placeholder {
  color: var(--aicode-on-surface-variant);
  font-size: 13px;
}

.music-account-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.music-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  object-fit: cover;
}

.music-account-name {
  font-size: 15px;
}

.music-account-id {
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
}

.music-dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
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
