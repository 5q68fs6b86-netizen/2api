#!/usr/bin/env node
'use strict';

const { completeChat, streamChatCompletion } = require('../src/kombaiClient');

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const apiKey = readArg('--api-key') || process.env.KOMBAI_API_KEY;
  if (!apiKey) throw new Error('--api-key 或 KOMBAI_API_KEY 必填');

  const prompt = readArg('--prompt') || process.argv.slice(2).filter((arg) => !arg.startsWith('--')).join(' ') || 'Say hello.';
  const model = readArg('--model') || process.env.OPENAI_MODEL_NAME || 'kombai-chat';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: process.argv.includes('--stream'),
  };

  if (body.stream) {
    for await (const event of streamChatCompletion(body, apiKey)) {
      if (event.type === 'text') process.stdout.write(event.text);
    }
    process.stdout.write('\n');
    return;
  }

  const text = await completeChat(body, apiKey);
  console.log(text);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
