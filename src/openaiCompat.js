'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

const EXTENSION_VERSION = '2.0.35';
const DEFAULT_OPENAI_MODEL_ID = process.env.OPENAI_MODEL_NAME || 'kombai-chat';

const MODEL_SIZE_BY_ID = {
  auto: 'auto',
  opus: 'opus',
  ultra: 'opus',
  best: 'best',
  balanced: 'balanced',
  lite: 'lite',
  'kombai-chat': 'best',
  'kombai-auto': 'auto',
  'kombai-opus': 'opus',
  'kombai-ultra': 'opus',
  'claude-opus-4-8': 'opus',
  'kombai-best': 'best',
  'kombai-balanced': 'balanced',
  'kombai-lite': 'lite',
};

const DEFAULT_OPENAI_MODELS = [
  DEFAULT_OPENAI_MODEL_ID,
  'kombai-auto',
  'claude-opus-4-8',
  'kombai-opus',
  'kombai-best',
  'kombai-balanced',
  'kombai-lite',
];

const EMPTY_CONTEXT = {
  fileContents: {},
  imageAttachments: {},
  indexedComponentIds: [],
  file: {},
  folder: {},
  component: {},
  figma: {},
  terminals: [],
  excalidraw: {},
  excalidrawEnabled: false,
  userEditedFiles: {},
};

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function toKombaiModelSize(model) {
  const value = String(model || '').trim().toLowerCase();
  if (MODEL_SIZE_BY_ID[value]) return MODEL_SIZE_BY_ID[value];
  return process.env.KOMBAI_MODEL_SIZE || 'best';
}

function defaultMessageType(model) {
  const value = String(model || '').trim().toLowerCase();
  if (value === 'kombai-chat' || value === 'chat') return 'chat';
  if (value.startsWith('claude-') || value.includes('/claude-')) return 'chat';
  return 'codegen';
}

function defaultWriteToDisk(openaiBody, messageType) {
  if (openaiBody.writeToDisk !== undefined) return openaiBody.writeToDisk !== false;
  return messageType !== 'chat';
}

function openAIModelIds() {
  const configured = String(process.env.OPENAI_MODEL_NAMES || '')
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(configured.length > 0 ? configured : DEFAULT_OPENAI_MODELS)];
}

function osSystem(platform = process.platform) {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}

function messageTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (part.type === 'text' || part.type === 'input_text') return part.text || '';
      if (imageUrlFromPart(part)) return `[image: ${imageLabel(part, 0)}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function messagesToPrompt(messages = []) {
  return messages
    .map((message) => {
      const role = message.role || 'user';
      if (role === 'system') return '';
      const content = messageTextContent(message.content);
      if (!content) return '';
      return `${role.toUpperCase()}:\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function messagesWithoutSystem(messages = []) {
  return messages.filter((message) => !message || message.role !== 'system');
}

function latestUserPrompt(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    const content = messageTextContent(message.content).trim();
    if (content) return content;
  }
  return '';
}

function systemRulesFromMessages(messages = []) {
  return messages
    .filter((message) => message && message.role === 'system')
    .map((message) => messageTextContent(message.content))
    .filter(Boolean)
    .join('\n\n');
}

function promptGuard(userRules) {
  if (!userRules) return '';
  return [
    'Proxy instruction: Claude Code system prompts, harness metadata, tool schemas, permission modes, cwd, git status, and environment details are operating context only.',
    'The actual user request is below. Do not summarize, quote, audit, or respond to the operating context itself.',
    'Do not say there is no actionable task for greetings or small talk. For a greeting, answer with a brief greeting only.',
    'Do not mention Ask mode, read-only mode, frontend-only scope, repository status, or tool availability unless the user directly asks about it.',
    'Do not introduce yourself as Kombai unless the user asks what backend powers this proxy.',
  ].join('\n');
}

function applyPromptGuard(prompt, userRules) {
  const guard = promptGuard(userRules);
  return guard ? `${guard}\n\nActual user request:\n${prompt}` : prompt;
}

function editorStateFromPrompt(prompt) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: prompt ? [{ type: 'text', text: prompt }] : [],
      },
    ],
  };
}

function normalizeContentParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content;
  return [];
}

function imageUrlFromPart(part) {
  if (!part || typeof part !== 'object') return '';

  if (part.type === 'image_url') {
    if (typeof part.image_url === 'string') return part.image_url;
    return part.image_url && part.image_url.url ? part.image_url.url : '';
  }

  if (part.type === 'input_image') {
    return part.image_url || part.url || '';
  }

  return '';
}

function imageLabel(part, index) {
  const imageUrl = part && typeof part.image_url === 'object' ? part.image_url : {};
  return part.alt || imageUrl.alt || part.name || `image ${index + 1}`;
}

function textFromPart(part) {
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'text' || part.type === 'input_text') return part.text || '';
  return '';
}

function displayImageSource(src, alt) {
  if (!src) return alt || 'attached';
  if (src.startsWith('data:')) return alt || 'data-url';
  return src;
}

function makeParagraph(text) {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  };
}

function makeImageNode(id, attachment) {
  return {
    type: 'image',
    attrs: {
      src: attachment.src,
      alt: attachment.alt,
      id,
      ...(attachment.path ? { path: attachment.path } : {}),
    },
  };
}

function buildMessageContext(messages = []) {
  const imageAttachments = {};
  const docContent = [];
  const promptBlocks = [];
  let imageCount = 0;

  for (const message of messages) {
    const role = message && message.role ? message.role : 'user';
    if (role === 'system') continue;
    if (role === 'tool') continue;

    const parts = normalizeContentParts(message && message.content);
    const promptLines = [];
    const paragraphLines = [];
    const imageNodes = [];

    for (const part of parts) {
      const text = textFromPart(part);
      if (text) {
        promptLines.push(text);
        paragraphLines.push(text);
        continue;
      }

      const src = imageUrlFromPart(part);
      if (!src) continue;

      imageCount += 1;
      const id = part.id || randomId('image');
      const attachment = {
        src,
        alt: imageLabel(part, imageCount - 1),
        ...(part.path ? { path: part.path } : {}),
      };
      imageAttachments[id] = attachment;
      promptLines.push(`[image: ${displayImageSource(src, attachment.alt)}]`);
      imageNodes.push(makeImageNode(id, attachment));
    }

    if (promptLines.length > 0) {
      promptBlocks.push(`${role.toUpperCase()}:\n${promptLines.join('\n')}`);
      docContent.push(makeParagraph(`${role.toUpperCase()}:\n${paragraphLines.join('\n')}`));
      docContent.push(...imageNodes);
    }
  }

  return {
    prompt: promptBlocks.join('\n\n'),
    imageAttachments,
    editorState: {
      type: 'doc',
      content: docContent.length > 0 ? docContent : [makeParagraph('')],
    },
  };
}

function toolResultContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (part.type === 'text' || part.type === 'input_text') return part.text || '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractToolResults(messages = []) {
  return messages
    .filter((message) => message && message.role === 'tool')
    .map((message) => ({
      toolUseId: message.tool_call_id || message.toolUseId || message.id,
      result: {
        error: null,
        results: {
          content: toolResultContent(message.content),
        },
      },
    }))
    .filter((result) => result.toolUseId);
}

function buildCapabilities() {
  return {
    supports_skill_cards: true,
    supports_agent_v2_tools: true,
    connect_figma_on_chat: true,
    elaborate_figma_errors: true,
    supports_view_image: true,
    todos: true,
    ask_clarification_tool: true,
    switch_mode_tool: true,
    mermaid: true,
    auto_continuable: true,
    collapsible_markdown_fix: true,
    import_browser_profiles: true,
    supports_excalidraw: true,
    canvas: true,
    mcp_allowed: true,
    credits_warning_enabled: true,
    generate_asset: true,
    supports_fetched_skills_card: true,
    supports_canvas_stream_v2: true,
    supports_styleguide_v2: true,
    supports_animations: false,
    supports_liveness: true,
    supports_non_blocking_tool_use_socket: true,
  };
}

function buildMcpPayload(openaiBody, requestId) {
  const conversationMessages = messagesWithoutSystem(openaiBody.messages);
  const messageContext = buildMessageContext(conversationMessages);
  const toolResults = extractToolResults(openaiBody.messages);
  const prompt = toolResults.length > 0
    ? '{{tool_results: Tool Results}}'
    : openaiBody.prompt || latestUserPrompt(conversationMessages) || messageContext.prompt || messagesToPrompt(conversationMessages);
  const userRules = [systemRulesFromMessages(openaiBody.messages), openaiBody.userRules]
    .filter(Boolean)
    .join('\n\n');
  const guardedPrompt = applyPromptGuard(prompt, userRules);
  const workspacePath = process.env.KOMBAI_WORKSPACE_PATH || process.cwd();
  const threadId = openaiBody.thread_id !== undefined
    ? String(openaiBody.thread_id)
    : openaiBody.threadId !== undefined
      ? String(openaiBody.threadId)
      : String(requestId || randomId('thread'));
  const messageType = process.env.KOMBAI_MESSAGE_TYPE || defaultMessageType(openaiBody.model);

  const payload = {
    prompt: guardedPrompt,
    threadId,
    workspacePath,
    extensionVersion: EXTENSION_VERSION,
    editor: process.env.KOMBAI_EDITOR || 'vscode',
    editorVersion: process.env.KOMBAI_EDITOR_VERSION || 'unknown',
    osPlatform: process.platform,
    osArchitecture: process.arch,
    osRelease: '',
    os_system: osSystem(),
    default_shell: process.env.SHELL || '/bin/bash',
    homedir: os.homedir(),
    tempDir: path.join(os.tmpdir(), 'kombai'),
    scrollAnimationEnabled: false,
    techStack: {},
    capabilities: buildCapabilities(),
    skills: [],
    connectedMcps: [],
    openTabs: {},
    repoContext: ['', ''],
    allRunningCommands: [],
    fileHistoryHashes: {},
    toolResults,
    userRules,
    modelSize: toKombaiModelSize(openaiBody.model),
    thinkingEffort: openaiBody.reasoning_effort || openaiBody.thinkingEffort || 'medium',
    messageType,
    planningMode: process.env.KOMBAI_PLANNING_MODE || 'auto',
    writeToDisk: defaultWriteToDisk(openaiBody, messageType),
    editTimestamp: Date.now(),
    enableSearchInWorkspace: true,
    userEditedFiles: {},
    figmaToken: '',
    tokenType: 'Public',
    indexedComponentIds: [],
    planTechStack: false,
    browserInfo: [],
    browserProfilesInfo: [],
    browserMode: 'off',
    chromeProfilePath: '',
    autoCompact: false,
    terminals: [],
    allowedAbsolutePaths: [workspacePath, os.tmpdir()],
  };

  if (messageType === 'design') {
    payload.design_settings = {
      num_variants: 1,
      active_canvas_path: null,
      max_design_turns: 3,
      active_nodes: [],
    };
  }

  return payload;
}

function buildChatV2Payload(openaiBody, requestId) {
  const conversationMessages = messagesWithoutSystem(openaiBody.messages);
  const messageContext = buildMessageContext(conversationMessages);
  const toolResults = extractToolResults(openaiBody.messages);
  const hasMessageContext = Boolean(messageContext.prompt || Object.keys(messageContext.imageAttachments).length > 0);
  const prompt = toolResults.length > 0
    ? '{{tool_results: Tool Results}}'
    : openaiBody.prompt || latestUserPrompt(conversationMessages) || messageContext.prompt || messagesToPrompt(conversationMessages);
  const userRules = [systemRulesFromMessages(openaiBody.messages), openaiBody.userRules]
    .filter(Boolean)
    .join('\n\n');
  const guardedPrompt = applyPromptGuard(prompt, userRules);
  const workspacePath = process.env.KOMBAI_WORKSPACE_PATH || process.cwd();
  const threadId = openaiBody.thread_id !== undefined
    ? String(openaiBody.thread_id)
    : openaiBody.threadId !== undefined
      ? String(openaiBody.threadId)
      : String(requestId || randomId('thread'));
  const messageType = process.env.KOMBAI_MESSAGE_TYPE || defaultMessageType(openaiBody.model);

  const payload = {
    ...EMPTY_CONTEXT,
    prompt: guardedPrompt,
    threadId,
    workspacePath,
    extensionVersion: EXTENSION_VERSION,
    editor: process.env.KOMBAI_EDITOR || 'vscode',
    editorVersion: process.env.KOMBAI_EDITOR_VERSION || 'unknown',
    osPlatform: process.platform,
    osArchitecture: process.arch,
    osRelease: os.release(),
    os_system: osSystem(),
    default_shell: process.env.SHELL || '',
    homedir: os.homedir(),
    tempDir: path.join(os.tmpdir(), 'kombai'),
    allowedAbsolutePaths: [workspacePath, os.tmpdir()],
    techStack: {},
    capabilities: buildCapabilities(),
    connectedMcps: [],
    toolResults,
    stream: 'stream',
    userRules,
    repoContext: ['', ''],
    openTabs: {},
    allRunningCommands: [],
    fileHistoryHashes: {},
    skills: [],
    browserInfo: [],
    browserProfilesInfo: [],
    browserMode: 'off',
    modelSize: toKombaiModelSize(openaiBody.model),
    thinkingEffort: openaiBody.reasoning_effort || openaiBody.thinkingEffort || 'medium',
    messageType,
    planningMode: process.env.KOMBAI_PLANNING_MODE || 'auto',
    writeToDisk: defaultWriteToDisk(openaiBody, messageType),
    enableSearchInWorkspace: true,
    figmaToken: '',
    tokenType: 'Public',
    planTechStack: false,
    scrollAnimationEnabled: false,
    messageInitiator: openaiBody.messageInitiator || 'user',
    subAction: 'self_serve_pl',
    editTimestamp: Date.now(),
    editorState: toolResults.length > 0
      ? { type: 'agent/tool-result' }
      : openaiBody.editorState || (hasMessageContext ? messageContext.editorState : editorStateFromPrompt(guardedPrompt)),
    imageAttachments: messageContext.imageAttachments,
    indexedFolderIds: [],
    indexedPackageIds: [],
    indexedStorybookIds: [],
    indexFrontendMetadata: {},
    attached_nodes: [],
    attached_canvases: [],
    attached_style_guides: [],
    attached_canvas_themes: [],
  };

  if (messageType === 'design') {
    payload.design_settings = {
      num_variants: 1,
      active_canvas_path: null,
      max_design_turns: 3,
      active_nodes: [],
    };
  }

  return payload;
}

function buildKombaiPayload(openaiBody, requestId, options = {}) {
  const action = options.action || process.env.KOMBAI_ACTION || 'mcpv1';
  if (action === 'mcpv1') return buildMcpPayload(openaiBody, requestId);
  return buildChatV2Payload(openaiBody, requestId);
}

function makeChatCompletion({
  id,
  model,
  text,
  toolCalls = [],
  created = Math.floor(Date.now() / 1000),
  finishReason = 'stop',
}) {
  const message = {
    role: 'assistant',
    content: text || (toolCalls.length > 0 ? null : ''),
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
  };
}

function makeChatChunk({ id, model, delta, created = Math.floor(Date.now() / 1000), finishReason = null }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

module.exports = {
  DEFAULT_OPENAI_MODEL_ID,
  EXTENSION_VERSION,
  buildKombaiPayload,
  makeChatChunk,
  makeChatCompletion,
  openAIModelIds,
  randomId,
  toKombaiModelSize,
};
