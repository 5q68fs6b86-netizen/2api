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
