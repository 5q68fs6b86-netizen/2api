'use strict';

const WebSocket = require('ws');
const { EXTENSION_VERSION, buildKombaiPayload, randomId } = require('./openaiCompat');
const { getClientContext } = require('./footprint');

const WS_URL = process.env.KOMBAI_WS_URL || 'wss://ws.assistant.app.kombai.com';
const API_URL = process.env.KOMBAI_API_URL || 'https://api.assistant.app.kombai.com';
const SESSION_CHARS = 'abcdefghijklmnopqrstuvqxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomSessionId(length = 16) {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return output;
}

function socketHeaders(apiKey) {
  return {
    'x-api-key': apiKey,
    'x-type': 'agent',
    'x-editor': process.env.KOMBAI_EDITOR || 'vscode',
    'x-extension-version': EXTENSION_VERSION,
  };
}

function buildSocketMessage({ requestId, sessionId, payload }) {
  const socketPayload = { ...payload };
  const message = {
    action: process.env.KOMBAI_ACTION || 'chatv2',
    requestId,
    sessionId,
    threadId: socketPayload.threadId,
    workspacePath: socketPayload.workspacePath,
    homedir: socketPayload.homedir,
    messageType: socketPayload.messageType,
    subAction: socketPayload.subAction,
    clientContext: getClientContext(),
    payload: socketPayload,
  };

  delete message.payload.threadId;
  delete message.payload.subAction;
  return message;
}

function normalizeSocketFrame(data) {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

async function* streamChatCompletion(openaiBody, apiKey, options = {}) {
  const requestId = options.requestId || randomId('chatcmpl');
  const sessionId = options.sessionId || randomSessionId();
  const timeoutMs = Number(process.env.KOMBAI_TIMEOUT_MS || options.timeoutMs || 180000);
  const payload = buildKombaiPayload(openaiBody, requestId);
  const message = buildSocketMessage({ requestId, sessionId, payload });

  const queue = [];
  let notify = null;
  let done = false;
  let failure = null;

  const ws = new WebSocket(`${WS_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: socketHeaders(apiKey),
  });

  const timeout = setTimeout(() => {
    failure = new Error(`Kombai socket timed out after ${timeoutMs}ms`);
    try {
      ws.close();
    } catch (_) {
      // best effort
    }
    if (notify) notify();
  }, timeoutMs);

  function push(event) {
    queue.push(event);
    if (notify) {
      notify();
      notify = null;
    }
  }

  function finish() {
    done = true;
    clearTimeout(timeout);
    if (notify) {
      notify();
      notify = null;
    }
  }

  ws.on('open', () => {
    ws.send(JSON.stringify(message));
  });

  ws.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(normalizeSocketFrame(data));
    } catch (error) {
      push({ type: 'debug', raw: normalizeSocketFrame(data), error: error.message });
      return;
    }

    if (frame.requestId && frame.requestId !== requestId) return;

    if (frame.action === 'streamMessage' && frame.response && typeof frame.response.text === 'string') {
      push({ type: 'text', text: frame.response.text, raw: frame });
      return;
    }

    if (frame.action === 'error') {
      const msg = frame.message || frame.response || frame.error || 'Kombai socket returned an error';
      failure = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      finish();
      return;
    }

    if (frame.action === 'streamEnd' || frame.pending === false) {
      finish();
      return;
    }

    push({ type: 'event', raw: frame });
  });

  ws.on('error', (error) => {
    failure = error;
    finish();
  });

  ws.on('close', () => {
    finish();
  });

  try {
    while (!done || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise((resolve) => {
          notify = resolve;
        });
        continue;
      }

      yield queue.shift();
    }

    if (failure) throw failure;
  } finally {
    clearTimeout(timeout);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}

async function completeChat(openaiBody, apiKey, options = {}) {
  let text = '';
  for await (const event of streamChatCompletion(openaiBody, apiKey, options)) {
    if (event.type === 'text') text += event.text;
  }
  return text;
}

async function exchangeAuthCode(code) {
  const sessionId = randomSessionId();
  const url = new URL('/auth/api-key', API_URL);
  url.searchParams.set('code', code);
  url.searchParams.set('appMode', 'Assistant');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...socketHeaders(''),
      'x-session-id': sessionId,
      'x-client-context': getClientContext(),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errorCode || data.error || `Kombai auth exchange failed: HTTP ${response.status}`);
  }
  return data;
}

module.exports = {
  completeChat,
  exchangeAuthCode,
  randomSessionId,
  streamChatCompletion,
};
