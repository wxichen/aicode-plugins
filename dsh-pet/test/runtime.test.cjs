'use strict';

const { spawn } = require('child_process');
const path = require('path');

const entry = path.join(__dirname, '..', 'dist/main.js');
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
hostHandlers.set('host.overlay.create', async () => ({ overlayId: 'overlay-1', width: 260, height: 190 }));
hostHandlers.set('host.overlay.postMessage', async (params) => {
  calls.push({ overlay: params.payload });
  return { ok: true };
});
hostHandlers.set('host.overlay.close', async () => ({ ok: true }));
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

  child.stdin.end();
  child.kill();

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
        handlers: 17,
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
  process.exitCode = 1;
});
