'use strict';

const { spawn } = require('child_process');
const path = require('path');

const entry = path.join(__dirname, '..', 'dist/main.js');
const audioServer = require('http').createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
  res.end(Buffer.alloc(1024, 1));
});
let audioPort = 0;
const audioReady = new Promise((resolve) => audioServer.listen(0, '127.0.0.1', () => { audioPort = audioServer.address().port; resolve(); }));

const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });

let seq = 0;
let invokeSeq = 0;
let buffer = '';
const pending = new Map();
const hostHandlers = new Map();
const calls = [];
const ttsCalls = [];
const files = new Map();

files.set(
  'data://config.json',
  JSON.stringify({ petName: '测试桌宠', pet: { enabled: true, autoStart: true, size: 200 } })
);

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

hostHandlers.set('host.fs.read', async (params) => {
  const key = String(params.path);
  if (!files.has(key)) {
    const error = new Error('not found: ' + key);
    error.code = 'FILE_NOT_FOUND';
    throw error;
  }
  const content = files.get(key);
  return { content, size: content.length };
});hostHandlers.set('host.fs.write', async (params) => {
  files.set(String(params.path), String(params.content));
  return { ok: true };
});
hostHandlers.set('host.fs.writeBinary', async (params) => {
  files.set(String(params.path), String(params.base64));
  return { ok: true };
});
hostHandlers.set('host.fs.mkdir', async () => ({ ok: true }));
hostHandlers.set('host.fs.readBinary', async (params) => ({ base64: files.get(String(params.path)) || '' }));
hostHandlers.set('host.overlay.create', async () => ({ overlayId: 'overlay-1', width: 260, height: 190 }));
hostHandlers.set('host.overlay.postMessage', async (params) => {
  calls.push({ overlay: params.payload });
  return { ok: true };
});
hostHandlers.set('host.overlay.close', async () => ({ ok: true }));
const musicRequests = [];
const musicState = { qrPolls: 0 };
hostHandlers.set('host.http.request', async (params) => {
  const url = new URL(params.url);
  const rawBody = params.body == null ? '' : String(params.body);
  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  musicRequests.push({ path: url.pathname, method: params.method, query: url.search, body, headers: params.headers });

  const json = (status, payload, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    truncated: false
  });

  if (url.pathname === '/search') {
    const keywords = url.searchParams.get('keywords') || '';
    if (keywords === 'empty') return json(200, []);
    return json(200, [
      {
        FileHash: 'HASH-1',
        FileName: '周杰伦 - 晴天',
        OriSongName: '晴天',
        SingerName: '周杰伦',
        AlbumName: '叶惠美',
        Duration: 269,
        Bitrate: 128,
        Image: 'http://example.com/c.jpg',
        ExtName: 'mp3',
        AlbumID: '1',
        MixSongID: '32100650'
      },
      { FileName: '缺少 hash 的条目' }
    ]);
  }
  if (url.pathname === '/captcha/sent') {
    // 真实接口的成功响应形状
    return json(200, { code: 0, status: 1, error_code: 0, count: 9 });
  }
  if (url.pathname === '/login/cellphone') {
    // 真实接口要求 JSON body；这里模拟缺失 body 时的 400
    if (!body || !body.mobile) {
      return json(400, {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { '': ['A non-empty request body is required.'] }
      });
    }
    if (body.mobile === '13800000000') {
      return json(
        200,
        { token: 'TOKEN-PHONE', userid: '7', nickname: '手机用户', pic: 'http://example.com/b.png' },
        { 'X-Kg-Session-Id': 'SID-PHONE' }
      );
    }
    return json(400, { message: '验证码错误' });
  }
  if (url.pathname === '/song/url') {
    // 未登录时真实服务返回 400 + 20028；这里按是否有会话头区分。
    if (!params.headers || !params.headers['X-Kg-Session-Id']) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: null, errcode: 20028, error: '本次请求需要验证' }),
        truncated: false
      };
    }
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:' + audioPort + '/song.mp3', hash: url.searchParams.get('hash') }),
      truncated: false
    };
  }
  if (url.pathname === '/search/lyric') {
    return {
      status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidates: [{ id: 'L1', accesskey: 'KEY1', song: '晴天' }] }), truncated: false
    };
  }
  if (url.pathname === '/lyric') {
    return {
      status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decodedContent: '[00:01.00]第一句\n[00:02.00]第二句\n' }), truncated: false
    };
  }
  if (url.pathname === '/login/qr/key') {
    return json(200, { qrcode: 'QR-KEY-1', qrcode_img: 'data:image/png;base64,AAAA' });
  }
  if (url.pathname === '/login/qr/check') {
    musicState.qrPolls += 1;
    if (musicState.qrPolls === 1) return json(200, { status: 2 });
    return json(
      200,
      { status: 4, token: 'TOKEN-QR', userid: '42', nickname: '测试用户', pic: 'http://example.com/a.png' },
      { 'X-Kg-Session-Id': 'SID-QR' }
    );
  }
  if (url.pathname === '/login/token') {
    return json(200, { token: 'TOKEN-REFRESH', userid: '7' }, { 'X-Kg-Session-Id': 'SID-REFRESH' });
  }
  return json(404, { message: 'not found' });
});

hostHandlers.set('host.ui.openUrl', async (params) => { calls.push({ openUrl: params.url }); return { ok: true }; });
hostHandlers.set('host.notify', async (params) => {
  calls.push({ notify: params });
  return { ok: true };
});
hostHandlers.set('host.model.listProviders', async () => ({
  providers: [
    {
      id: 'fake',
      name: 'Fake',
      type: 'openai',
      enabled: true,
      hasKey: true,
      isPlugin: false,
      type: 'openai',
      isDefault: true,
      defaultModel: 'fake-chat',
      selectedModel: 'fake-chat',
      modelCount: 1
    }
  ]
}));
hostHandlers.set('host.model.listModels', async () => ({
  providerId: 'fake',
  models: [{ id: 'fake-chat', displayName: 'Fake Chat', modelType: 'chat' }]
}));
hostHandlers.set('host.model.create', async () => ({ handle: { id: 'handle-1', providerId: 'fake', model: 'fake-chat' } }));
hostHandlers.set('host.model.start', async (params) => {
  calls.push({ prompt: params.messages[0].content });
  return { streamId: 'stream-1' };
});
hostHandlers.set('host.model.read', async () => ({
  cursor: 1,
  done: true,
  status: 'success',
  final: { content: '模型生成的一句台词。' }
}));
hostHandlers.set('host.model.close', async () => ({ ok: true }));
const secrets = new Map();
hostHandlers.set('host.secrets.get', async (params) => ({ value: secrets.get(String(params.key)) ?? null }));
hostHandlers.set('host.secrets.set', async (params) => { secrets.set(String(params.key), String(params.value)); return { ok: true }; });
hostHandlers.set('host.secrets.delete', async (params) => { secrets.delete(String(params.key)); return { ok: true }; });

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    // 插件发往宿主的请求：带 method 与 id。
    if (message.method && message.id !== undefined) {
      const handler = hostHandlers.get(message.method);
      if (!handler) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: 'METHOD_UNKNOWN', message: message.method } });
        continue;
      }
      Promise.resolve()
        .then(() => handler(message.params || {}))
        .then((result) => send({ jsonrpc: '2.0', id: message.id, result }))
        .catch((error) =>
          send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: error.code || 'HOST_ERROR', message: String(error.message || error) }
          })
        );
      continue;
    }
    // 插件主动推送事件。
    if (message.method === 'plugin.event') {
      calls.push({ event: message.params && message.params.name });
      continue;
    }
    // 宿主请求的响应。
    if (message.id !== undefined) {
      const waiter = pending.get(String(message.id));
      if (!waiter) continue;
      pending.delete(String(message.id));
      if (message.error) {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        waiter.reject(error);
      } else {
        waiter.resolve(message.result === undefined ? null : message.result);
      }
    }
  }
});

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

function invokeHandler(name, args) {
  const id = 'invoke-' + ++invokeSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method: 'tool.invoke', params: { handler: name, args: args || {} } });
  });
}

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 50);
  });
}

async function run() {
  await audioReady;
  const failures = [];
  const boot = await invokeHandler('hooks.boot');
  if (!boot || boot.ok !== true) failures.push('hooks.boot 未成功');

  const state = await invokeHandler('ui.pet.state');
  if (!state || !state.settings || !state.state) failures.push('ui.pet.state 缺少 settings/state');
  else if (state.settings.petName !== '测试桌宠') failures.push('配置未读取');

  const pushedSettings = await waitFor(() => calls.some((item) => item.overlay && item.overlay.type === 'pet.settings'));
  const pushedState = await waitFor(() => calls.some((item) => item.overlay && item.overlay.type === 'pet.state'));
  if (!pushedSettings) failures.push('未推送设置消息');
  if (!pushedState) failures.push('未推送状态消息');

  const said = await invokeHandler('tools.say', { text: '你好，AiCode' });
  if (!said || said.ok !== true) failures.push('tools.say 失败');

  const played = await invokeHandler('tools.play', { animation: 'action' });
  if (!played || played.ok !== true) failures.push('tools.play 失败');

  const slept = await invokeHandler('tools.sleep', { action: 'sleep' });
  if (!slept || slept.sleeping !== true) failures.push('tools.sleep sleep 失败');

  const woke = await invokeHandler('tools.sleep', { action: 'wake' });
  if (!woke || woke.sleeping !== false) failures.push('tools.sleep wake 失败');

  const sleepingClick = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.click' }
  });
  if (!sleepingClick || sleepingClick.ok !== true) failures.push('overlay 点击失败');

  const runStart = await invokeHandler('hooks.runStarted', { sessionId: 's1' });
  if (!runStart || runStart.ok !== true) failures.push('hooks.runStarted 失败');

  const busyStart = await invokeHandler('hooks.toolStarted', { sessionId: 's1', callId: 'c1', toolName: 'readFile' });
  if (!busyStart || busyStart.ok !== true) failures.push('hooks.toolStarted 失败');

  const secondTool = await invokeHandler('hooks.toolStarted', { sessionId: 's1', callId: 'c2', toolName: 'writeFile' });
  if (!secondTool || secondTool.ok !== true) failures.push('第二个 hooks.toolStarted 失败');
  const busyPushed = await waitFor(() =>
    calls.some((item) => item.overlay && item.overlay.type === 'pet.state' && item.overlay.state.lastAnimation === 'working')
  );
  if (!busyPushed) failures.push('工具并发时未切换到忙碌动画');

  const toolDone = await invokeHandler('hooks.toolFinished', { sessionId: 's1', callId: 'c2', toolName: 'writeFile', status: 'success' });
  if (!toolDone || toolDone.ok !== true) failures.push('hooks.toolFinished 失败');

  const runFinish = await invokeHandler('hooks.runFinished', { sessionId: 's1', status: 'success' });
  if (!runFinish || runFinish.ok !== true) failures.push('hooks.runFinished 失败');

  const notified = await waitFor(() => calls.some((item) => item.notify));
  if (!notified) failures.push('run.finished 未通知');

  const modelLine = await waitFor(() =>
    calls.some((item) => item.overlay && item.overlay.type === 'pet.state' && item.overlay.state.lastText === '模型生成的一句台词。')
  );
  if (!modelLine) failures.push('未采用模型生成的台词');
  const prompted = calls.some((item) => typeof item.prompt === 'string' && item.prompt.includes('成功'));
  if (!prompted) failures.push('模型提示词未描述本次状态');

  const moodBefore = (await invokeHandler('ui.pet.state')).state.mood;
  const patted = await invokeHandler('tools.interact', { kind: 'headpat' });
  if (!patted || patted.ok !== true) failures.push('tools.interact 失败');
  if (typeof patted.mood === 'number' && patted.mood <= moodBefore) failures.push('摸头未提升心情值');

  const unknownInteraction = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.interact', kind: 'nope' }
  });
  if (!unknownInteraction || unknownInteraction.ok !== false) failures.push('未知互动未返回失败');

  const saved = await invokeHandler('ui.settings.save', {
    settings: { ...state.settings, petName: '保存后的桌宠', pet: { ...state.settings.pet, size: 240 } }
  });
  if (!saved || !saved.settings || saved.settings.petName !== '保存后的桌宠') failures.push('配置保存失败');
  if (!files.has('data://config.json') || files.get('data://config.json').indexOf('保存后的桌宠') < 0) {
    failures.push('保存内容未写入 data://config.json');
  }

  const overlaySleep = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.toggleSleep' }
  });
  if (!overlaySleep || overlaySleep.ok !== true || typeof overlaySleep.sleeping !== 'boolean') {
    failures.push('浮层 pet.toggleSleep 未生效');
  }

  const overlayWake = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.toggleSleep' }
  });
  if (!overlayWake || overlayWake.sleeping !== false) failures.push('浮层再次切换睡眠未生效');

  const overlayInteract = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.interact', kind: 'feed' }
  });
  if (!overlayInteract || overlayInteract.ok !== true) failures.push('浮层 pet.interact 未生效');

  const overlayHide = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.hide' }
  });
  if (!overlayHide || overlayHide.ok !== true) failures.push('浮层 pet.hide 未生效');
  const enabledAfterHide = (await invokeHandler('ui.pet.state')).settings.pet.enabled;
  if (enabledAfterHide !== false) failures.push('浮层 pet.hide 未关闭启用开关');

  // TTS：用本地 HTTP 服务当假供应商，验证进程真的拿到音频字节并推给浮层。
  const ttsServer = require('http').createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      ttsCalls.push({ url: req.url, auth: req.headers.authorization, body: parsed });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x01, 0x02]));
    });
  });
  await new Promise((resolve) => ttsServer.listen(0, '127.0.0.1', resolve));
  const ttsPort = ttsServer.address().port;

  await invokeHandler('ui.settings.save', {
    settings: {
      ...(await invokeHandler('ui.pet.state')).settings,
      voice: {
        mode: 'auto',
        providerId: '',
        model: '',
        speakAloud: true,
        tts: { provider: 'openai', baseUrl: 'http://127.0.0.1:' + ttsPort + '/v1', model: 'tts-test', voice: 'alloy', hasKey: true, speed: 1 }
      }
    }
  });

  const presets = await invokeHandler('ui.tts.presets');
  if (!presets || !Array.isArray(presets.presets) || presets.presets.length === 0) {
    failures.push('未从已配置供应商生成 TTS 预设');
  } else {
    const preset = presets.presets[0];
    if (preset.tts.provider !== 'openai') failures.push('预设协议推断错误: ' + preset.tts.provider);
    if (!preset.tts.model) failures.push('预设未带入默认模型');
    if (preset.providerName !== 'Fake') failures.push('预设未带入供应商名');
  }

  const keySaved = await invokeHandler('ui.tts.saveKey', { apiKey: 'sk-test-key' });
  if (!keySaved || keySaved.hasKey !== true) failures.push('TTS 密钥未保存');

  const ttsState = await invokeHandler('ui.tts.state');
  if (!ttsState || ttsState.hasKey !== true) failures.push('TTS 状态未读到密钥');

  const preview = await invokeHandler('ui.tts.preview', { text: '朗读测试' });
  if (!preview || preview.ok !== true) failures.push('TTS 试听未成功: ' + JSON.stringify(preview));
  const speechPushed = await waitFor(() =>
    calls.some((item) => item.overlay && item.overlay.type === 'pet.speech')
  );
  if (!speechPushed) failures.push('TTS 音频未推送到浮层');
  const speechPayload = calls.filter((item) => item.overlay && item.overlay.type === 'pet.speech').pop();
  if (!speechPayload || !String(speechPayload.overlay.audio.url).startsWith('data:audio/mpeg;base64,')) {
    failures.push('TTS 音频不是可播放的 data URL');
  }
  if (ttsCalls.length === 0) failures.push('TTS 未真正发出 HTTP 请求');
  else if (ttsCalls[0].auth !== 'Bearer sk-test-key') failures.push('TTS 请求未带正确 Authorization');
  ttsServer.close();

  const hidden = await invokeHandler('ui.pet.hide');
  if (!hidden || !hidden.settings || hidden.settings.pet.enabled !== false) failures.push('隐藏桌宠失败');

  // ---- 音乐：搜索与登录 ----

  const musicSearch = await invokeHandler('ui.music.search', { keywords: '周杰伦' });
  if (!musicSearch || musicSearch.ok !== true) failures.push('音乐搜索失败: ' + JSON.stringify(musicSearch));
  else {
    if (musicSearch.songs.length !== 1) failures.push('音乐搜索未过滤缺少 hash 的条目');
    if (musicSearch.songs[0].title !== '晴天') failures.push('音乐歌名映射错误');
    if (musicSearch.songs[0].singer !== '周杰伦') failures.push('音乐歌手映射错误');
  }

  const searchReq = musicRequests.find((r) => r.path === '/search');
  if (!searchReq) failures.push('未发出音乐搜索请求');
  else {
    if (!searchReq.query.includes('keywords=')) failures.push('音乐搜索未带 keywords');
    if (!searchReq.query.includes('type=song')) failures.push('音乐搜索未带 type=song');
  }

  const emptyMusic = await invokeHandler('ui.music.search', { keywords: 'empty' });
  if (!emptyMusic || emptyMusic.ok !== true || emptyMusic.songs.length !== 0) {
    failures.push('音乐空结果处理异常');
  }

  // 关键回归：验证码走 query，登录走 JSON body。
  const codeRes = await invokeHandler('ui.music.sendCode', { mobile: '13800000000' });
  if (!codeRes || codeRes.ok !== true) failures.push('发送验证码被判为失败: ' + JSON.stringify(codeRes));
  const codeReq = musicRequests.filter((r) => r.path === '/captcha/sent').pop();
  if (!codeReq) failures.push('未发出验证码请求');
  else {
    if (!codeReq.query.includes('mobile=13800000000')) failures.push('验证码参数应放在 query');
    if (codeReq.body) failures.push('验证码接口不应发送 JSON body');
  }

  const phoneLogin = await invokeHandler('ui.music.loginPhone', { mobile: '13800000000', code: '123456' });
  if (!phoneLogin || phoneLogin.ok !== true) failures.push('手机号登录失败: ' + JSON.stringify(phoneLogin));
  const loginReq = musicRequests.filter((r) => r.path === '/login/cellphone').pop();
  if (!loginReq) failures.push('未发出登录请求');
  else if (!loginReq.body || loginReq.body.mobile !== '13800000000' || loginReq.body.code !== '123456') {
    failures.push('登录参数应以 JSON body 发送: ' + JSON.stringify(loginReq.body));
  }

  const musicAccount = await invokeHandler('ui.music.account');
  if (!musicAccount || musicAccount.signedIn !== true) failures.push('登录后音乐账号状态未更新');
  if (musicAccount && musicAccount.account && JSON.stringify(musicAccount.account).includes('TOKEN')) {
    failures.push('音乐账号信息不应包含 token');
  }
  if (!files.get('data://music-session.json')) failures.push('音乐登录态未落盘');

  const qr = await invokeHandler('ui.music.qr');
  if (!qr || qr.ok !== true || !qr.key) failures.push('音乐二维码获取失败');
  const poll1 = await invokeHandler('ui.music.qrCheck', { key: qr.key });
  if (!poll1 || poll1.status !== 2) failures.push('扫码状态 2 未透出');
  const poll2 = await invokeHandler('ui.music.qrCheck', { key: qr.key });
  if (!poll2 || poll2.status !== 4 || !poll2.account) failures.push('扫码确认后未建立会话');

  const musicTool = await invokeHandler('tools.searchMusic', { keywords: '周杰伦', pageSize: 5 });
  if (!musicTool || musicTool.count !== 1) failures.push('tools.searchMusic 返回异常');

  const accountTool = await invokeHandler('tools.musicAccount');
  if (!accountTool || accountTool.signedIn !== true) failures.push('tools.musicAccount 状态错误');

  const musicLogout = await invokeHandler('ui.music.logout');
  if (!musicLogout || musicLogout.ok !== true) failures.push('音乐退出登录失败');
  const afterLogout = await invokeHandler('ui.music.account');
  if (afterLogout && afterLogout.signedIn !== false) failures.push('退出后音乐账号状态未清空');

  // ---- 封面 https 化 ----

  const coverSong = (musicSearch.songs && musicSearch.songs[0]) || null;
  if (coverSong) {
    if (!String(coverSong.cover).startsWith('https://')) {
      failures.push('封面未升级为 https（CSP 只允许 https）: ' + coverSong.cover);
    }
    if (!coverSong.albumAudioId) failures.push('未映射 albumAudioId（播放需要 MixSongID）');
  }

  // ---- 收藏歌单 ----

  const created = await invokeHandler('ui.music.createList', { name: '测试歌单' });
  if (!created || created.ok !== true || !created.list) failures.push('新建歌单失败');
  const listId = created && created.list ? created.list.id : '';

  const favSong = {
    hash: 'HASH-1',
    title: '晴天',
    singer: '周杰伦',
    album: '叶惠美',
    duration: 269,
    cover: 'https://example.com/c.jpg',
    fileName: '',
    bitrate: 128,
    fileSize: 0,
    extName: 'mp3',
    albumId: '966846',
    albumAudioId: '32100650'
  };
  const added = await invokeHandler('ui.music.toggleFavorite', { song: favSong, listId });
  if (!added || added.ok !== true || added.favorited !== true) failures.push('收藏歌曲失败');

  const again = await invokeHandler('ui.music.toggleFavorite', { song: favSong, listId });
  if (!again || again.ok !== true) failures.push('重复收藏应成功');

  const listDetail = await invokeHandler('ui.music.favoriteList', { id: listId });
  if (!listDetail || !listDetail.list || listDetail.list.songs.length !== 1) {
    failures.push('重复收藏应只保留一条，实际 ' + (listDetail && listDetail.list ? listDetail.list.songs.length : 'n/a'));
  }

  const hashes = await invokeHandler('ui.music.favoriteHashes');
  if (!hashes || !hashes.hashes.includes('HASH-1')) failures.push('收藏 hash 列表缺少歌曲');

  if (!files.get('data://music-favorites.json')) failures.push('收藏未落盘');

  // ---- 播放：未登录应给出明确原因，登录后能拿到地址 ----

  await invokeHandler('ui.music.logout');
  const noSessionPlay = await invokeHandler('ui.music.playUrl', { song: favSong });
  if (!noSessionPlay || noSessionPlay.ok !== false) failures.push('未登录播放应失败');
  if (noSessionPlay && noSessionPlay.code !== 'NO_SESSION') {
    failures.push('未登录播放应返回 NO_SESSION，实际 ' + noSessionPlay.code);
  }

  const phoneLogin2 = await invokeHandler('ui.music.loginPhone', { mobile: '13800000000', code: '123456' });
  if (!phoneLogin2 || phoneLogin2.ok !== true) failures.push('播放测试前登录失败');

  const playOk = await invokeHandler('ui.music.playUrl', { song: favSong });
  if (!playOk || playOk.ok !== true || !playOk.url) failures.push('登录后取播放地址失败: ' + JSON.stringify(playOk));

  if (playOk && (!playOk.chunks || playOk.chunks.length === 0)) failures.push('播放未返回音频切片');
  const singPush = calls.filter((c) => c.overlay && c.overlay.type === 'pet.sing').pop();
  if (!singPush) failures.push('播放未把切片推给浮层');
  else if (!Array.isArray(singPush.overlay.chunks) || singPush.overlay.chunks.length === 0) {
    failures.push('推送的 pet.sing 缺少 chunks');
  }
  if (calls.some((c) => c.openUrl)) failures.push('不应再调用 openUrl（会跳浏览器）');

  const playReq = musicRequests.filter((r) => r.path === '/song/url').pop();
  if (!playReq) failures.push('未发出 /song/url 请求');
  else if (!playReq.query.includes('album_audio_id=32100650')) {
    failures.push('/song/url 未带数字 album_audio_id');
  }
  if (playReq && !playReq.query.includes('quality=128')) {
    failures.push('quality 必须是 128（standard 会返回 20010）: ' + playReq.query);
  }

  // ---- 桌宠唱歌 ----

  const sing = await invokeHandler('ui.pet.sing', { listId });
  if (!sing || sing.ok !== true) failures.push('桌宠唱歌失败: ' + JSON.stringify(sing));
  if (sing && typeof sing.lyrics === 'number' && sing.lyrics === 0) failures.push('唱歌未带上歌词');

  const singStop = await invokeHandler('overlay.message', {
    overlayId: 'overlay-1',
    payload: { type: 'pet.stopSing' }
  });
  if (!singStop || singStop.ok !== true) failures.push('停止唱歌失败');

  const removed = await invokeHandler('ui.music.toggleFavorite', { song: favSong, listId, remove: true });
  if (!removed || removed.favorited !== false) failures.push('取消收藏失败');

  const afterRemove = await invokeHandler('ui.music.favoriteList', { id: listId });
  if (!afterRemove || afterRemove.list.songs.length !== 0) failures.push('取消收藏后歌单未清空');

  const emptySing = await invokeHandler('ui.pet.sing', { listId });
  if (!emptySing || emptySing.ok !== false || emptySing.code !== 'EMPTY_FAVORITES') {
    failures.push('空收藏时唱歌应提示 EMPTY_FAVORITES');
  }

  child.stdin.end();
  child.kill();
  audioServer.close();

  if (failures.length > 0) {
    console.error('FAIL');
    for (const item of failures) console.error('- ' + item);
    process.exitCode = 1;
    return;
  }
  console.log('PASS');
  console.log(
    JSON.stringify(
      {
        handlers: 52,
        hostCalls: calls.length,
        savedConfigName: saved.settings.petName,
        overlayOpenAfterHide: hidden.settings.pet.enabled,
        files: [...files.keys()]
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error('ERROR', error);
  child.kill();
  audioServer.close();
  process.exitCode = 1;
});
