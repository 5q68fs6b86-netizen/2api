'use strict';

const WebSocket = require('ws');
const os = require('os');
const { EXTENSION_VERSION, buildKombaiPayload, randomId } = require('./openaiCompat');
const { getClientContext } = require('./footprint');

const WS_URL = process.env.KOMBAI_WS_URL || 'wss://ws.assistant.app.kombai.com';
const API_URL = process.env.KOMBAI_API_URL || 'https://api.assistant.app.kombai.com';
const AUTH_CONNECT_URL = process.env.KOMBAI_AUTH_CONNECT_URL || 'https://agent.kombai.com/vscode-connect';
const SESSION_CHARS = 'abcdefghijklmnopqrstuvqxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomSessionId(length = 16) {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return output;
}

function buildAuthConnectUrl(options = {}) {
  const code = options.code || randomSessionId(16);
  const url = new URL(AUTH_CONNECT_URL);
  url.searchParams.set('redirectUri', options.redirectUri || 'kombai.kombai://auth-callback');
  url.searchParams.set('code', Buffer.from(code, 'utf8').toString('base64'));
  url.searchParams.set('from', options.from || 'vscode');
  url.searchParams.set('type', options.type || 'new');
  return { code, url: url.toString() };
}

function socketHeaders(apiKey) {
  return {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'x-type': 'agent',
    'x-editor': process.env.KOMBAI_EDITOR || 'vscode',
    'x-extension-version': EXTENSION_VERSION,
  };
}

function restHeaders(options = {}) {
  return {
    ...socketHeaders(options.apiKey),
    'x-editor-version': process.env.KOMBAI_EDITOR_VERSION || 'unknown',
    'x-os-platform': process.platform,
    'x-os-architecture': process.arch,
    'x-os-release': os.release(),
    ...(options.sessionId ? { 'x-session-id': options.sessionId } : {}),
    ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
    'x-client-context': getClientContext(),
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

function stringifyToolArguments(input) {
  if (input === undefined || input === null) return '{}';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch (_) {
    return JSON.stringify({ value: String(input) });
  }
}

function normalizeToolCall(toolUse) {
  if (!toolUse || typeof toolUse !== 'object') return null;
  const name = toolUse.name || toolUse.toolName || (toolUse.function && toolUse.function.name);
  if (!name) return null;
  const input = toolUse.input !== undefined
    ? toolUse.input
    : toolUse.arguments !== undefined
      ? toolUse.arguments
      : toolUse.args;

  return {
    id: String(toolUse.id || toolUse.toolUseId || toolUse.callId || randomId('call')),
    type: 'function',
    function: {
      name: String(name),
      arguments: stringifyToolArguments(input),
    },
  };
}

function collectToolUses(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectToolUses(item, output);
    return output;
  }
  if (typeof value !== 'object') return output;

  const toolCall = normalizeToolCall(value);
  if (toolCall) {
    output.push(toolCall);
    return output;
  }

  for (const key of ['toolUse', 'toolUses', 'tools']) {
    if (value[key]) collectToolUses(value[key], output);
  }
  return output;
}

function toolCallsFromFrame(frame) {
  if (!frame || typeof frame !== 'object') return [];

  const candidates = [];
  if (frame.action === 'toolUse') {
    candidates.push(frame.response, frame.toolUse, frame.toolUses);
  }
  candidates.push(
    frame.response && frame.response.toolUse,
    frame.response && frame.response.toolUses,
    frame.toolUse,
    frame.toolUses,
  );

  const calls = [];
  for (const candidate of candidates) collectToolUses(candidate, calls);

  const seen = new Set();
  return calls.filter((call) => {
    if (seen.has(call.id)) return false;
    seen.add(call.id);
    return true;
  });
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

    const toolCalls = toolCallsFromFrame(frame);
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) push({ type: 'tool_call', toolCall, raw: frame });
      return;
    }

    if (frame.action === 'streamMessage' && frame.response && typeof frame.response.text === 'string') {
      push({ type: 'text', text: frame.response.text, raw: frame });
      return;
    }

    if (frame.action === 'toolResult') {
      push({ type: 'tool_result', result: frame.result || frame.response, raw: frame });
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

async function collectChatCompletion(openaiBody, apiKey, options = {}) {
  let text = '';
  const toolCalls = [];
  const toolResults = [];

  for await (const event of streamChatCompletion(openaiBody, apiKey, options)) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'tool_call') toolCalls.push(event.toolCall);
    if (event.type === 'tool_result') toolResults.push(event.result);
  }

  return { text, toolCalls, toolResults };
}

async function exchangeAuthCode(code) {
  const sessionId = randomSessionId();
  const url = new URL('/auth/api-key', API_URL);
  url.searchParams.set('code', code);
  url.searchParams.set('appMode', 'Assistant');

  const response = await fetch(url, {
    method: 'GET',
    headers: restHeaders({ sessionId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.errorCode || data.error || data.message || `Kombai auth exchange failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function pollAuthCode(code, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.KOMBAI_AUTH_TIMEOUT_MS || 15 * 60 * 1000);
  const intervalMs = Number(options.intervalMs || process.env.KOMBAI_AUTH_INTERVAL_MS || 2000);
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await exchangeAuthCode(code);
    } catch (error) {
      lastError = error;
      if (![401, 403, 404].includes(error.statusCode)) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const error = new Error(`等待授权超时: ${timeoutMs}ms`);
  error.cause = lastError;
  throw error;
}

async function verifyApiKey(apiKey) {
  const sessionId = randomSessionId();
  const url = new URL('/auth/api-key', API_URL);
  url.searchParams.set('apiKey', apiKey);

  const response = await fetch(url, {
    method: 'PUT',
    body: '',
    headers: restHeaders({ apiKey, sessionId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.errorCode || data.error || data.message || `Kombai API key verification failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

module.exports = {
  buildAuthConnectUrl,
  collectChatCompletion,
  completeChat,
  exchangeAuthCode,
  pollAuthCode,
  randomSessionId,
  restHeaders,
  streamChatCompletion,
  verifyApiKey,
};
