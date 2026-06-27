'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

const EXTENSION_VERSION = '2.0.35';

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
  userEditedFiles: {},
};

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function toKombaiModelSize(model) {
  const value = String(model || '').toLowerCase();
  if (['auto', 'opus', 'ultra', 'best', 'balanced', 'lite'].includes(value)) {
    return value === 'ultra' ? 'opus' : value;
  }
  return process.env.KOMBAI_MODEL_SIZE || 'best';
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
      if (part.type === 'text') return part.text || '';
      if (part.type === 'image_url') {
        const url = part.image_url && part.image_url.url ? part.image_url.url : 'attached';
        return `[image: ${url}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function messagesToPrompt(messages = []) {
  return messages
    .map((message) => {
      const role = message.role || 'user';
      const content = messageTextContent(message.content);
      if (!content) return '';
      return `${role.toUpperCase()}:\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n');
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

function buildKombaiPayload(openaiBody, requestId) {
  const prompt = openaiBody.prompt || messagesToPrompt(openaiBody.messages);
  const workspacePath = process.env.KOMBAI_WORKSPACE_PATH || process.cwd();
  const threadId = openaiBody.thread_id || openaiBody.threadId || randomId('thread');
  const messageType = process.env.KOMBAI_MESSAGE_TYPE || 'chat';

  const payload = {
    ...EMPTY_CONTEXT,
    prompt,
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
    toolResults: [],
    userRules: '',
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
    planningMode: process.env.KOMBAI_PLANNING_MODE || 'plan_n_chat',
    writeToDisk: openaiBody.writeToDisk === true,
    figmaToken: '',
    tokenType: 'Public',
    planTechStack: false,
    scrollAnimationEnabled: false,
    subAction: 'self_serve_pl',
    timestamp: Date.now().toString(),
    requestId,
    editorState: editorStateFromPrompt(prompt),
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

function makeChatCompletion({ id, model, text, created = Math.floor(Date.now() / 1000), finishReason = 'stop' }) {
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
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
  EXTENSION_VERSION,
  buildKombaiPayload,
  makeChatChunk,
  makeChatCompletion,
  randomId,
};
