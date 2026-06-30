'use strict';

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function normalizeId(value) {
  const text = String(value || '').trim();
  return text || '';
}

function toolCallIdsFromMessage(message) {
  const ids = [];
  if (!message || typeof message !== 'object') return ids;

  const directId = normalizeId(message.tool_call_id || message.toolUseId);
  if (directId) ids.push(directId);

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      const id = normalizeId(toolCall && toolCall.id);
      if (id) ids.push(id);
    }
  }

  if (!Array.isArray(message.content)) return ids;
  for (const part of message.content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'tool_use') {
      const id = normalizeId(part.id);
      if (id) ids.push(id);
      continue;
    }
    if (part.type === 'tool_result') {
      const id = normalizeId(part.tool_use_id || part.toolUseId || part.id);
      if (id) ids.push(id);
    }
  }

  return ids;
}

class ThreadStore {
  constructor(options = {}) {
    this.maxEntries = Number(options.maxEntries) || DEFAULT_MAX_ENTRIES;
    this.ttlMs = Number(options.ttlMs) || DEFAULT_TTL_MS;
    this.toolCallToThread = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [toolCallId, entry] of this.toolCallToThread.entries()) {
      if (!entry || !entry.threadId || (now - entry.updatedAt) > this.ttlMs) {
        this.toolCallToThread.delete(toolCallId);
      }
    }

    while (this.toolCallToThread.size > this.maxEntries) {
      const oldest = this.toolCallToThread.keys().next();
      if (oldest.done) break;
      this.toolCallToThread.delete(oldest.value);
    }
  }

  rememberToolCalls(threadId, toolCalls = []) {
    const normalizedThreadId = normalizeId(threadId);
    if (!normalizedThreadId || !Array.isArray(toolCalls) || toolCalls.length === 0) return;

    const now = Date.now();
    for (const toolCall of toolCalls) {
      const toolCallId = normalizeId(toolCall && toolCall.id);
      if (!toolCallId) continue;
      this.toolCallToThread.set(toolCallId, {
        threadId: normalizedThreadId,
        updatedAt: now,
      });
    }
    this.cleanup(now);
  }

  inferThreadId(messages = []) {
    this.cleanup();

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const ids = toolCallIdsFromMessage(messages[index]);
      for (let idIndex = ids.length - 1; idIndex >= 0; idIndex -= 1) {
        const entry = this.toolCallToThread.get(ids[idIndex]);
        if (entry && entry.threadId) return entry.threadId;
      }
    }

    return '';
  }
}

module.exports = {
  ThreadStore,
};
