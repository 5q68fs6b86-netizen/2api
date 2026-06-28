'use strict';

const WebSocket = require('ws');
const os = require('os');
const { EXTENSION_VERSION, buildKombaiPayload, randomId } = require('./openaiCompat');
const { getClientContext } = require('./footprint');
const { createProxyAgent } = require('./proxyAgent');
const { request } = require('./httpClient');

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
    'x-client-context': getClientContext(options.footprint || {}),
  };
}

function buildSocketMessage({ action, requestId, sessionId, payload, footprint }) {
  const socketPayload = { ...payload };
  const message = {
    action,
    requestId,
    sessionId,
    ...(socketPayload.threadId ? { threadId: socketPayload.threadId } : {}),
    ...(socketPayload.workspacePath ? { workspacePath: socketPayload.workspacePath } : {}),
    ...(socketPayload.homedir ? { homedir: socketPayload.homedir } : {}),
    ...(socketPayload.messageType ? { messageType: socketPayload.messageType } : {}),
    ...(socketPayload.subAction ? { subAction: socketPayload.subAction } : {}),
    ...(socketPayload.stream ? { stream: 'stream' } : {}),
    ...(socketPayload.api ? { api: socketPayload.api } : {}),
    clientContext: getClientContext(footprint || {}),
    payload: socketPayload,
  };

  if (socketPayload.threadId) delete message.payload.threadId;
  if (socketPayload.subAction) delete message.payload.subAction;
  delete message.payload.stream;
  delete message.payload.api;
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
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return input;
    return JSON.stringify({ value: input });
  }
  try {
    return JSON.stringify(input);
  } catch (_) {
    return JSON.stringify({ value: String(input) });
  }
}

function cleanStreamText(text, state = {}) {
  let cleaned = String(text || '')
    .replace(/<loader\b[^>]*><\/loader>\s*/gi, '')
    .replace(/<loaderUpdate\b[^>]*><\/loaderUpdate>\s*/gi, '')
    .replace(/<loaderUpdate\b[^>]*>\s*/gi, '');

  let output = '';
  while (cleaned) {
    if (state.suppressInternalMarkup) {
      const closeMatch = cleaned.match(/<\/tool-group>/i);
      if (!closeMatch) return output.trim() ? output : '';
      cleaned = cleaned.slice(closeMatch.index + closeMatch[0].length);
      state.suppressInternalMarkup = false;
      continue;
    }

    const openMatch = cleaned.match(/<tool-group\b[^>]*>/i);
    if (!openMatch) {
      output += cleaned;
      break;
    }

    output += cleaned.slice(0, openMatch.index);
    cleaned = cleaned.slice(openMatch.index + openMatch[0].length);
    const closeMatch = cleaned.match(/<\/tool-group>/i);
    if (!closeMatch) {
      state.suppressInternalMarkup = true;
      break;
    }
    cleaned = cleaned.slice(closeMatch.index + closeMatch[0].length);
  }

  output = output
    .replace(/<kombai-element-update\b[^>]*><\/kombai-element-update>\s*/gi, '')
    .replace(/<\/?kombai-collapsible\b[^>]*>\s*/gi, '')
    .replace(/<\/?(?:error|thinking|thought|analysis|final)\b[^>]*>\s*/gi, '');
  return output.trim() ? output : '';
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
    candidates.push(frame.response, frame.toolUse, frame.toolUses, frame.tools);
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

function proxyUrlFromOptions(options = {}) {
  if (options.proxyUrl) return options.proxyUrl;
  if (options.proxy && options.proxy.uri) return options.proxy.uri;
  return '';
}

async function* streamChatCompletion(openaiBody, apiKey, options = {}) {
  const requestId = options.requestId || randomId('chatcmpl');
  const sessionId = options.sessionId || randomSessionId();
  const timeoutMs = Number(process.env.KOMBAI_TIMEOUT_MS || options.timeoutMs || 180000);
  const action = process.env.KOMBAI_ACTION || options.action || 'mcpv1';
  const payload = buildKombaiPayload(openaiBody, requestId, { action });
  const message = buildSocketMessage({
    action,
    requestId,
    sessionId,
    payload,
    footprint: options.footprint,
  });
  const wsUrl = `${WS_URL}?sessionId=${encodeURIComponent(sessionId)}`;
  const proxyUrl = proxyUrlFromOptions(options);
  const wsOptions = {
    headers: socketHeaders(apiKey),
  };
  if (proxyUrl) wsOptions.agent = createProxyAgent(proxyUrl, WS_URL);

  const queue = [];
  let notify = null;
  let done = false;
  let failure = null;
  const streamCleanState = {};

  const ws = new WebSocket(wsUrl, wsOptions);

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
      const text = cleanStreamText(frame.response.text, streamCleanState);
      if (text) push({ type: 'text', text, raw: frame });
      return;
    }

    if (frame.action === 'agentResult' && frame.result && Array.isArray(frame.result.content)) {
      for (const part of frame.result.content) {
        if (part && part.type === 'text' && typeof part.text === 'string') {
          const text = cleanStreamText(part.text, streamCleanState);
          if (text) push({ type: 'text', text, raw: frame });
        }
      }
      finish();
      return;
    }

    if (frame.action === 'toolResult') {
      push({ type: 'tool_result', result: frame.result || frame.response, raw: frame });
      return;
    }

    if (frame.action === 'error') {
      const msg = frame.message || frame.response || frame.error || 'Kombai socket returned an error';
      failure = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      failure.statusCode = frame.statusCode || frame.status || frame.code;
      failure.data = frame;
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

async function requestKombaiJson(url, options = {}) {
  const proxyUrl = proxyUrlFromOptions(options);
  if (!proxyUrl) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      body: options.body,
      headers: options.headers || {},
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.errorCode || data.error || data.message || `Kombai API request failed: HTTP ${response.status}`);
      error.statusCode = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  const response = await request(url.toString(), {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    proxy: proxyUrl,
    timeout: options.timeout || 30000,
  });
  const data = response.data && typeof response.data === 'object' ? response.data : {};
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(data.errorCode || data.error || data.message || `Kombai API request failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.data = data || response.text;
    throw error;
  }
  return data;
}

async function exchangeAuthCode(code, options = {}) {
  const sessionId = randomSessionId();
  const url = new URL('/auth/api-key', API_URL);
  url.searchParams.set('code', code);
  url.searchParams.set('appMode', 'Assistant');

  return requestKombaiJson(url, {
    headers: restHeaders({ sessionId, footprint: options.footprint }),
    proxy: proxyUrlFromOptions(options),
    timeout: options.timeout,
  });
}

async function pollAuthCode(code, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.KOMBAI_AUTH_TIMEOUT_MS || 15 * 60 * 1000);
  const intervalMs = Number(options.intervalMs || process.env.KOMBAI_AUTH_INTERVAL_MS || 2000);
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await exchangeAuthCode(code, options);
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

async function verifyApiKey(apiKey, options = {}) {
  const sessionId = randomSessionId();
  const url = new URL('/auth/api-key', API_URL);
  url.searchParams.set('apiKey', apiKey);

  return requestKombaiJson(url, {
    method: 'PUT',
    body: '',
    headers: restHeaders({ apiKey, sessionId, footprint: options.footprint }),
    proxy: proxyUrlFromOptions(options),
    timeout: options.timeout,
  });
}

async function getSubscriptionStatus(apiKey, options = {}) {
  const sessionId = randomSessionId();
  const url = new URL('/subscription/status-v2', API_URL);
  url.searchParams.set('appMode', 'Assistant');

  return requestKombaiJson(url, {
    headers: restHeaders({ apiKey, sessionId, footprint: options.footprint }),
    proxy: proxyUrlFromOptions(options),
    timeout: options.timeout,
  });
}

function numericField(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assertSubscriptionUsable(status) {
  const remainingCredits = numericField(status && status.assistantSubscriptionRemainingCredits);
  const totalCredits = numericField(status && status.assistantSubscriptionTotalCredits);
  const blocked = Boolean(status && status.assistantSubscriptionFootprintBlocked);
  const blockReason = status && status.assistantSubscriptionBlockReason
    ? String(status.assistantSubscriptionBlockReason)
    : '';

  if (!blocked && (remainingCredits === null || remainingCredits > 0)) return;

  const details = [];
  if (blocked) details.push(`footprintBlocked=true${blockReason ? ` (${blockReason})` : ''}`);
  if (remainingCredits !== null && remainingCredits <= 0) details.push(`remainingCredits=${remainingCredits}`);
  if (totalCredits !== null) details.push(`totalCredits=${totalCredits}`);

  const error = new Error(`Kombai 账号不可用: ${details.join(', ') || '订阅不可用'}`);
  error.statusCode = blocked ? 403 : 402;
  error.type = 'subscription_error';
  error.data = status;
  throw error;
}

async function verifyUsableApiKey(apiKey, options = {}) {
  const verification = await verifyApiKey(apiKey, options);
  const subscription = await getSubscriptionStatus(apiKey, options);
  assertSubscriptionUsable(subscription);
  return { verification, subscription };
}

module.exports = {
  assertSubscriptionUsable,
  buildAuthConnectUrl,
  collectChatCompletion,
  completeChat,
  exchangeAuthCode,
  getSubscriptionStatus,
  pollAuthCode,
  randomSessionId,
  restHeaders,
  streamChatCompletion,
  verifyApiKey,
  verifyUsableApiKey,
};
