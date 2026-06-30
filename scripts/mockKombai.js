#!/usr/bin/env node
'use strict';

const http = require('http');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const API_PORT = Number(process.env.MOCK_KOMBAI_API_PORT || 3311);
const WS_PORT = Number(process.env.MOCK_KOMBAI_WS_PORT || 3312);
const HOST = process.env.MOCK_KOMBAI_HOST || '127.0.0.1';
const DEBUG = String(process.env.MOCK_KOMBAI_DEBUG || '').trim() === '1';

let nextToolId = 1;
const threads = new Map();
const socketsBySessionId = new Map();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function debug(message, data = {}) {
  if (!DEBUG) return;
  console.log(`[mock-kombai-debug] ${message} ${JSON.stringify(data)}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function streamText(ws, requestId, text) {
  debug('streamText', { requestId, text });
  ws.send(JSON.stringify({
    action: 'streamMessage',
    requestId,
    response: { text },
  }));
  ws.send(JSON.stringify({
    action: 'streamEnd',
    requestId,
    pending: false,
  }));
}

function streamToolUse(ws, requestId, toolUse) {
  debug('streamToolUse', { requestId, toolUseId: toolUse && toolUse.id, name: toolUse && toolUse.name });
  ws.send(JSON.stringify({
    action: 'toolUse',
    requestId,
    response: toolUse,
  }));
  ws.send(JSON.stringify({
    action: 'streamEnd',
    requestId,
    pending: false,
  }));
}

function streamError(ws, requestId, statusCode, message) {
  debug('streamError', { requestId, statusCode, message });
  ws.send(JSON.stringify({
    action: 'error',
    requestId,
    statusCode,
    message,
  }));
}

function parseIncomingFrame(frame) {
  const payload = frame.payload && typeof frame.payload === 'object' ? frame.payload : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    requestId: frame.requestId,
    sessionId: String(frame.sessionId || ''),
    threadId: String(frame.threadId || payload.threadId || data.threadId || ''),
    prompt: String(data.prompt || payload.prompt || ''),
    toolResults: Array.isArray(data.toolResults)
      ? data.toolResults
      : Array.isArray(payload.toolResults)
        ? payload.toolResults
        : [],
  };
}

function handleFrame(ws, frame) {
  const {
    requestId,
    sessionId,
    threadId,
    prompt,
    toolResults,
  } = parseIncomingFrame(frame);

  debug('handleFrame', {
    action: frame && frame.action,
    requestId,
    sessionId,
    threadId,
    promptStart: prompt.slice(0, 160),
    promptLength: prompt.length,
    toolResults: toolResults.length,
  });

  if (!threadId) {
    streamError(ws, requestId, 400, 'missing threadId');
    return;
  }

  if (toolResults.length > 0) {
    const existing = threads.get(threadId);
    if (!existing) {
      streamError(ws, requestId, 409, 'unknown thread');
      return;
    }

    const toolResult = toolResults[0];
    const content = String(
      toolResult
      && toolResult.result
      && toolResult.result.results
      && toolResult.result.results.content
      || '',
    );
    streamText(ws, requestId, `Tool completed: ${content || 'empty'}`);
    return;
  }

  if (/ping/i.test(prompt)) {
    streamText(ws, requestId, 'pong');
    return;
  }

  if (/tool|bash/i.test(prompt)) {
    const toolUseId = `tool_${nextToolId += 1}`;
    threads.set(threadId, { toolUseId });
    streamToolUse(ws, requestId, {
      id: toolUseId,
      name: 'Bash',
      input: {
        command: 'printf tool-ok',
        description: 'Print a marker for integration testing',
      },
    });
    return;
  }

  streamText(ws, requestId, 'ok');
}

const apiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${API_PORT}`}`);

  if (req.method === 'PUT' && url.pathname === '/auth/api-key') {
    sendJson(res, 200, { ok: true, apiKey: url.searchParams.get('apiKey') || '' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/subscription/status-v2') {
    sendJson(res, 200, {
      assistantSubscriptionPlan: 'Mock',
      assistantSubscriptionTotalCredits: 500,
      assistantSubscriptionRemainingCredits: 500,
      assistantSubscriptionFootprintBlocked: false,
      assistantSubscriptionBlockReason: '',
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/action') {
    const raw = await readBody(req);
    const isGzip = String(req.headers['content-type'] || '').includes('application/gzip');
    const decoded = isGzip ? zlib.gunzipSync(raw) : raw;
    const frame = JSON.parse(decoded.toString('utf8'));
    const sessionId = String(frame.sessionId || '');
    debug('restAction', { sessionId, requestId: frame.requestId, action: frame.action, bytes: decoded.length });
    const ws = socketsBySessionId.get(sessionId);
    if (!ws) {
      sendJson(res, 409, { error: 'mock socket not connected', sessionId });
      return;
    }
    handleFrame(ws, frame);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

const wsServer = new WebSocketServer({ host: HOST, port: WS_PORT });

wsServer.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/', `ws://${req.headers.host || `${HOST}:${WS_PORT}`}`);
  const sessionId = String(requestUrl.searchParams.get('sessionId') || '');
  debug('wsOpen', { sessionId });
  if (sessionId) socketsBySessionId.set(sessionId, ws);

  ws.on('close', () => {
    debug('wsClose', { sessionId });
    if (sessionId && socketsBySessionId.get(sessionId) === ws) {
      socketsBySessionId.delete(sessionId);
    }
  });

  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      return;
    }
    debug('wsMessage', { sessionId, requestId: frame.requestId, action: frame.action });
    handleFrame(ws, frame);
  });
});

apiServer.listen(API_PORT, HOST, () => {
  console.log(`[mock-kombai] api listening on http://${HOST}:${API_PORT}`);
});

wsServer.on('listening', () => {
  console.log(`[mock-kombai] ws listening on ws://${HOST}:${WS_PORT}`);
});
