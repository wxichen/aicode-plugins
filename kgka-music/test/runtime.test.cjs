'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const entry = path.join(__dirname, '..', 'dist/main.js');
const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });

let invokeSeq = 0;
let buffer = '';
const pending = new Map();
const hostHandlers = new Map();
const files = new Map();
const httpCalls = [];

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
  return { content: files.get(key) };
});
hostHandlers.set('host.fs.write', async (params) => {
  files.set(String(params.path), String(params.content));
  return { ok: true };
});
hostHandlers.set('host.fs.delete', async (params) => {
  files.delete(String(params.path));
  return { ok: true };
});

/**
 * 把 host.http.request 转发到本地假服务：不依赖外网也能验证 URL 拼接、
 * 请求头、状态码处理与字段映射。
 */
hostHandlers.set('host.http.request', async (params) => {
  httpCalls.push({ url: params.url, method: params.method, headers: params.headers });
  return await new Promise((resolve) => {
    const url = new URL(params.url);
    const body = params.body == null ? null : String(params.body);
    const headers = { ...(params.headers || {}) };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: params.method || 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data, truncated: false })
        );
      }
    );
    req.on('error', (error) => resolve({ status: 0, headers: {}, body: String(error.message) }));
    if (body) req.write(body);
    req.end();
  });
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
    send({ jsonrpc: '2.0', id, method: 'ui.invoke', params: { handler: name, args: args || {} } });
  });
}

/** 本地假接口：覆盖搜索、二维码、验证码、手机号登录、扫码确认与刷新。 */
function startFakeApi() {
  const qrState = { polls: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const sendJson = (status, payload, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === '/search') {
      const keywords = url.searchParams.get('keywords') || '';
      if (keywords === 'empty') return sendJson(200, []);
      if (keywords === 'boom') return sendJson(500, { message: 'server error' });
      return sendJson(200, [
        {
          FileHash: 'HASH-1',
          FileName: '周杰伦 - 晴天',
          OriSongName: '晴天',
          SingerName: '周杰伦',
          AlbumName: '叶惠美',
          AlbumID: '966846',
          Duration: 269,
          Image: 'http://example.com/cover.jpg',
          Bitrate: 128,
          FileSize: 4317292,
          ExtName: 'mp3'
        },
        { FileName: '没有 hash 的条目' }
      ]);
    }

    if (url.pathname === '/login/qr/key') {
      return sendJson(200, { qrcode: 'QR-KEY-1', qrcode_img: 'data:image/png;base64,AAAA' });
    }

    if (url.pathname === '/login/qr/check') {
      qrState.polls += 1;
      if (qrState.polls === 1) return sendJson(200, { status: 2 });
      return sendJson(
        200,
        { status: 4, token: 'TOKEN-QR', userid: '42', nickname: '测试用户', pic: 'http://example.com/a.png' },
        { 'X-Kg-Session-Id': 'SID-QR' }
      );
    }

    if (url.pathname === '/captcha/sent') {
      return sendJson(200, { error_code: 200 });
    }

    if (url.pathname === '/login/cellphone') {
      const mobile = url.searchParams.get('mobile') || '';
      if (mobile === '13800000000') {
        return sendJson(
          200,
          { token: 'TOKEN-PHONE', userid: '7', nickname: '手机用户', pic: 'http://example.com/b.png' },
          { 'X-Kg-Session-Id': 'SID-PHONE' }
        );
      }
      return sendJson(400, { error_code: 500, message: '验证码错误' });
    }

    if (url.pathname === '/login/token') {
      return sendJson(200, { token: 'TOKEN-REFRESH', userid: '7' }, { 'X-Kg-Session-Id': 'SID-REFRESH' });
    }

    return sendJson(404, { message: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run() {
  const failures = [];
  const server = await startFakeApi();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const saved = await invokeHandler('ui.settings.save', { settings: { apiBaseUrl: base, pageSize: 20 } });
  if (!saved || saved.settings.apiBaseUrl !== base) failures.push('设置未保存');

  const state = await invokeHandler('ui.account.state');
  if (!state || state.signedIn !== false) failures.push('初始状态应为未登录');

  const search = await invokeHandler('ui.search', { keywords: '周杰伦', page: 1 });
  if (!search || search.ok !== true) failures.push('搜索失败: ' + JSON.stringify(search));
  else {
    if (search.songs.length !== 1) failures.push('应过滤掉缺少 hash 的条目，实际 ' + search.songs.length);
    const song = search.songs[0];
    if (song.title !== '晴天') failures.push('标题映射错误: ' + song.title);
    if (song.singer !== '周杰伦') failures.push('歌手映射错误: ' + song.singer);
    if (song.duration !== 269) failures.push('时长映射错误: ' + song.duration);
  }

  const searchCall = httpCalls.find((call) => call.url.includes('/search'));
  if (!searchCall) failures.push('未发出搜索请求');
  else {
    const url = new URL(searchCall.url);
    if (url.searchParams.get('keywords') !== '周杰伦') failures.push('搜索参数 keywords 丢失');
    if (url.searchParams.get('type') !== 'song') failures.push('搜索参数 type 应为 song');
    if (url.searchParams.get('pagesize') !== '20') {
      failures.push('pagesize 未使用设置值: ' + url.searchParams.get('pagesize'));
    }
  }

  const emptySearch = await invokeHandler('ui.search', { keywords: 'empty' });
  if (!emptySearch || emptySearch.ok !== true || emptySearch.songs.length !== 0) failures.push('空结果处理异常');

  const failedSearch = await invokeHandler('ui.search', { keywords: 'boom' });
  if (!failedSearch || failedSearch.ok !== false) failures.push('接口 5xx 时未返回失败');
  if (failedSearch && !String(failedSearch.message || '').includes('500')) {
    failures.push('5xx 失败信息未带状态码');
  }

  const toolSearch = await invokeHandler('tools.search', { keywords: '周杰伦', pageSize: 5 });
  if (!toolSearch || toolSearch.count !== 1) failures.push('tools.search 返回异常');
  if (toolSearch && toolSearch.songs && toolSearch.songs[0] && toolSearch.songs[0].hash !== 'HASH-1') {
    failures.push('tools.search 未返回 hash');
  }

  const qr = await invokeHandler('ui.login.qr');
  if (!qr || qr.ok !== true || !qr.key) failures.push('二维码获取失败');

  const firstPoll = await invokeHandler('ui.login.qrCheck', { key: qr.key });
  if (!firstPoll || firstPoll.status !== 2) failures.push('扫码状态 2 未透出');

  const confirmPoll = await invokeHandler('ui.login.qrCheck', { key: qr.key });
  if (!confirmPoll || confirmPoll.status !== 4 || !confirmPoll.account) failures.push('扫码确认后未建立会话');
  if (confirmPoll && confirmPoll.account && confirmPoll.account.nickname !== '测试用户') {
    failures.push('扫码登录昵称未写入: ' + JSON.stringify(confirmPoll.account));
  }

  const afterQr = await invokeHandler('ui.account.state');
  if (!afterQr || afterQr.signedIn !== true) failures.push('扫码登录后状态仍为未登录');
  if (afterQr && afterQr.account && JSON.stringify(afterQr.account).includes('TOKEN')) {
    failures.push('账号信息不应包含 token');
  }

  const logout = await invokeHandler('ui.account.logout');
  if (!logout || logout.ok !== true) failures.push('退出登录失败');

  const sendCode = await invokeHandler('ui.login.sendCode', { mobile: '13800000000' });
  if (!sendCode || sendCode.ok !== true) failures.push('发送验证码失败: ' + JSON.stringify(sendCode));

  const badMobile = await invokeHandler('ui.login.sendCode', { mobile: 'abc' });
  if (!badMobile || badMobile.ok !== false) failures.push('非法手机号未拦截');

  const badLogin = await invokeHandler('ui.login.phone', { mobile: '13900000000', code: '000000' });
  if (!badLogin || badLogin.ok !== false) failures.push('错误验证码未被判为失败');

  const login = await invokeHandler('ui.login.phone', { mobile: '13800000000', code: '123456' });
  if (!login || login.ok !== true || !login.account) failures.push('手机号登录失败: ' + JSON.stringify(login));

  const afterPhone = await invokeHandler('ui.account.state');
  if (!afterPhone || afterPhone.signedIn !== true || afterPhone.account.userId !== '7') {
    failures.push('手机号登录后状态异常');
  }

  const sessionFile = files.get('data://session.json');
  if (!sessionFile || !sessionFile.includes('TOKEN-PHONE')) failures.push('登录态未落盘');

  const refresh = await invokeHandler('ui.login.refresh');
  if (!refresh || refresh.ok !== true) failures.push('刷新登录态失败: ' + JSON.stringify(refresh));

  const toolStatus = await invokeHandler('tools.loginStatus');
  if (!toolStatus || toolStatus.signedIn !== true) failures.push('tools.loginStatus 状态错误');

  const savedSession = files.get('data://session.json');
  if (!savedSession || !savedSession.includes('TOKEN-REFRESH')) failures.push('刷新后的 token 未落盘');

  child.stdin.end();
  child.kill();
  server.close();

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
        httpCalls: httpCalls.length,
        searchedSongs: search.songs.length,
        qrStatus: confirmPoll.status,
        phoneUser: afterPhone.account.userId,
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
