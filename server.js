'use strict';

const http = require('http');
const { getSignupConfig, login, registerAccount } = require('./src/kombaiAuth');

const PORT = Number(process.env.PORT || 3000);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/config') {
    const config = await getSignupConfig();
    sendJson(res, 200, { pageConfig: config.pageConfig });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/register') {
    const body = await readJson(req);
    const result = await registerAccount({
      email: body.email,
      emailName: body.emailName,
      emailPrefix: body.emailPrefix,
      password: body.password,
      turnstileToken: body.turnstileToken,
      inviteToken: body.inviteToken,
      waitForVerification: body.waitForVerification === true,
      login: body.login !== false,
      tempMail: body.tempMail,
    });
    sendJson(res, result.success ? 200 : 400, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const body = await readJson(req);
    if (!body.email || !body.password) {
      sendJson(res, 400, { success: false, error: 'email 和 password 必填' });
      return;
    }
    const result = await login(body.email, body.password);
    sendJson(res, result.success ? 200 : 401, {
      success: result.success,
      status: result.status,
      userId: result.userId,
      error: result.error,
      cookies: result.jar.toJSON(),
    });
    return;
  }

  sendJson(res, 404, { success: false, error: 'Not Found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    sendJson(res, 500, { success: false, error: error.message });
  });
});

server.listen(PORT, () => {
  console.log(`2api listening on http://127.0.0.1:${PORT}`);
});
