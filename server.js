'use strict';

const http = require('http');
const {
  buildAuthConnectUrl,
  collectChatCompletion,
  exchangeAuthCode,
  streamChatCompletion,
} = require('./src/kombaiClient');
const { makeChatChunk, makeChatCompletion, randomId } = require('./src/openaiCompat');

const PORT = Number(process.env.PORT || 3000);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
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

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
  return process.env.KOMBAI_API_KEY || '';
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function finishReasonFor(toolCalls) {
  return toolCalls.length > 0 ? 'tool_calls' : 'stop';
}

async function handleChatCompletions(req, res) {
  const apiKey = getBearerToken(req);
  if (!apiKey) {
    sendError(res, 401, '缺少 Kombai API key。请设置 KOMBAI_API_KEY，或用 Authorization: Bearer <apiKeyToken> 传入。', 'authentication_error');
    return;
  }

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

    writeSse(res, makeChatChunk({ id, model, delta: { role: 'assistant' } }));
    const toolCalls = [];
    for await (const event of streamChatCompletion({ ...body, model }, apiKey, { requestId: id })) {
      if (event.type === 'text' && event.text) {
        writeSse(res, makeChatChunk({ id, model, delta: { content: event.text } }));
      }
      if (event.type === 'tool_call' && event.toolCall) {
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
    writeSse(res, makeChatChunk({ id, model, delta: {}, finishReason: finishReasonFor(toolCalls) }));
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const result = await collectChatCompletion({ ...body, model }, apiKey, { requestId: id });
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
