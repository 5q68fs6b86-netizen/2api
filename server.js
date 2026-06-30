'use strict';

const http = require('http');
const {
  buildAuthConnectUrl,
  collectChatCompletion,
  exchangeAuthCode,
  pollAuthCode,
  streamChatCompletion,
  verifyUsableApiKey,
} = require('./src/kombaiClient');
const { AccountPool, isRetryableAccountError } = require('./src/accountPool');
const {
  DEFAULT_OPENAI_MODEL_ID,
  makeChatChunk,
  makeChatCompletion,
  openAIModelIds,
  randomId,
} = require('./src/openaiCompat');
const { autoRegisterAccount, checkBrowserRuntime } = require('./src/autoRegister');
const { DEFAULT_KOMBAI_AUTH_URL } = require('./src/kombaiAuth');
const { getStableFootprintOptions } = require('./src/footprint');
const { ThreadStore } = require('./src/threadStore');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const accountPool = new AccountPool();
const threadStore = new ThreadStore();

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

function sendAnthropicError(res, status, message, type = 'api_error') {
  sendJson(res, status, {
    type: 'error',
    error: {
      type,
      message,
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
  const upstreamApiKey = String(req.headers['x-kombai-api-key'] || req.headers['x-upstream-api-key'] || '').trim();
  if (upstreamApiKey) return upstreamApiKey;

  if (ADMIN_TOKEN) {
    const xApiKey = String(req.headers['x-api-key'] || '').trim();
    return xApiKey && xApiKey !== ADMIN_TOKEN ? xApiKey : '';
  }

  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
  return '';
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeAnthropicSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function finishReasonFor(toolCalls) {
  return toolCalls.length > 0 ? 'tool_calls' : 'stop';
}

function anthropicStopReason(toolCalls = []) {
  return toolCalls.length > 0 ? 'tool_use' : 'end_turn';
}

function requestThreadId(body = {}, fallback = '') {
  return firstNonEmpty(
    body.thread_id,
    body.threadId,
    body.metadata && body.metadata.thread_id,
    body.metadata && body.metadata.threadId,
    fallback,
  );
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function anthropicTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (part.type === 'text') return part.text || '';
      if (part.type === 'tool_result') {
        const value = anthropicTextContent(part.content);
        return `Tool result${part.tool_use_id ? ` ${part.tool_use_id}` : ''}:\n${value}`;
      }
      if (part.type === 'tool_use') {
        return `Tool use ${part.name || 'tool'} (${part.id || 'unknown'}):\n${JSON.stringify(part.input || {})}`;
      }
      if (part.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function debugAnthropicBody(body) {
  if (String(process.env.ANTHROPIC_DEBUG_REQUEST || '').trim() !== '1') return;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const summary = {
    model: body.model,
    stream: body.stream === true,
    systemLength: anthropicSystemToText(body.system).length,
    toolNames: tools.slice(0, 30).map((tool) => tool && tool.name).filter(Boolean),
    messages: messages.slice(0, 8).map((message) => {
      const text = anthropicTextContent(message && message.content);
      return {
        role: message && message.role,
        contentType: Array.isArray(message && message.content) ? 'array' : typeof (message && message.content),
        textLength: text.length,
        textStart: text.slice(0, 500),
        textEnd: text.slice(-500),
      };
    }),
  };
  console.error(`[anthropic-debug] ${JSON.stringify(summary)}`);
}

function anthropicContentToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return anthropicTextContent(content);

  const output = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      output.push({ type: 'text', text: part.text || '' });
      continue;
    }
    if (part.type === 'image' && part.source && typeof part.source === 'object') {
      if (part.source.type === 'base64' && part.source.data) {
        const mediaType = part.source.media_type || 'image/png';
        output.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${part.source.data}` } });
        continue;
      }
      if (part.source.type === 'url' && part.source.url) {
        output.push({ type: 'image_url', image_url: { url: part.source.url } });
        continue;
      }
    }
    const text = anthropicTextContent([part]);
    if (text) output.push({ type: 'text', text });
  }

  return output.length > 0 ? output : '';
}

function stripSystemRemindersFromText(text, reminders = []) {
  return String(text || '').replace(/<system-reminder\b[^>]*>([\s\S]*?)<\/system-reminder>/gi, (_match, inner) => {
    const value = String(inner || '').trim();
    if (value) reminders.push(value);
    return '';
  });
}

function stripSystemRemindersFromContent(content, reminders = []) {
  if (typeof content === 'string') return stripSystemRemindersFromText(content, reminders);
  if (!Array.isArray(content)) return content;

  const output = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      output.push(part);
      continue;
    }
    if (part.type === 'text') {
      const text = stripSystemRemindersFromText(part.text || '', reminders);
      if (text.trim()) output.push({ ...part, text });
      continue;
    }
    output.push(part);
  }
  return output;
}

function anthropicToolCallToOpenAI(part) {
  if (!part || typeof part !== 'object' || part.type !== 'tool_use' || !part.name) return null;
  return {
    id: String(part.id || randomId('call')),
    type: 'function',
    function: {
      name: String(part.name),
      arguments: JSON.stringify(part.input || {}),
    },
  };
}

function anthropicMessageToOpenAI(message, reminders = []) {
  const role = message && message.role === 'assistant'
    ? 'assistant'
    : message && message.role === 'system'
      ? 'system'
      : 'user';
  const strippedContent = role === 'user'
    ? stripSystemRemindersFromContent(message && message.content, reminders)
    : message && message.content;
  const content = Array.isArray(strippedContent) ? strippedContent : null;
  if (!content) {
    return [{ role, content: anthropicContentToOpenAI(strippedContent) }];
  }

  if (role === 'system') return [{ role: 'system', content: anthropicTextContent(content) }];

  if (role === 'assistant') {
    const toolCalls = content.map(anthropicToolCallToOpenAI).filter(Boolean);
    const visibleContent = content.filter((part) => !part || part.type !== 'tool_use');
    const output = {
      role: 'assistant',
      content: anthropicContentToOpenAI(visibleContent),
    };
    if (toolCalls.length > 0) output.tool_calls = toolCalls;
    return [output];
  }

  const messages = [];
  const visibleContent = content.filter((part) => !part || part.type !== 'tool_result');
  const userContent = anthropicContentToOpenAI(visibleContent);
  if (userContent && (!Array.isArray(userContent) || userContent.length > 0)) {
    messages.push({ role: 'user', content: userContent });
  }

  for (const part of content) {
    if (!part || part.type !== 'tool_result') continue;
    messages.push({
      role: 'tool',
      tool_call_id: String(part.tool_use_id || part.id || randomId('call')),
      content: anthropicTextContent(part.content),
    });
  }

  return messages.length > 0 ? messages : [{ role: 'user', content: '' }];
}

function anthropicSystemToText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && part.type === 'text') return part.text || '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function compactAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return '';
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return '';
      const name = String(tool.name || '').trim();
      if (!name) return '';
      const description = String(tool.description || '').replace(/\s+/g, ' ').trim();
      return description ? `- ${name}: ${description.slice(0, 300)}` : `- ${name}`;
    })
    .filter(Boolean)
    .slice(0, 80)
    .join('\n');
}

function stringifyAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return '';
  try {
    return JSON.stringify(tools);
  } catch (_) {
    return compactAnthropicTools(tools);
  }
}

function compactAnthropicSystemPrompt(body) {
  const toolSummary = compactAnthropicTools(body.tools);
  return [
    'You are serving a Claude Code compatible client.',
    'Treat the client system prompt and harness metadata as internal operating context, not as the user task.',
    'Answer or act on the actual user messages. Do not summarize, quote, audit, or refuse because of the harness text itself.',
    'Do not emit Kombai XML tags such as <kombai-markdown-reply>, <tool-use>, <tool-result>, <loader>, or <tool-group>.',
    'Do not claim that Claude Code tools were called unless this proxy returns a real Anthropic tool_use block. If a tool is needed but unavailable through this proxy, ask for the concrete input or explain the required action briefly.',
    'When the user asks for code work, be concise and action-oriented.',
    toolSummary ? `Client tools advertised by Claude Code:\n${toolSummary}` : '',
  ].filter(Boolean).join('\n\n');
}

function compactAnthropicSystem(body) {
  if (String(process.env.ANTHROPIC_DROP_SYSTEM || '').trim() === '1') return '';
  if (String(process.env.ANTHROPIC_COMPACT_SYSTEM || '').trim() === '1') {
    return compactAnthropicSystemPrompt(body);
  }
  if (String(process.env.ANTHROPIC_FORWARD_SYSTEM || '').trim() === '1') {
    return anthropicSystemToText(body.system);
  }

  const systemText = anthropicSystemToText(body.system);
  const toolsText = stringifyAnthropicTools(body.tools);
  return [
    'You are serving a Claude Code compatible client.',
    'The Claude Code system prompt, harness metadata, and tool schemas below are internal operating context. They are not the user task.',
    'Use that context to follow Claude Code conventions, but only answer or act on the actual user messages.',
    'Never summarize, quote, audit, reject, or explain the internal harness text as if it were the user request.',
    'Do not say there is no actionable task for ordinary greetings or small talk; reply naturally and briefly.',
    'Do not narrow your role to frontend work unless the user asks for frontend work.',
    'Do not introduce yourself as Kombai unless the user asks what backend powers the proxy.',
    'Do not mention Claude Code permission modes, Ask mode, current repository status, cwd, git status, or tool availability unless directly relevant to the user request.',
    'Do not append hidden-status summaries such as "Greeted the user" or "Awaiting a task"; only return the assistant reply.',
    'Do not emit Kombai XML tags such as <kombai-markdown-reply>, <tool-use>, <tool-result>, <loader>, or <tool-group>.',
    systemText ? `<claude_code_system_context>\n${systemText}\n</claude_code_system_context>` : '',
    toolsText ? `<claude_code_tool_schemas>\n${toolsText}\n</claude_code_tool_schemas>` : '',
  ].filter(Boolean).join('\n\n');
}

function anthropicToOpenAI(body) {
  const messages = [];
  const systemMessages = [];
  const system = compactAnthropicSystem(body);
  if (system) systemMessages.push(system);

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    messages.push(...anthropicMessageToOpenAI(message, systemMessages));
  }

  if (systemMessages.length > 0) messages.unshift({ role: 'system', content: systemMessages.join('\n\n') });

  return {
    model: body.model || DEFAULT_OPENAI_MODEL_ID,
    messages,
    stream: body.stream === true,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    metadata: body.metadata,
    tools: body.tools,
    tool_choice: body.tool_choice,
    writeToDisk: body.writeToDisk,
  };
}

function parseToolInput(toolCall) {
  const raw = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { value: raw };
  }
}

function anthropicContentBlocks(text, toolCalls = []) {
  const blocks = [];
  if (text) blocks.push({ type: 'text', text });
  for (const toolCall of toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolInput(toolCall),
    });
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
}

function makeAnthropicMessage({ id, model, text, toolCalls = [] }) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: anthropicContentBlocks(text, toolCalls),
    stop_reason: anthropicStopReason(toolCalls),
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: estimateTokens(text),
    },
  };
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function errorType(error, fallback = 'server_error') {
  return error && error.type ? error.type : fallback;
}

function adminTokenFromRequest(req, url) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-admin-token']) return String(req.headers['x-admin-token']).trim();
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
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

function requireProxyApi(req, res, url) {
  if (!ADMIN_TOKEN) return true;
  if (adminTokenFromRequest(req, url) === ADMIN_TOKEN) return true;
  sendError(res, 401, 'admin token 无效或缺失', 'authentication_error');
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

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function redactAdminProgress(value) {
  if (Array.isArray(value)) return value.map(redactAdminProgress);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
      .replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
      .replace(/\b[a-f0-9]{48,}\b/gi, '[redacted-token]');
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|token|password|link|url|email|code/i.test(key)) {
      output[key] = item ? '[redacted]' : item;
    } else {
      output[key] = redactAdminProgress(item);
    }
  }
  return output;
}

function proxyForAutoRegister(body = {}) {
  const directProxy = firstNonEmpty(
    body.proxyUrl,
    body.proxy && body.proxy.uri,
    typeof body.proxy === 'string' ? body.proxy : '',
  );
  if (directProxy) return directProxy;
  return accountPool.pickProxy();
}

function buildAutoRegisterOptions(body = {}, onProgress, proxy = null) {
  const pollTimeoutMs = Number(firstNonEmpty(body.pollTimeoutMs, process.env.KOMBAI_AUTH_TIMEOUT_MS, 120000)) || 120000;
  const turnstileTimeoutMs = Number(firstNonEmpty(body.turnstileTimeoutMs, process.env.TURNSTILE_TIMEOUT_MS, 180000)) || 180000;
  return {
    emailPrefix: firstNonEmpty(body.emailPrefix, process.env.AUTO_EMAIL_PREFIX, 'kombai'),
    turnstileToken: firstNonEmpty(body.turnstileToken, process.env.TURNSTILE_TOKEN) || undefined,
    inviteToken: firstNonEmpty(body.inviteToken, process.env.KOMBAI_INVITE_TOKEN, process.env.INVITE_TOKEN) || undefined,
    authUrl: firstNonEmpty(body.authUrl, process.env.KOMBAI_AUTH_URL) || undefined,
    pollTimeoutMs,
    turnstileTimeoutMs,
    proxy,
    footprintSeed: firstNonEmpty(body.footprintSeed) || undefined,
    ...(onProgress ? { onProgress } : {}),
  };
}

function parseAutoFillCount(rawCount, missing) {
  const requestedCount = rawCount === undefined || rawCount === null || rawCount === ''
    ? missing
    : Number(rawCount);
  return Math.min(Number.isFinite(requestedCount) ? requestedCount : missing, 20);
}

async function autoFillPool(body = {}, onProgress) {
  const state = accountPool.getState();
  const missing = state.pool.missingAccounts;
  const count = parseAutoFillCount(body.count, missing);
  if (count <= 0) {
    return { success: true, message: '号池已满，无需填充', results: [] };
  }

  const results = [];
  for (let i = 0; i < count; i += 1) {
    const proxy = proxyForAutoRegister(body);
    const proxyContext = proxy && typeof proxy === 'object' ? { proxy } : {};
    try {
      const result = await autoRegisterAccount(buildAutoRegisterOptions(body, onProgress, proxy));
      if (result.success && result.apiKey) {
        const account = accountPool.addAccount({
          apiKey: result.apiKey,
          label: `auto: ${result.email}`,
          source: 'auto-register',
          footprintSeed: result.footprintSeed,
        });
        if (proxyContext.proxy) accountPool.recordSuccess(proxyContext);
        results.push({ index: i, success: true, email: result.email, account });
      } else {
        if (proxyContext.proxy) accountPool.recordFailure(proxyContext, new Error('注册流程未完成'));
        results.push({ index: i, success: false, error: '注册流程未完成' });
      }
    } catch (error) {
      if (proxyContext.proxy) accountPool.recordFailure(proxyContext, error);
      results.push({ index: i, success: false, error: error.message });
    }
  }

  return { success: true, count: results.length, results };
}

function shouldAutoFillOnStartup() {
  const value = firstNonEmpty(process.env.AUTO_FILL_ON_STARTUP, 'false').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function scheduleStartupAutoFill() {
  if (!shouldAutoFillOnStartup()) return;
  const delayMs = Number(firstNonEmpty(process.env.AUTO_FILL_STARTUP_DELAY_MS, 3000)) || 3000;
  setTimeout(async () => {
    console.log('[auto-fill-startup] starting');
    const result = await autoFillPool({}, (progress) => {
      console.log('[auto-fill-startup]', JSON.stringify(redactAdminProgress(progress)));
    });
    const ok = result.results ? result.results.filter((item) => item.success).length : 0;
    const fail = result.results ? result.results.filter((item) => !item.success).length : 0;
    console.log('[auto-fill-startup] done', JSON.stringify({ success: result.success, count: result.count || 0, ok, fail, message: result.message }));
  }, delayMs);
}

function envConfigured(name) {
  return Boolean(firstNonEmpty(process.env[name]));
}

async function buildAutoRegisterDiagnostics() {
  let browser;
  try {
    browser = await checkBrowserRuntime();
  } catch (error) {
    browser = {
      ok: false,
      error: errorMessage(error),
    };
  }

  return {
    ok: browser.ok === true,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    config: {
      autoEmailPrefix: firstNonEmpty(process.env.AUTO_EMAIL_PREFIX, 'kombai'),
      authUrl: firstNonEmpty(process.env.KOMBAI_AUTH_URL, DEFAULT_KOMBAI_AUTH_URL),
      turnstileTokenConfigured: envConfigured('TURNSTILE_TOKEN'),
      inviteTokenConfigured: envConfigured('KOMBAI_INVITE_TOKEN') || envConfigured('INVITE_TOKEN'),
      authUrlConfigured: envConfigured('KOMBAI_AUTH_URL'),
      authConnectUrlConfigured: envConfigured('KOMBAI_AUTH_CONNECT_URL'),
      pollTimeoutMs: Number(firstNonEmpty(process.env.KOMBAI_AUTH_TIMEOUT_MS, 120000)) || 120000,
      tempMailApiConfigured: envConfigured('TEMP_MAIL_API'),
      tempMailAdminAuthConfigured: envConfigured('TEMP_MAIL_ADMIN_AUTH'),
      tempMailDomainConfigured: envConfigured('TEMP_MAIL_DOMAIN'),
      playwrightChromiumArgs: firstNonEmpty(process.env.PLAYWRIGHT_CHROMIUM_ARGS),
    },
    browser,
  };
}

async function runCollectWithPool(body, directApiKey, requestId) {
  const attempts = accountPool.accountAttempts(directApiKey);
  if (attempts.length === 0) {
    const error = new Error('号池为空。请在 /admin 添加已授权 Kombai API key，或在请求里传 X-Kombai-API-Key: <apiKeyToken>。');
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
      await verifyUsableApiKey(attempt.apiKey, { proxy, footprint: attempt.footprint });
      const result = await collectChatCompletion(body, attempt.apiKey, { requestId, proxy, footprint: attempt.footprint });
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
  const model = body.model || DEFAULT_OPENAI_MODEL_ID;
  const id = randomId('chatcmpl');
  const threadId = requestThreadId(body, threadStore.inferThreadId(body.messages) || id);
  const requestBody = { ...body, model, thread_id: threadId };

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
          message: '号池为空。请在 /admin 添加已授权 Kombai API key，或在请求里传 X-Kombai-API-Key: <apiKeyToken>。',
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
        await verifyUsableApiKey(attempt.apiKey, { proxy, footprint: attempt.footprint });
        for await (const event of streamChatCompletion(requestBody, attempt.apiKey, { requestId: id, proxy, footprint: attempt.footprint })) {
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
            threadStore.rememberToolCalls(threadId, [event.toolCall]);
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
        writeSse(res, { error: { message: errorMessage(error), type: errorType(error) } });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    writeSse(res, { error: { message: errorMessage(lastError), type: errorType(lastError) } });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const result = await runCollectWithPool(requestBody, directApiKey, id);
  threadStore.rememberToolCalls(threadId, result.toolCalls);
  sendJson(res, 200, makeChatCompletion({
    id,
    model,
    text: result.text,
    toolCalls: result.toolCalls,
    finishReason: finishReasonFor(result.toolCalls),
  }));
}

async function handleAnthropicMessages(req, res) {
  const directApiKey = getRequestApiKey(req);
  const body = await readJson(req);
  debugAnthropicBody(body);
  const openaiBody = anthropicToOpenAI(body);
  const model = body.model || openaiBody.model || DEFAULT_OPENAI_MODEL_ID;
  const id = randomId('msg');
  const threadId = requestThreadId(openaiBody, threadStore.inferThreadId(openaiBody.messages) || id);
  const requestBody = { ...openaiBody, thread_id: threadId };

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const attempts = accountPool.accountAttempts(directApiKey);
    if (attempts.length === 0) {
      writeAnthropicSse(res, 'error', {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: '号池为空。请在 /admin 添加已授权 Kombai API key，或在请求里传 X-Kombai-API-Key: <apiKeyToken>。',
        },
      });
      res.end();
      return;
    }

    let messageStarted = false;
    let textBlockOpen = false;
    let contentIndex = 0;
    let emitted = false;
    let toolUseEmitted = false;
    let outputText = '';
    let lastError = null;

    const startMessage = () => {
      if (messageStarted) return;
      writeAnthropicSse(res, 'message_start', {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
      messageStarted = true;
    };

    const startTextBlock = () => {
      startMessage();
      if (textBlockOpen) return;
      writeAnthropicSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: contentIndex,
        content_block: { type: 'text', text: '' },
      });
      textBlockOpen = true;
    };

    const stopTextBlock = () => {
      if (!textBlockOpen) return;
      writeAnthropicSse(res, 'content_block_stop', {
        type: 'content_block_stop',
        index: contentIndex,
      });
      textBlockOpen = false;
      contentIndex += 1;
    };

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      const proxy = accountPool.pickProxy();
      const context = { ...attempt, proxy };
      let attemptEmitted = false;

      try {
        await verifyUsableApiKey(attempt.apiKey, { proxy, footprint: attempt.footprint });
        for await (const event of streamChatCompletion(requestBody, attempt.apiKey, { requestId: id, proxy, footprint: attempt.footprint })) {
          if (event.type === 'text' && event.text) {
            emitted = true;
            attemptEmitted = true;
            outputText += event.text;
            startTextBlock();
            writeAnthropicSse(res, 'content_block_delta', {
              type: 'content_block_delta',
              index: contentIndex,
              delta: { type: 'text_delta', text: event.text },
            });
          }

          if (event.type === 'tool_call' && event.toolCall) {
            emitted = true;
            attemptEmitted = true;
            toolUseEmitted = true;
            threadStore.rememberToolCalls(threadId, [event.toolCall]);
            stopTextBlock();
            const input = parseToolInput(event.toolCall);
            writeAnthropicSse(res, 'content_block_start', {
              type: 'content_block_start',
              index: contentIndex,
              content_block: {
                type: 'tool_use',
                id: event.toolCall.id,
                name: event.toolCall.function.name,
                input: {},
              },
            });
            writeAnthropicSse(res, 'content_block_delta', {
              type: 'content_block_delta',
              index: contentIndex,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
            });
            writeAnthropicSse(res, 'content_block_stop', {
              type: 'content_block_stop',
              index: contentIndex,
            });
            contentIndex += 1;
          }
        }

        accountPool.recordSuccess(context);
        startMessage();
        if (!emitted) {
          startTextBlock();
          stopTextBlock();
        } else {
          stopTextBlock();
        }
        writeAnthropicSse(res, 'message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: toolUseEmitted ? 'tool_use' : 'end_turn',
            stop_sequence: null,
          },
          usage: { output_tokens: estimateTokens(outputText) },
        });
        writeAnthropicSse(res, 'message_stop', { type: 'message_stop' });
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
        writeAnthropicSse(res, 'error', {
          type: 'error',
          error: { type: errorType(error), message: errorMessage(error) },
        });
        res.end();
        return;
      }
    }

    writeAnthropicSse(res, 'error', {
      type: 'error',
      error: { type: errorType(lastError), message: errorMessage(lastError) },
    });
    res.end();
    return;
  }

  const result = await runCollectWithPool(requestBody, directApiKey, id);
  threadStore.rememberToolCalls(threadId, result.toolCalls);
  sendJson(res, 200, makeAnthropicMessage({
    id,
    model,
    text: result.text,
    toolCalls: result.toolCalls,
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
          <label>Turnstile Token</label>
          <input id="autoTurnstileToken" placeholder="留空使用 TURNSTILE_TOKEN">
        </div>
        <div class="col-3">
          <label>注册数量</label>
          <input id="autoFillCount" type="number" min="1" max="20" placeholder="默认填充到目标数">
        </div>
        <div class="col-3 row" style="align-items:end">
          <button onclick="autoRegisterOne(this)">注册一个</button>
          <button class="secondary" onclick="autoFillPool(this)">填充号池</button>
          <button class="secondary" onclick="checkAutoRegisterDiagnostics(this)">检查环境</button>
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
      const apiUrl = adminApiUrl(path);
      const res = await fetch(apiUrl, { ...options, headers: { ...headers, ...(options && options.headers || {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error && data.error.message || 'HTTP ' + res.status);
      return data;
    }

    function adminApiUrl(path) {
      if (!path.startsWith('/admin/api/')) return path;
      const base = new URL(window.location.href);
      base.search = '';
      base.hash = '';
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      return new URL(path.slice('/admin/'.length), base).toString();
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

    async function autoRegisterOne(btn) {
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
          setAutoRegStatus('注册成功！邮箱: ' + data.email + '，已自动添加到号池。', 'ok');
        } else {
          setAutoRegStatus('注册失败: ' + (data.error || '未知错误'), 'error');
        }
        await loadState();
      } catch (error) {
        setAutoRegStatus('注册失败: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function autoFillPool(btn) {
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
          const firstError = data.results.find(function(r) { return !r.success && r.error; });
          setAutoRegStatus('填充完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个。' + (firstError ? ' 首个错误: ' + firstError.error : ''), ok > 0 ? 'ok' : 'warn');
        } else {
          setAutoRegStatus('填充完成: ' + JSON.stringify(data), 'ok');
        }
        await loadState();
      } catch (error) {
        setAutoRegStatus('填充失败: ' + error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function checkAutoRegisterDiagnostics(btn) {
      btn.disabled = true;
      setAutoRegStatus('正在检查自动注册环境...', 'muted');
      try {
        const data = await api('/admin/api/auto-register/diagnostics');
        const missing = [];
        if (!data.config.turnstileTokenConfigured) missing.push('TURNSTILE_TOKEN');
        if (!data.browser.ok) missing.push('Playwright Chromium');
        setAutoRegStatus(
          (data.ok ? '环境检查通过。' : '环境检查未通过。') +
            ' 浏览器: ' + (data.browser.ok ? '正常' : (data.browser.error || '异常')) +
            '；Turnstile: ' + (data.config.turnstileTokenConfigured ? '已配置' : '未配置') +
            (missing.length ? '；需要检查: ' + missing.join(', ') : ''),
          data.ok ? 'ok' : 'warn',
        );
      } catch (error) {
        setAutoRegStatus('环境检查失败: ' + error.message, 'error');
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

  if (req.method === 'GET' && url.pathname === '/admin/api/auto-register/diagnostics') {
    sendJson(res, 200, await buildAutoRegisterDiagnostics());
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
      const result = await verifyUsableApiKey(account.apiKey, {
        footprint: getStableFootprintOptions(account.footprintSeed || account.apiKey),
      });
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
    const footprint = getStableFootprintOptions(apiKey);
    await verifyUsableApiKey(apiKey, { footprint });
    const account = accountPool.addAccount({ apiKey, label: body.label || 'auth account' });
    sendJson(res, 200, { ok: true, account });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/auto-register') {
    const proxy = proxyForAutoRegister(body);
    try {
      const result = await autoRegisterAccount(buildAutoRegisterOptions(
        body,
        (progress) => {
          console.log('[auto-register]', JSON.stringify(redactAdminProgress(progress)));
        },
        proxy,
      ));
      if (result.success && result.apiKey) {
        const account = accountPool.addAccount({
          apiKey: result.apiKey,
          label: `auto: ${result.email}`,
          source: 'auto-register',
          footprintSeed: result.footprintSeed,
        });
        if (proxy && typeof proxy === 'object') accountPool.recordSuccess({ proxy });
        sendJson(res, 200, { ...result, account });
      } else {
        sendJson(res, 200, result);
      }
    } catch (error) {
      if (proxy && typeof proxy === 'object') accountPool.recordFailure({ proxy }, error);
      console.error('[auto-register] Error:', error.message);
      sendJson(res, 500, { success: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/auto-fill') {
    sendJson(res, 200, await autoFillPool(body));
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

  if (url.pathname.startsWith('/v1/') && !requireProxyApi(req, res, url)) {
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(res, 200, {
      object: 'list',
      data: openAIModelIds().map((id) => ({
        id,
        object: 'model',
        created: 0,
        owned_by: 'kombai',
      })),
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

  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    await handleAnthropicMessages(req, res);
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
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/v1/messages') {
      sendAnthropicError(res, status, error.message || String(error), error.type || 'api_error');
      return;
    }
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

async function startServer() {
  await accountPool.init();
  server.listen(PORT, () => {
    console.log(`2api listening on http://127.0.0.1:${PORT}`);
    scheduleStartupAutoFill();
  });
}

startServer().catch((error) => {
  console.error(`启动失败: ${error.message}`);
  process.exit(1);
});
