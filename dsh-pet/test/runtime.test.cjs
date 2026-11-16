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

  const runFinish = await invokeHandler('hooks.runFinished', { sessionId: 's1', status: 'success' });
  if (!runFinish || runFinish.ok !== true) failures.push('hooks.runFinished 失败');

  const notified = await waitFor(() => calls.some((item) => item.notify));
  if (!notified) failures.push('run.finished 未通知');

  const saved = await invokeHandler('ui.settings.save', {
    settings: { ...state.settings, petName: '保存后的桌宠', pet: { ...state.settings.pet, size: 240 } }
  });
  if (!saved || !saved.settings || saved.settings.petName !== '保存后的桌宠') failures.push('配置保存失败');
  if (!files.has('data://config.json') || files.get('data://config.json').indexOf('保存后的桌宠') < 0) {
    failures.push('保存内容未写入 data://config.json');
  }

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
        handlers: 12,
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
