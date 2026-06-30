#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const MOCK_API_PORT = 3311;
const MOCK_WS_PORT = 3312;
const PROXY_PORT = 3310;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Retry until timeout.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = options.prefix || command;
  child.stdout.on('data', (chunk) => process.stdout.write(`[${prefix}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${prefix}] ${chunk}`));
  return child;
}

async function postJson(pathname, body) {
  const response = await fetch(`http://${HOST}:${PROXY_PORT}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kombai-API-Key': 'mock-key',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${pathname} failed: HTTP ${response.status} ${text}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testAnthropicToolLoop() {
  const first = await postJson('/v1/messages', {
    model: 'claude-opus-4-1',
    max_tokens: 128,
    tools: [
      {
        name: 'Bash',
        description: 'Execute a shell command',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['command'],
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'Please use a tool before replying.',
      },
    ],
  });

  assert(first.type === 'message', 'Anthropic first response must be a message');
  assert(first.stop_reason === 'tool_use', `Expected tool_use stop_reason, got ${first.stop_reason}`);
  const toolUse = Array.isArray(first.content)
    ? first.content.find((part) => part && part.type === 'tool_use')
    : null;
  assert(toolUse && toolUse.id, 'Anthropic first response must contain a tool_use block');

  const second = await postJson('/v1/messages', {
    model: 'claude-opus-4-1',
    max_tokens: 128,
    tools: [
      {
        name: 'Bash',
        description: 'Execute a shell command',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['command'],
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'Please use a tool before replying.',
      },
      {
        role: 'assistant',
        content: first.content,
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: 'tool-ok' },
            ],
          },
        ],
      },
    ],
  });

  const textBlock = Array.isArray(second.content)
    ? second.content.find((part) => part && part.type === 'text')
    : null;
  assert(textBlock && /tool-ok/.test(textBlock.text || ''), 'Anthropic tool_result continuation did not include tool output');
  console.log('[assert] Anthropic tool loop passed');
}

async function testOpenAIToolLoop() {
  const first = await postJson('/v1/chat/completions', {
    model: 'kombai-chat',
    tools: [
      {
        type: 'function',
        function: {
          name: 'Bash',
          description: 'Execute a shell command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['command'],
          },
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'Please use a tool before replying.',
      },
    ],
  });

  const assistant = first && first.choices && first.choices[0] && first.choices[0].message;
  assert(assistant && Array.isArray(assistant.tool_calls) && assistant.tool_calls.length === 1, 'OpenAI first response must contain one tool call');
  const toolCall = assistant.tool_calls[0];

  const second = await postJson('/v1/chat/completions', {
    model: 'kombai-chat',
    tools: [
      {
        type: 'function',
        function: {
          name: 'Bash',
          description: 'Execute a shell command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['command'],
          },
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'Please use a tool before replying.',
      },
      {
        role: 'assistant',
        content: assistant.content,
        tool_calls: assistant.tool_calls,
      },
      {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'tool-ok',
      },
    ],
  });

  const finalMessage = second && second.choices && second.choices[0] && second.choices[0].message;
  assert(finalMessage && /tool-ok/.test(finalMessage.content || ''), 'OpenAI tool_result continuation did not include tool output');
  console.log('[assert] OpenAI tool loop passed');
}

async function testAnthropicPing() {
  const response = await postJson('/v1/messages', {
    model: 'claude-opus-4-1',
    max_tokens: 64,
    messages: [
      {
        role: 'user',
        content: 'ping',
      },
    ],
  });

  const textBlock = Array.isArray(response.content)
    ? response.content.find((part) => part && part.type === 'text')
    : null;
  assert(textBlock && textBlock.text === 'pong', 'Anthropic ping smoke test failed');
  console.log('[assert] Anthropic ping passed');
}

async function main() {
  const mock = startProcess(process.execPath, [path.join(ROOT, 'scripts/mockKombai.js')], {
    prefix: 'mock',
    env: {
      MOCK_KOMBAI_API_PORT: String(MOCK_API_PORT),
      MOCK_KOMBAI_WS_PORT: String(MOCK_WS_PORT),
    },
  });
  const proxy = startProcess(process.execPath, [path.join(ROOT, 'server.js')], {
    prefix: 'proxy',
    env: {
      PORT: String(PROXY_PORT),
      KOMBAI_API_URL: `http://${HOST}:${MOCK_API_PORT}`,
      KOMBAI_WS_URL: `ws://${HOST}:${MOCK_WS_PORT}`,
      KOMBAI_AUTH_CONNECT_URL: `http://${HOST}:${MOCK_API_PORT}/vscode-connect`,
      ANTHROPIC_COMPACT_SYSTEM: '1',
    },
  });

  const stop = async () => {
    for (const child of [proxy, mock]) {
      if (!child.killed) child.kill('SIGTERM');
    }
    await delay(300);
  };

  try {
    await waitForHttp(`http://${HOST}:${PROXY_PORT}/health`);
    await testAnthropicPing();
    await testAnthropicToolLoop();
    await testOpenAIToolLoop();
    console.log('[result] Claude compatibility integration tests passed');
  } finally {
    await stop();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
