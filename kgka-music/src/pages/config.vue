<template>
  <div class="aicode-page music-page">
    <header class="aicode-page-header">
      <h1 class="aicode-page-title">KA 音乐</h1>
      <span class="account-chip" :class="{ signed: !!account }" @click="openAccount">
        <img v-if="account?.avatarUrl" class="avatar" :src="account.avatarUrl" alt="" />
        <span class="chip-text">{{ account ? account.nickname : '未登录' }}</span>
      </span>
    </header>

    <section class="search-bar">
      <input
        v-model="keywords"
        class="search-input"
        type="search"
        placeholder="搜索歌曲、歌手"
        enterkeyhint="search"
        @keyup.enter="runSearch(1)"
      />
      <button class="search-button" type="button" :disabled="loading || !keywords.trim()" @click="runSearch(1)">
        {{ loading ? '搜索中' : '搜索' }}
      </button>
    </section>

    <p v-if="hint" class="hint">{{ hint }}</p>

    <ol v-if="songs.length" class="song-list">
      <li v-for="song in songs" :key="song.hash" class="song-item">
        <img v-if="song.cover" class="cover" :src="song.cover" alt="" loading="lazy" />
        <div v-else class="cover cover-empty"></div>
        <div class="song-main">
          <span class="song-title">{{ song.title }}</span>
          <span class="song-meta">{{ song.singer }} · {{ song.album || '未知专辑' }}</span>
          <span class="song-detail">{{ formatDuration(song.duration) }}<template v-if="song.bitrate"> · {{ song.bitrate }}kbps</template></span>
        </div>
      </li>
    </ol>

    <p v-if="searched && !songs.length && !loading" class="empty">没有找到结果，换个关键词试试。</p>

    <div v-if="songs.length" class="pager">
      <button class="pager-button" type="button" :disabled="page <= 1 || loading" @click="runSearch(page - 1)">上一页</button>
      <span class="pager-text">第 {{ page }} 页</span>
      <button class="pager-button" type="button" :disabled="loading" @click="runSearch(page + 1)">下一页</button>
    </div>

    <aicode-group title="接口与设置">
      <aicode-field label="接口地址">
        <aicode-input v-model="apiBaseUrl" placeholder="https://music.api.hoilai.cn" @blur="saveSettings" />
      </aicode-field>
      <aicode-field label="每页条数">
        <aicode-input v-model.number="pageSize" type="number" @blur="saveSettings" />
      </aicode-field>
      <p class="hint">
        默认接口来自开源项目 kgka_Music_hl 的公开服务，搜索无需登录；登录后才能使用需要账号的功能。
      </p>
    </aicode-group>

    <aicode-dialog v-model="accountOpen" title="音乐账号" @confirm="accountOpen = false">
      <template v-if="account">
        <div class="account-row">
          <img v-if="account.avatarUrl" class="avatar-lg" :src="account.avatarUrl" alt="" />
          <div>
            <div class="account-name">{{ account.nickname }}</div>
            <div class="account-id">ID {{ account.userId || '未知' }}</div>
          </div>
        </div>
        <div class="dialog-actions">
          <aicode-button :disabled="busy" @click="logout">退出登录</aicode-button>
        </div>
      </template>

      <template v-else>
        <div class="login-tabs">
          <button class="tab" :class="{ active: loginTab === 'qr' }" type="button" @click="openQr">扫码登录</button>
          <button class="tab" :class="{ active: loginTab === 'phone' }" type="button" @click="loginTab = 'phone'">手机号</button>
        </div>

        <template v-if="loginTab === 'qr'">
          <div class="qr-area">
            <img v-if="qrImage" class="qr-image" :src="qrImage" alt="登录二维码" />
            <span v-else class="qr-placeholder">正在获取二维码…</span>
          </div>
          <p class="hint">{{ qrHint }}</p>
        </template>

        <template v-else>
          <aicode-field label="手机号">
            <aicode-input v-model="mobile" placeholder="11 位手机号" />
          </aicode-field>
          <aicode-field label="验证码">
            <aicode-input v-model="code" placeholder="短信验证码" />
          </aicode-field>
          <div class="dialog-actions">
            <aicode-button :disabled="busy || !mobile.trim()" @click="sendCode">发送验证码</aicode-button>
            <aicode-button variant="primary" :disabled="busy || !mobile.trim() || !code.trim()" @click="loginByPhone">
              登录
            </aicode-button>
          </div>
        </template>
      </template>

      <p v-if="loginHint" class="hint">{{ loginHint }}</p>
    </aicode-dialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { DEFAULT_SETTINGS, normalizeSettings, type SearchResult } from '../shared/types';

interface AccountInfo {
  userId: string;
  nickname: string;
  avatarUrl: string;
  savedAt: number;
}

interface InvokeResult<T> {
  ok?: boolean;
  code?: string;
  message?: string;
  data?: T;
}

const keywords = ref('');
const songs = ref<SearchResult['songs']>([]);
const page = ref(1);
const loading = ref(false);
const searched = ref(false);
const hint = ref('');

const apiBaseUrl = ref(DEFAULT_SETTINGS.apiBaseUrl);
const pageSize = ref(DEFAULT_SETTINGS.pageSize);

const account = ref<AccountInfo | null>(null);
const accountOpen = ref(false);
const loginTab = ref<'qr' | 'phone'>('qr');
const qrImage = ref('');
const qrKey = ref('');
const qrHint = ref('');
const mobile = ref('');
const code = ref('');
const loginHint = ref('');
const busy = ref(false);

let qrTimer: ReturnType<typeof setInterval> | null = null;

function stopQrPolling(): void {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

async function loadSettings(): Promise<void> {
  try {
    const result = await aicode.invoke<{ settings?: unknown }>('ui.settings.get');
    const normalized = normalizeSettings(result?.settings);
    apiBaseUrl.value = normalized.apiBaseUrl;
    pageSize.value = normalized.pageSize;
  } catch (error) {
    hint.value = '读取设置失败：' + (error as Error).message;
  }
}

async function saveSettings(): Promise<void> {
  try {
    const result = await aicode.invoke<{ settings?: unknown }>('ui.settings.save', {
      settings: { apiBaseUrl: apiBaseUrl.value, pageSize: pageSize.value }
    });
    const normalized = normalizeSettings(result?.settings);
    apiBaseUrl.value = normalized.apiBaseUrl;
    pageSize.value = normalized.pageSize;
  } catch (error) {
    hint.value = '保存设置失败：' + (error as Error).message;
  }
}

async function refreshAccount(): Promise<void> {
  try {
    const result = await aicode.invoke<{ signedIn?: boolean; account?: AccountInfo | null }>('ui.account.state');
    account.value = result?.signedIn && result.account ? result.account : null;
  } catch {
    account.value = null;
  }
}

async function runSearch(target: number): Promise<void> {
  const word = keywords.value.trim();
  if (!word) return;
  loading.value = true;
  hint.value = '';
  try {
    const result = await aicode.invoke<InvokeResult<SearchResult>>('ui.search', {
      keywords: word,
      page: target,
      pageSize: pageSize.value
    });
    if (result?.ok !== true) {
      hint.value = result?.message || '搜索失败';
      songs.value = [];
      searched.value = true;
      return;
    }
    songs.value = result.songs ?? [];
    page.value = result.page ?? target;
    searched.value = true;
    if (songs.value.length === 0) hint.value = '';
  } catch (error) {
    hint.value = '搜索失败：' + (error as Error).message;
  } finally {
    loading.value = false;
  }
}

function openAccount(): void {
  accountOpen.value = true;
  loginHint.value = '';
  if (account.value) return;
  if (loginTab.value === 'qr') void openQr();
}

async function openQr(): Promise<void> {
  loginTab.value = 'qr';
  stopQrPolling();
  qrImage.value = '';
  qrHint.value = '正在获取二维码…';
  try {
    const result = await aicode.invoke<InvokeResult<{ key: string; image: string }>>('ui.login.qr');
    if (result?.ok !== true || !result.key) {
      qrHint.value = result?.message || '二维码获取失败';
      return;
    }
    qrKey.value = result.key;
    qrImage.value = result.image;
    qrHint.value = '用酷狗音乐 App 扫码登录';
    qrTimer = setInterval(() => {
      void pollQr();
    }, 3000);
  } catch (error) {
    qrHint.value = '二维码获取失败：' + (error as Error).message;
  }
}

async function pollQr(): Promise<void> {
  if (!qrKey.value || account.value) {
    stopQrPolling();
    return;
  }
  try {
    const result = await aicode.invoke<
      InvokeResult<{ status: number; nickname?: string; account?: AccountInfo | null }>
    >('ui.login.qrCheck', { key: qrKey.value });
    if (result?.ok !== true) {
      qrHint.value = result?.message || '二维码状态查询失败';
      stopQrPolling();
      return;
    }
    const status = result.status ?? 0;
    if (status === 2) qrHint.value = '已扫码，请在手机上确认';
    else if (status === 4) {
      qrHint.value = '登录成功';
      stopQrPolling();
      account.value = result.account ?? null;
      await refreshAccount();
    } else if (status === 0) {
      qrHint.value = '二维码已过期，请重新打开';
      stopQrPolling();
    }
  } catch (error) {
    qrHint.value = '状态查询失败：' + (error as Error).message;
    stopQrPolling();
  }
}

async function sendCode(): Promise<void> {
  busy.value = true;
  loginHint.value = '';
  try {
    const result = await aicode.invoke<InvokeResult<unknown>>('ui.login.sendCode', { mobile: mobile.value.trim() });
    loginHint.value = result?.ok === true ? '验证码已发送' : result?.message || '发送失败';
  } catch (error) {
    loginHint.value = '发送失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function loginByPhone(): Promise<void> {
  busy.value = true;
  loginHint.value = '';
  try {
    const result = await aicode.invoke<InvokeResult<{ account?: AccountInfo | null }>>('ui.login.phone', {
      mobile: mobile.value.trim(),
      code: code.value.trim()
    });
    if (result?.ok === true) {
      loginHint.value = '登录成功';
      await refreshAccount();
      accountOpen.value = false;
    } else {
      loginHint.value = result?.message || '登录失败';
    }
  } catch (error) {
    loginHint.value = '登录失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

async function logout(): Promise<void> {
  busy.value = true;
  try {
    await aicode.invoke('ui.account.logout');
    account.value = null;
    loginHint.value = '已退出登录';
    loginTab.value = 'qr';
    qrImage.value = '';
    qrHint.value = '';
  } catch (error) {
    loginHint.value = '退出失败：' + (error as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await loadSettings();
  await refreshAccount();
});

onBeforeUnmount(stopQrPolling);
</script>

<style scoped>
.music-page,
.music-page * {
  box-sizing: border-box;
}

.aicode-page-header {
  gap: 12px;
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 45%;
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--aicode-surface-container);
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
  cursor: pointer;
}

.account-chip.signed {
  color: var(--aicode-on-surface);
}

.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-bar {
  display: flex;
  gap: 8px;
  padding: 8px 16px 4px;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--aicode-outline-variant);
  border-radius: 12px;
  background: var(--aicode-surface-container);
  color: var(--aicode-on-surface);
  font: inherit;
}

.search-button {
  flex: none;
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  background: var(--aicode-primary);
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.search-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.hint {
  margin: 6px 16px;
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
  line-height: 1.5;
}

.song-list {
  margin: 4px 0 0;
  padding: 0 8px;
  list-style: none;
}

.song-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
}

.song-item:active {
  background: var(--aicode-surface-variant);
}

.cover {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--aicode-surface-variant);
}

.cover-empty {
  display: block;
}

.song-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.song-title {
  overflow: hidden;
  color: var(--aicode-on-surface);
  font-size: 14px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-meta {
  overflow: hidden;
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-detail {
  color: var(--aicode-subtle-text, var(--aicode-on-surface-variant));
  font-size: 11px;
  line-height: 1.4;
}

.empty {
  margin: 16px;
  color: var(--aicode-on-surface-variant);
  font-size: 13px;
  text-align: center;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px 16px;
}

.pager-button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--aicode-outline-variant);
  border-radius: 10px;
  background: transparent;
  color: var(--aicode-on-surface);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.pager-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.pager-text {
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
}

.login-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.tab {
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

.tab.active {
  border-color: var(--aicode-primary);
  color: var(--aicode-primary);
}

.qr-area {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  padding: 8px;
}

.qr-image {
  width: 160px;
  height: 160px;
  border-radius: 8px;
  background: #fff;
}

.qr-placeholder {
  color: var(--aicode-on-surface-variant);
  font-size: 13px;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.avatar-lg {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
}

.account-name {
  font-size: 15px;
}

.account-id {
  color: var(--aicode-on-surface-variant);
  font-size: 12px;
}

.dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
