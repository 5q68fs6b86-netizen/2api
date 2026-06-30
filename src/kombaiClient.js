'use strict';

const WebSocket = require('ws');
const os = require('os');
const zlib = require('zlib');
const { EXTENSION_VERSION, buildKombaiPayload, randomId } = require('./openaiCompat');
const { getClientContext } = require('./footprint');
const { createProxyAgent } = require('./proxyAgent');
const { request } = require('./httpClient');

const WS_URL = process.env.KOMBAI_WS_URL || 'wss://ws.assistant.app.kombai.com';
const API_URL = process.env.KOMBAI_API_URL || 'https://api.assistant.app.kombai.com';
const AUTH_CONNECT_URL = process.env.KOMBAI_AUTH_CONNECT_URL || 'https://agent.kombai.com/vscode-connect';
const SESSION_CHARS = 'abcdefghijklmnopqrstuvqxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SOCKET_PAYLOAD_LIMIT = 28_000;
const REST_ACTIONS = new Set(['chatv2', 'agentv2', 'agentv3', 'interrupt', 'reply', 'enhancePrompt', 'toolv1', 'mcpv1']);

function debugWs(message, data = {}) {
  if (String(process.env.KOMBAI_DEBUG_WS || '').trim() !== '1') return;
  console.error(`[kombai-ws] ${message} ${JSON.stringify(data)}`);
}

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
  const sourcePayload = payload && typeof payload === 'object' ? payload : {};
  const topLevelThreadId = sourcePayload.threadId;
  const topLevelWorkspacePath = sourcePayload.workspacePath;
  const topLevelHomedir = sourcePayload.homedir;
  const topLevelMessageType = sourcePayload.messageType;
  const topLevelSubAction = sourcePayload.subAction;
  const socketPayload = action === 'mcpv1' || action === 'chatv2'
    ? {
        messageType: action === 'chatv2' ? 'command/codegen' : payload.messageType || 'codegen',
        messageId: requestId,
        data: payload,
      }
    : { ...payload };
  const message = {
    action,
    requestId,
    sessionId,
    ...(socketPayload.threadId || topLevelThreadId ? { threadId: socketPayload.threadId || topLevelThreadId } : {}),
    ...(socketPayload.workspacePath || topLevelWorkspacePath ? { workspacePath: socketPayload.workspacePath || topLevelWorkspacePath } : {}),
    ...(socketPayload.homedir || topLevelHomedir ? { homedir: socketPayload.homedir || topLevelHomedir } : {}),
    ...(socketPayload.messageType || topLevelMessageType ? { messageType: socketPayload.messageType || topLevelMessageType } : {}),
    ...(socketPayload.subAction || topLevelSubAction ? { subAction: socketPayload.subAction || topLevelSubAction } : {}),
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

function socketMessageStats(message) {
  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(message.payload || {}));
  } catch (_) {
    payloadBytes = 0;
  }

  const text = JSON.stringify(message);
  return {
    messageBytes: Buffer.byteLength(text),
    payloadBytes,
    payloadKeys: message.payload && typeof message.payload === 'object' ? Object.keys(message.payload).slice(0, 20) : [],
    hasMcpEnvelope: Boolean(message.payload && message.payload.data),
  };
}

async function postRestAction(message, apiKey, options = {}) {
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(message), 'utf8'));
  const url = new URL('/action', API_URL);
  const headers = restHeaders({
    apiKey,
    sessionId: message.sessionId,
    footprint: options.footprint,
    contentType: 'application/gzip',
  });
  const proxyUrl = proxyUrlFromOptions(options);

  if (!proxyUrl) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      const data = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
      const error = new Error(data.errorCode || data.error || data.message || `Kombai REST action failed: HTTP ${response.status}`);
      error.statusCode = response.status;
      error.data = data;
      throw error;
    }
    return;
  }

  const response = await request(url.toString(), {
    method: 'POST',
    headers,
    body,
    proxy: proxyUrl,
    timeout: options.timeout || 30000,
  });
  if (response.status < 200 || response.status >= 300) {
    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const error = new Error(data.errorCode || data.error || data.message || `Kombai REST action failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.data = data || response.text;
    throw error;
  }
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseToolArguments(toolCall) {
  if (!toolCall || !toolCall.function) return {};
  const raw = toolCall.function.arguments;
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { value: raw };
  }
}

function makeMappedToolCall(original, name, input) {
  return {
    ...original,
    function: {
      name,
      arguments: stringifyToolArguments(input),
    },
  };
}

function bashToolAvailable(allowedToolNames) {
  return !allowedToolNames || allowedToolNames.size === 0 || allowedToolNames.has('Bash');
}

function mapInternalToolCall(toolCall, allowedToolNames) {
  const name = toolCall && toolCall.function && toolCall.function.name;
  if (!name) return null;
  if (name === 'auto_continue') return null;

  const input = parseToolArguments(toolCall);
  if (name === 'ripgrep') {
    if (!bashToolAvailable(allowedToolNames)) return null;
    const args = Array.isArray(input.commandArgs) ? input.commandArgs : [];
    if (args.length === 0) return null;
    const root = input.rootDirectory || '.';
    return makeMappedToolCall(toolCall, 'Bash', {
      command: `cd ${shellQuote(root)} && rg ${args.map(shellQuote).join(' ')}`,
      description: input.description || 'Run ripgrep',
    });
  }

  if (name === 'list_directory') {
    if (!bashToolAvailable(allowedToolNames)) return null;
    const dir = input.directoryPath || input.path || '.';
    const depth = Math.max(1, Math.min(Number(input.depth) || 1, 10));
    const maxLines = Math.max(1, Math.min(Number(input.maxLineCount) || 200, 1000));
    return makeMappedToolCall(toolCall, 'Bash', {
      command: `find ${shellQuote(dir)} -maxdepth ${depth} -print | sed -n '1,${maxLines}p'`,
      description: `List ${dir}`,
    });
  }

  if (!allowedToolNames || allowedToolNames.size === 0 || allowedToolNames.has(name)) return toolCall;
  return null;
}

function decodeXmlAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseXmlAttributes(tag) {
  const attrs = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(String(tag || ''))) !== null) {
    attrs[match[1]] = decodeXmlAttribute(match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4]);
  }
  return attrs;
}

function parseMaybeJson(text) {
  const value = String(text || '').trim();
  if (!value) return {};

  try {
    return JSON.parse(value);
  } catch (_) {
    // Try base64-encoded JSON next.
  }

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim();
    if (decoded) return JSON.parse(decoded);
  } catch (_) {
    // Fall through to a plain string wrapper.
  }

  return { value };
}

function allowedToolNamesFromBody(openaiBody = {}) {
  const names = new Set();
  for (const tool of Array.isArray(openaiBody.tools) ? openaiBody.tools : []) {
    if (!tool || typeof tool !== 'object') continue;
    const name = tool.name || (tool.function && tool.function.name);
    if (name) names.add(String(name));
  }
  return names;
}

function filterAllowedToolCalls(toolCalls, allowedToolNames) {
  const mapped = [];
  for (const toolCall of toolCalls) {
    const mappedCall = mapInternalToolCall(toolCall, allowedToolNames);
    if (mappedCall) mapped.push(mappedCall);
  }
  return mapped;
}

function toolCallsFromText(text, state = {}, allowedToolNames = new Set()) {
  if (!text && !state.pendingToolUseText) return [];
  let source = `${state.pendingToolUseText || ''}${String(text || '')}`;
  state.pendingToolUseText = '';

  const lower = source.toLowerCase();
  const lastOpen = lower.lastIndexOf('<tool-use');
  const lastClose = lower.lastIndexOf('</tool-use>');
  if (lastOpen !== -1 && lastOpen > lastClose) {
    state.pendingToolUseText = source.slice(lastOpen);
    source = source.slice(0, lastOpen);
  }

  const calls = [];
  const pattern = /<tool-use\b([^>]*)>([\s\S]*?)<\/tool-use>/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const attrs = parseXmlAttributes(match[1]);
    const name = attrs.name || attrs.toolName;
    if (!name) continue;
    const input = attrs.input !== undefined ? parseMaybeJson(attrs.input) : parseMaybeJson(match[2]);
    const toolCall = normalizeToolCall({
      id: attrs.id,
      name,
      input,
    });
    if (toolCall) calls.push(toolCall);
  }

  return calls;
}

function cleanStreamText(text, state = {}) {
  let cleaned = String(text || '')
    .replace(/<loader\b[^>]*><\/loader>\s*/gi, '')
    .replace(/<loaderUpdate\b[^>]*><\/loaderUpdate>\s*/gi, '')
    .replace(/<loaderUpdate\b[^>]*>\s*/gi, '')
    .replace(/<tool-use\b[\s\S]*?(?:<\/tool-use>|$)\s*/gi, '')
    .replace(/<tool-result\b[\s\S]*?(?:<\/tool-result>|$)\s*/gi, '');

  let output = '';
  while (cleaned) {
    if (state.suppressInternalMarkup || state.suppressInternalToolUse) {
      const closeMatch = cleaned.match(state.suppressInternalToolUse ? /<\/tool-use>/i : /<\/tool-group>/i);
      if (!closeMatch) return output.trim() ? output : '';
      cleaned = cleaned.slice(closeMatch.index + closeMatch[0].length);
      state.suppressInternalMarkup = false;
      state.suppressInternalToolUse = false;
      continue;
    }

    const openMatch = cleaned.match(/<tool-(?:group|use)\b[^>]*>/i);
    if (!openMatch) {
      output += cleaned;
      break;
    }

    output += cleaned.slice(0, openMatch.index);
    cleaned = cleaned.slice(openMatch.index + openMatch[0].length);
    const isToolUse = /^<tool-use\b/i.test(openMatch[0]);
    const closeMatch = cleaned.match(isToolUse ? /<\/tool-use>/i : /<\/tool-group>/i);
    if (!closeMatch) {
      if (isToolUse) state.suppressInternalToolUse = true;
      else state.suppressInternalMarkup = true;
      break;
    }
    cleaned = cleaned.slice(closeMatch.index + closeMatch[0].length);
  }

  output = output
    .replace(/<kombai-element-update\b[^>]*><\/kombai-element-update>\s*/gi, '')
    .replace(/<tool-use\b[\s\S]*$/gi, '')
    .replace(/\bThe connection was lost mid-run\.\s*/gi, '')
    .replace(/<\/?kombai-collapsible\b[^>]*>\s*/gi, '')
    .replace(/<\/?(?:error|thinking|thought|analysis|final|kombai-markdown-reply)\b[^>]*>\s*/gi, '');
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
  const requestId = options.kombaiRequestId || randomSessionId(16);
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
  const streamToolUseState = {};
  const emittedToolCallIds = new Set();
  const allowedToolNames = allowedToolNamesFromBody(openaiBody);
  let emittedText = '';

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

  function pushToolCalls(toolCalls, raw) {
    const allowedCalls = filterAllowedToolCalls(toolCalls, allowedToolNames);
    for (const toolCall of allowedCalls) {
      if (emittedToolCallIds.has(toolCall.id)) continue;
      emittedToolCallIds.add(toolCall.id);
      push({ type: 'tool_call', toolCall, raw });
    }
    return allowedCalls.length > 0;
  }

  function pushText(text, raw) {
    let next = String(text || '');
    if (!next) return false;
    if (!emittedText) next = next.replace(/^\s+/, '');
    if (!next) return false;
    if (emittedText && emittedText.trimEnd().endsWith(next.trim())) return false;
    if (emittedText && next.startsWith(emittedText)) next = next.slice(emittedText.length);
    if (!next) return false;
    emittedText += next;
    push({ type: 'text', text: next, raw });
    return true;
  }

  function finish() {
    done = true;
    clearTimeout(timeout);
    if (notify) {
      notify();
      notify = null;
    }
  }

  ws.on('open', async () => {
    const stats = socketMessageStats(message);
    const useRestAction = stats.messageBytes >= SOCKET_PAYLOAD_LIMIT && REST_ACTIONS.has(action);
    debugWs('open', {
      action,
      requestId,
      sessionId,
      wsUrl,
      viaProxy: Boolean(proxyUrl),
      transport: useRestAction ? 'rest' : 'socket',
      ...stats,
    });

    try {
      if (useRestAction) {
        await postRestAction(message, apiKey, {
          proxy: options.proxy,
          proxyUrl,
          footprint: options.footprint,
          timeout: Math.min(timeoutMs, 30000),
        });
        return;
      }
      ws.send(JSON.stringify(message), (error) => {
        if (!error) return;
        failure = error;
        finish();
      });
    } catch (error) {
      failure = error;
      finish();
    }
  });

  ws.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(normalizeSocketFrame(data));
    } catch (error) {
      push({ type: 'debug', raw: normalizeSocketFrame(data), error: error.message });
      return;
    }

    debugWs('frame', {
      action: frame.action,
      requestId: frame.requestId,
      expectedRequestId: requestId,
      keys: Object.keys(frame).slice(0, 20),
      responseKeys: frame.response && typeof frame.response === 'object' ? Object.keys(frame.response).slice(0, 20) : [],
      resultKeys: frame.result && typeof frame.result === 'object' ? Object.keys(frame.result).slice(0, 20) : [],
      message: typeof frame.message === 'string' ? frame.message.slice(0, 160) : '',
      hasText: Boolean(frame.response && typeof frame.response.text === 'string'),
      hasResult: Boolean(frame.result),
      pending: frame.pending,
    });
    if (frame.requestId && frame.requestId !== requestId && !['agentv2', 'agentv3'].includes(action)) return;

    const toolCalls = toolCallsFromFrame(frame);
    if (toolCalls.length > 0 && pushToolCalls(toolCalls, frame)) {
      return;
    }

    if (frame.action === 'streamMessage' && frame.response && typeof frame.response.text === 'string') {
      pushToolCalls(toolCallsFromText(frame.response.text, streamToolUseState, allowedToolNames), frame);
      const text = cleanStreamText(frame.response.text, streamCleanState);
      if (text) pushText(text, frame);
      return;
    }

    if (frame.action === 'agentResult' && frame.result && Array.isArray(frame.result.content)) {
      for (const part of frame.result.content) {
        if (part && part.type === 'text' && typeof part.text === 'string') {
          pushToolCalls(toolCallsFromText(part.text, streamToolUseState, allowedToolNames), frame);
          const text = cleanStreamText(part.text, streamCleanState);
          if (text) pushText(text, frame);
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
      debugWs('frame-error', {
        requestId,
        statusCode: frame.statusCode || frame.status || frame.code,
        error: typeof frame.error === 'string' ? frame.error : frame.error && frame.error.errorCode,
        message: typeof frame.message === 'string' ? frame.message.slice(0, 300) : '',
        response: typeof frame.response === 'string' ? frame.response.slice(0, 300) : '',
      });
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
    debugWs('error', { message: error.message });
    failure = error;
    finish();
  });

  ws.on('close', (code, reason) => {
    debugWs('close', { requestId, code, reason: reason ? reason.toString() : '' });
    if (!done) {
      failure = failure || new Error(`Kombai socket closed before response (code=${code || 0}, reason=${reason ? reason.toString() : ''})`);
    }
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
