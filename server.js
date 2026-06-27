'use strict';

const http = require('http');
const {
  buildAuthConnectUrl,
  collectChatCompletion,
  exchangeAuthCode,
  pollAuthCode,
  streamChatCompletion,
  verifyApiKey,
} = require('./src/kombaiClient');
const { AccountPool, isRetryableAccountError } = require('./src/accountPool');
const { makeChatChunk, makeChatCompletion, randomId } = require('./src/openaiCompat');
const { autoRegisterAccount } = require('./src/autoRegister');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const accountPool = new AccountPool();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function sendError(res, status, message, type = 'invalid_request_error') {
  sendJson(res, status, {
    error: {
      message,
      type,
      code: status,
    },
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = new Error('请求体不是合法 JSON');
    parseError.statusCode = 400;
    parseError.type = 'invalid_request_error';
    throw parseError;
  }
}

function getRequestApiKey(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
  return '';
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function finishReasonFor(toolCalls) {
  return toolCalls.length > 0 ? 'tool_calls' : 'stop';
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function adminTokenFromRequest(req, url) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-admin-token']) return String(req.headers['x-admin-token']).trim();
  return url.searchParams.get('token') || '';
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

function requireAdmin(req, res, url) {
  if (ADMIN_TOKEN) {
    if (adminTokenFromRequest(req, url) === ADMIN_TOKEN) return true;
    sendError(res, 401, 'admin token 无效或缺失', 'authentication_error');
    return false;
  }

  if (isLocalRequest(req)) return true;
  sendError(res, 403, '未设置 ADMIN_TOKEN 时，仅允许本机访问 /admin/api', 'authentication_error');
  return false;
}

function extractApiKeyToken(data) {
  if (!data || typeof data !== 'object') return '';
  return data.apiKeyToken
    || data.apiKey
    || data.token
    || (data.data && extractApiKeyToken(data.data))
    || '';
}

async function runCollectWithPool(body, directApiKey, requestId) {
  const attempts = accountPool.accountAttempts(directApiKey);
  if (attempts.length === 0) {
    const error = new Error('号池为空。请在 /admin 添加已授权 Kombai API key，或在请求里传 Authorization: Bearer <apiKeyToken>。');
    error.statusCode = 401;
    error.type = 'authentication_error';
    throw error;
  }

  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const proxy = accountPool.pickProxy();
    const context = { ...attempt, proxy };
    try {
      const result = await collectChatCompletion(body, attempt.apiKey, { requestId, proxy });
      accountPool.recordSuccess(context);
      return result;
    } catch (error) {
      lastError = error;
      accountPool.recordFailure(context, error);
      const canRetry = !directApiKey
        && accountPool.state.config.failoverEnabled !== false
        && isRetryableAccountError(error)
        && index < attempts.length - 1;
      if (!canRetry) throw error;
    }
  }

  throw lastError;
}

async function handleChatCompletions(req, res) {
  const directApiKey = getRequestApiKey(req);
  const body = await readJson(req);
  const model = body.model || process.env.OPENAI_MODEL_NAME || 'kombai-chat';
  const id = randomId('chatcmpl');

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const attempts = accountPool.accountAttempts(directApiKey);
    if (attempts.length === 0) {
      writeSse(res, {
        error: {
          message: '号池为空。请在 /admin 添加已授权 Kombai API key，或在请求里传 Authorization: Bearer <apiKeyToken>。',
          type: 'authentication_error',
          code: 401,
        },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const toolCalls = [];
    let roleSent = false;
    let emitted = false;
    let lastError = null;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      const proxy = accountPool.pickProxy();
      const context = { ...attempt, proxy };
      let attemptEmitted = false;

      try {
        for await (const event of streamChatCompletion({ ...body, model }, attempt.apiKey, { requestId: id, proxy })) {
          if (!roleSent) {
            writeSse(res, makeChatChunk({ id, model, delta: { role: 'assistant' } }));
            roleSent = true;
          }

          if (event.type === 'text' && event.text) {
            emitted = true;
            attemptEmitted = true;
            writeSse(res, makeChatChunk({ id, model, delta: { content: event.text } }));
          }
          if (event.type === 'tool_call' && event.toolCall) {
            emitted = true;
            attemptEmitted = true;
            const index = toolCalls.length;
            toolCalls.push(event.toolCall);
            writeSse(res, makeChatChunk({
              id,
              model,
              delta: {
                tool_calls: [
                  {
                    index,
                    ...event.toolCall,
                  },
                ],
              },
            }));
          }
        }

        accountPool.recordSuccess(context);
        if (!roleSent) writeSse(res, makeChatChunk({ id, model, delta: { role: 'assistant' } }));
        writeSse(res, makeChatChunk({ id, model, delta: {}, finishReason: finishReasonFor(toolCalls) }));
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (error) {
        lastError = error;
        accountPool.recordFailure(context, error);
        const canRetry = !directApiKey
          && !attemptEmitted
          && !emitted
          && accountPool.state.config.failoverEnabled !== false
          && isRetryableAccountError(error)
          && attemptIndex < attempts.length - 1;
        if (canRetry) continue;
        writeSse(res, { error: { message: errorMessage(error), type: 'server_error' } });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    writeSse(res, { error: { message: errorMessage(lastError), type: 'server_error' } });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const result = await runCollectWithPool({ ...body, model }, directApiKey, id);
  sendJson(res, 200, makeChatCompletion({
    id,
    model,
    text: result.text,
    toolCalls: result.toolCalls,
    finishReason: finishReasonFor(result.toolCalls),
  }));
}

async function handleAuthCode(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const body = req.method === 'GET' ? {} : await readJson(req);
  const code = body.code || url.searchParams.get('code');
  if (!code) {
    sendError(res, 400, 'code 必填');
    return;
  }

  const result = await exchangeAuthCode(code);
  sendJson(res, 200, result);
}

function adminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>2api Admin</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0f172a; color: #e5e7eb; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 18px; font-size: 24px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    section { background: #111827; border: 1px solid #253045; border-radius: 8px; padding: 16px; margin: 14px 0; }
    label { display: block; font-size: 13px; color: #aeb7c8; margin-bottom: 6px; }
    input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #334155; border-radius: 6px; background: #020617; color: #e5e7eb; padding: 9px 10px; }
    textarea { min-height: 72px; resize: vertical; }
    button { border: 1px solid #3b82f6; border-radius: 6px; background: #2563eb; color: white; padding: 8px 11px; cursor: pointer; }
    button.secondary { background: #1f2937; border-color: #475569; }
    button.danger { background: #991b1b; border-color: #b91c1c; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; }
    .col-2 { grid-column: span 2; }
    .col-3 { grid-column: span 3; }
    .col-4 { grid-column: span 4; }
    .col-6 { grid-column: span 6; }
    .col-8 { grid-column: span 8; }
    .col-12 { grid-column: span 12; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #253045; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #aeb7c8; font-weight: 600; }
    code { color: #c4b5fd; word-break: break-all; }
    .muted { color: #94a3b8; }
    .ok { color: #86efac; }
    .warn { color: #fde68a; }
    .error { color: #fca5a5; }
    .pill { display: inline-block; border: 1px solid #475569; border-radius: 999px; padding: 2px 8px; font-size: 12px; color: #cbd5e1; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } [class^="col-"] { grid-column: span 1; } main { padding: 14px; } }
  </style>
</head>
<body>
  <main>
    <h1>2api Admin</h1>

    <section>
      <div class="grid">
        <div class="col-6">
          <label>Admin Token</label>
          <input id="adminToken" type="password" autocomplete="off" placeholder="如果设置了 ADMIN_TOKEN，请填这里">
        </div>
        <div class="col-6 row" style="align-items:end">
          <button onclick="saveToken()">保存 token</button>
          <button class="secondary" onclick="loadState()">刷新</button>
          <span id="status" class="muted"></span>
        </div>
      </div>
    </section>

    <section>
      <h2>号池配置</h2>
      <div id="poolSummary" class="muted"></div>
      <div class="grid" style="margin-top:12px">
        <div class="col-3">
          <label>目标账号数</label>
          <input id="desiredPoolSize" type="number" min="1" max="100" value="5">
        </div>
        <div class="col-3">
          <label>随机代理</label>
          <div class="row"><input id="randomProxyCheckbox" type="checkbox" style="width:auto"> <span class="muted">启用</span></div>
        </div>
        <div class="col-3">
          <label>账号失败切换</label>
          <div class="row"><input id="failoverCheckbox" type="checkbox" style="width:auto"> <span class="muted">启用</span></div>
        </div>
        <div class="col-3 row" style="align-items:end">
          <button onclick="saveConfig()">保存配置</button>
        </div>
      </div>
    </section>

    <section>
      <h2>添加账号</h2>
      <div class="grid">
        <div class="col-4">
          <label>标签</label>
          <input id="accountLabel" placeholder="main">
        </div>
        <div class="col-8">
          <label>Kombai API key</label>
          <input id="accountKey" type="password" autocomplete="off" placeholder="apiKeyToken">
        </div>
        <div class="col-12 row">
          <button onclick="addAccount()">添加账号</button>
          <button class="secondary" onclick="createConnectUrl()">生成授权链接</button>
          <input id="authCode" placeholder="授权 code" style="max-width:240px">
          <button class="secondary" onclick="pollAuthCode()">轮询并保存</button>
          <a id="connectLink" class="muted" target="_blank" rel="noreferrer"></a>
        </div>
      </div>
    </section>

    <section>
      <h2>自动注册</h2>
      <p class="muted">使用临时邮箱自动注册 Kombai 账号并获取 API key。需要 Playwright 浏览器支持。</p>
      <div class="grid">
        <div class="col-3">
          <label>邮箱前缀</label>
          <input id="autoEmailPrefix" placeholder="kombai" value="kombai">
        </div>
        <div class="col-3">
          <label>Turnstile Token（可选）</label>
          <input id="autoTurnstileToken" placeholder="留空则不使用">
        </div>
        <div class="col-3">
          <label>注册数量</label>
          <input id="autoFillCount" type="number" min="1" max="20" placeholder="默认填充到目标数">
        </div>
        <div class="col-3 row" style="align-items:end">
          <button onclick="autoRegisterOne()">注册一个</button>
          <button class="secondary" onclick="autoFillPool()">填充号池</button>
        </div>
      </div>
      <div id="autoRegStatus" style="margin-top:12px"></div>
    </section>

    <section>
      <h2>账号</h2>
      <div id="accounts"></div>
    </section>

    <section>
      <h2>代理池</h2>
      <div class="grid">
        <div class="col-2"><label>地区</label><input id="proxyRegion" placeholder="US"></div>
        <div class="col-3"><label>标签</label><input id="proxyLabel" placeholder="proxy 1"></div>
        <div class="col-7"><label>代理 URI</label><input id="proxyUri" placeholder="http://user:pass@host:port 或 socks5h://user:pass@host:port"></div>
        <div class="col-12 row"><button onclick="addProxy()">添加代理</button><span class="muted">未带 scheme 时默认按 http 处理。</span></div>
      </div>
      <div id="proxies" style="margin-top:14px"></div>
    </section>
  </main>

  <script>
    const tokenInput = document.getElementById('adminToken');
    tokenInput.value = localStorage.getItem('adminToken') || '';

    function setStatus(text, cls) {
      const el = document.getElementById('status');
      el.textContent = text || '';
      el.className = cls || 'muted';
    }

    function saveToken() {
      localStorage.setItem('adminToken', tokenInput.value);
      loadState();
    }

    async function api(path, options) {
      const headers = { 'Content-Type': 'application/json' };
      const token = tokenInput.value.trim();
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(path, { ...options, headers: { ...headers, ...(options && options.headers || {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error && data.error.message || 'HTTP ' + res.status);
      return data;
    }

    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function renderAccounts(accounts) {
      if (!accounts.length) {
        document.getElementById('accounts').innerHTML = '<p class="warn">暂无账号。</p>';
        return;
      }
      document.getElementById('accounts').innerHTML = '<table><thead><tr><th>状态</th><th>标签</th><th>Key</th><th>来源</th><th>统计</th><th>最后错误</th><th>操作</th></tr></thead><tbody>' +
        accounts.map((a) => '<tr><td>' + (a.enabled ? '<span class="ok">启用</span>' : '<span class="muted">停用</span>') + '<br><span class="pill">' + esc(a.status) + '</span></td><td>' + esc(a.label) + '</td><td><code>' + esc(a.apiKey) + '</code></td><td>' + esc(a.source) + '</td><td>成功 ' + esc(a.successCount) + '<br>失败 ' + esc(a.failCount) + '</td><td class="error">' + esc(a.lastError || '') + '</td><td class="row"><button class="secondary" onclick="verifyAccount(\\'' + esc(a.id) + '\\')">验证</button><button class="secondary" onclick="toggleAccount(\\'' + esc(a.id) + '\\',' + (!a.enabled) + ')">' + (a.enabled ? '停用' : '启用') + '</button><button class="danger" onclick="deleteAccount(\\'' + esc(a.id) + '\\')">删除</button></td></tr>').join('') +
        '</tbody></table>';
    }

    function renderProxies(proxies) {
      if (!proxies.length) {
        document.getElementById('proxies').innerHTML = '<p class="muted">暂无代理。</p>';
        return;
      }
      document.getElementById('proxies').innerHTML = '<table><thead><tr><th>状态</th><th>地区</th><th>标签</th><th>URI</th><th>来源</th><th>统计</th><th>最后错误</th><th>操作</th></tr></thead><tbody>' +
        proxies.map((p) => '<tr><td>' + (p.enabled ? '<span class="ok">启用</span>' : '<span class="muted">停用</span>') + '</td><td>' + esc(p.region) + '</td><td>' + esc(p.label) + '</td><td><code>' + esc(p.uri) + '</code></td><td>' + esc(p.source) + '</td><td>成功 ' + esc(p.successCount) + '<br>失败 ' + esc(p.failCount) + '</td><td class="error">' + esc(p.lastError || '') + '</td><td class="row"><button class="secondary" onclick="toggleProxy(\\'' + esc(p.id) + '\\',' + (!p.enabled) + ')">' + (p.enabled ? '停用' : '启用') + '</button><button class="danger" onclick="deleteProxy(\\'' + esc(p.id) + '\\')">删除</button></td></tr>').join('') +
        '</tbody></table>';
    }

    async function loadState() {
      try {
        const state = await api('/admin/api/state');
        document.getElementById('desiredPoolSize').value = state.config.desiredPoolSize;
        document.getElementById('randomProxyCheckbox').checked = state.config.randomProxy !== false;
        document.getElementById('failoverCheckbox').checked = state.config.failoverEnabled !== false;
        document.getElementById('poolSummary').innerHTML = '目标 <b>' + esc(state.pool.desiredPoolSize) + '</b>，启用 <b>' + esc(state.pool.activeAccounts) + '</b>，缺口 <b class="' + (state.pool.missingAccounts ? 'warn' : 'ok') + '">' + esc(state.pool.missingAccounts) + '</b><br><span class="muted">' + esc(state.pool.note) + '</span>';
        renderAccounts(state.accounts || []);
        renderProxies(state.proxies || []);
        setStatus('已刷新', 'ok');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    }

    async function saveConfig() {
      await api('/admin/api/config', { method: 'POST', body: JSON.stringify({
        desiredPoolSize: Number(document.getElementById('desiredPoolSize').value),
        randomProxy: document.getElementById('randomProxyCheckbox').checked,
        failoverEnabled: document.getElementById('failoverCheckbox').checked,
      }) });
      await loadState();
    }

    async function addAccount() {
      await api('/admin/api/accounts', { method: 'POST', body: JSON.stringify({ label: document.getElementById('accountLabel').value, apiKey: document.getElementById('accountKey').value }) });
      document.getElementById('accountKey').value = '';
      await loadState();
    }

    async function createConnectUrl() {
      const data = await api('/admin/api/auth/connect-url', { method: 'POST', body: JSON.stringify({ type: 'new' }) });
      document.getElementById('authCode').value = data.code;
      const link = document.getElementById('connectLink');
      link.href = data.url;
      link.textContent = '打开授权链接';
    }

    async function pollAuthCode() {
      await api('/admin/api/accounts/poll-auth', { method: 'POST', body: JSON.stringify({ code: document.getElementById('authCode').value, label: document.getElementById('accountLabel').value, timeoutMs: 120000 }) });
      await loadState();
    }

    async function verifyAccount(id) {
      await api('/admin/api/accounts/verify', { method: 'POST', body: JSON.stringify({ id }) });
      await loadState();
    }

    async function toggleAccount(id, enabled) {
      await api('/admin/api/accounts/update', { method: 'POST', body: JSON.stringify({ id, enabled }) });
      await loadState();
    }

    async function deleteAccount(id) {
      await api('/admin/api/accounts/delete', { method: 'POST', body: JSON.stringify({ id }) });
      await loadState();
    }

    async function addProxy() {
      await api('/admin/api/proxies', { method: 'POST', body: JSON.stringify({ region: document.getElementById('proxyRegion').value, label: document.getElementById('proxyLabel').value, uri: document.getElementById('proxyUri').value }) });
      document.getElementById('proxyUri').value = '';
      await loadState();
    }

    async function toggleProxy(id, enabled) {
      await api('/admin/api/proxies/update', { method: 'POST', body: JSON.stringify({ id, enabled }) });
      await loadState();
    }

    async function deleteProxy(id) {
      await api('/admin/api/proxies/delete', { method: 'POST', body: JSON.stringify({ id }) });
      await loadState();
    }

    function setAutoRegStatus(text, cls) {
      const el = document.getElementById('autoRegStatus');
      el.innerHTML = '<span class="' + (cls || 'muted') + '">' + esc(text) + '</span>';
    }

    async function autoRegisterOne() {
      const btn = event.target;
      btn.disabled = true;
      setAutoRegStatus('正在自动注册，请稍候（约1-2分钟）...', 'muted');
      try {
        const data = await api('/admin/api/auto-register', {
          method: 'POST',
          body: JSON.stringify({
            emailPrefix: document.getElementById('autoEmailPrefix').value || 'kombai',
            turnstileToken: document.getElementById('autoTurnstileToken').value || undefined,
          }),
        });
        if (data.success) {
          setAutoRegStatus('注册成功！邮箱: ' + esc(data.email) + '，已自动添加到号池。', 'ok');
        } else {
          setAutoRegStatus('注册失败: ' + esc(data.error || '未知错误'), 'error');
        }
        await loadState();
      } catch (error) {
        setAutoRegStatus('注册失败: ' + esc(error.message), 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function autoFillPool() {
      const btn = event.target;
      const countVal = document.getElementById('autoFillCount').value;
      const count = countVal ? Number(countVal) : undefined;
      btn.disabled = true;
      setAutoRegStatus('正在自动填充号池，请稍候...', 'muted');
      try {
        const data = await api('/admin/api/auto-fill', {
          method: 'POST',
          body: JSON.stringify({
            count,
            emailPrefix: document.getElementById('autoEmailPrefix').value || 'kombai',
            turnstileToken: document.getElementById('autoTurnstileToken').value || undefined,
          }),
        });
        if (data.results) {
          const ok = data.results.filter(function(r) { return r.success; }).length;
          const fail = data.results.filter(function(r) { return !r.success; }).length;
          setAutoRegStatus('填充完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个。', ok > 0 ? 'ok' : 'warn');
        } else {
          setAutoRegStatus('填充完成: ' + esc(JSON.stringify(data)), 'ok');
        }
        await loadState();
      } catch (error) {
        setAutoRegStatus('填充失败: ' + esc(error.message), 'error');
      } finally {
        btn.disabled = false;
      }
    }

    loadState();
  </script>
</body>
</html>`;
}

async function handleAdminApi(req, res, url) {
  if (!requireAdmin(req, res, url)) return;

  if (req.method === 'GET' && url.pathname === '/admin/api/state') {
    sendJson(res, 200, accountPool.getState());
    return;
  }

  const body = req.method === 'GET' ? {} : await readJson(req);

  if (req.method === 'POST' && url.pathname === '/admin/api/config') {
    sendJson(res, 200, accountPool.updateConfig(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/accounts') {
    sendJson(res, 200, accountPool.addAccount(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/accounts/update') {
    sendJson(res, 200, accountPool.updateAccount(body.id, body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/accounts/delete') {
    sendJson(res, 200, accountPool.removeAccount(body.id));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/accounts/verify') {
    const account = accountPool.allAccounts({ includeSecrets: true }).find((item) => item.id === body.id);
    if (!account) {
      sendError(res, 404, '账号不存在');
      return;
    }
    try {
      const result = await verifyApiKey(account.apiKey);
      accountPool.recordSuccess({ accountId: account.id });
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      accountPool.recordFailure({ accountId: account.id }, error);
      throw error;
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/auth/connect-url') {
    sendJson(res, 200, buildAuthConnectUrl({
      code: body.code || undefined,
      type: body.type || 'new',
      redirectUri: body.redirectUri || undefined,
      from: body.from || undefined,
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/accounts/poll-auth') {
    if (!body.code) {
      sendError(res, 400, 'code 必填');
      return;
    }
    const result = await pollAuthCode(body.code, { timeoutMs: body.timeoutMs || 120000 });
    const apiKey = extractApiKeyToken(result);
    if (!apiKey) {
      sendError(res, 502, '授权成功但响应里没有 apiKeyToken');
      return;
    }
    const account = accountPool.addAccount({ apiKey, label: body.label || 'auth account' });
    sendJson(res, 200, { ok: true, account });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/auto-register') {
    try {
      const result = await autoRegisterAccount({
        emailPrefix: body.emailPrefix || 'kombai',
        turnstileToken: body.turnstileToken,
        inviteToken: body.inviteToken,
        authUrl: body.authUrl,
        pollTimeoutMs: body.pollTimeoutMs || 120000,
        onProgress: (progress) => {
          console.log('[auto-register]', JSON.stringify(progress));
        },
      });
      if (result.success && result.apiKey) {
        const account = accountPool.addAccount({
          apiKey: result.apiKey,
          label: `auto: ${result.email}`,
          source: 'auto-register',
        });
        sendJson(res, 200, { ...result, account });
      } else {
        sendJson(res, 200, result);
      }
    } catch (error) {
      console.error('[auto-register] Error:', error.message);
      sendJson(res, 500, { success: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/auto-fill') {
    const state = accountPool.getState();
    const missing = state.pool.missingAccounts;
    const count = Math.min(Number(body.count) || missing, 20);
    if (count <= 0) {
      sendJson(res, 200, { success: true, message: '号池已满，无需填充', results: [] });
      return;
    }
    const results = [];
    for (let i = 0; i < count; i++) {
      try {
        const result = await autoRegisterAccount({
          emailPrefix: body.emailPrefix || 'kombai',
          turnstileToken: body.turnstileToken,
          inviteToken: body.inviteToken,
          authUrl: body.authUrl,
          pollTimeoutMs: body.pollTimeoutMs || 120000,
        });
        if (result.success && result.apiKey) {
          const account = accountPool.addAccount({
            apiKey: result.apiKey,
            label: `auto: ${result.email}`,
            source: 'auto-register',
          });
          results.push({ index: i, success: true, email: result.email, account });
        } else {
          results.push({ index: i, success: false, error: '注册流程未完成' });
        }
      } catch (error) {
        results.push({ index: i, success: false, error: error.message });
      }
    }
    sendJson(res, 200, { success: true, count: results.length, results });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/proxies') {
    sendJson(res, 200, accountPool.addProxy({
      uri: body.uri || body.proxy,
      label: body.label,
      region: body.region,
      enabled: body.enabled,
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/proxies/update') {
    sendJson(res, 200, accountPool.updateProxy(body.id, body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/proxies/delete') {
    sendJson(res, 200, accountPool.removeProxy(body.id));
    return;
  }

  sendError(res, 404, 'Not Found');
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(res, 200, {
      object: 'list',
      data: [
        {
          id: process.env.OPENAI_MODEL_NAME || 'kombai-chat',
          object: 'model',
          created: 0,
          owned_by: 'kombai',
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
    sendHtml(res, 200, adminHtml());
    return;
  }

  if (url.pathname.startsWith('/admin/api/')) {
    await handleAdminApi(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    await handleChatCompletions(req, res);
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/auth/api-key') {
    await handleAuthCode(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/connect-url') {
    sendJson(res, 200, buildAuthConnectUrl({
      code: url.searchParams.get('code') || undefined,
      type: url.searchParams.get('type') || undefined,
      redirectUri: url.searchParams.get('redirect_uri') || undefined,
      from: url.searchParams.get('from') || undefined,
    }));
    return;
  }

  sendError(res, 404, 'Not Found');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const status = error.statusCode || 500;
    sendError(res, status, error.message || String(error), error.type || 'server_error');
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请设置 PORT=<其他端口> 后重试。`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`2api listening on http://127.0.0.1:${PORT}`);
});
