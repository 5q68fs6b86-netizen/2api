#!/usr/bin/env node
'use strict';

const { execFile } = require('child_process');
const {
  buildAuthConnectUrl,
  exchangeAuthCode,
  pollAuthCode,
  verifyApiKey,
} = require('../src/kombaiClient');

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

function openUrl(url) {
  const opener = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(opener, args, { stdio: 'ignore' }, () => {});
}

async function main() {
  const command = process.argv[2] || 'connect';

  if (command === 'url' || command === 'connect') {
    const auth = buildAuthConnectUrl({
      code: readArg('--code'),
      type: readArg('--type') || 'new',
      redirectUri: readArg('--redirect-uri'),
      from: readArg('--from'),
    });

    console.log(JSON.stringify(auth, null, 2));
    if (process.argv.includes('--open')) openUrl(auth.url);
    if (command === 'url') return;

    const result = await pollAuthCode(auth.code, {
      timeoutMs: readArg('--timeout-ms'),
      intervalMs: readArg('--interval-ms'),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'poll') {
    const code = readArg('--code');
    if (!code) throw new Error('--code 必填');
    const result = await pollAuthCode(code, {
      timeoutMs: readArg('--timeout-ms'),
      intervalMs: readArg('--interval-ms'),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'exchange') {
    const code = readArg('--code');
    if (!code) throw new Error('--code 必填');
    console.log(JSON.stringify(await exchangeAuthCode(code), null, 2));
    return;
  }

  if (command === 'verify') {
    const apiKey = readArg('--api-key') || process.env.KOMBAI_API_KEY;
    if (!apiKey) throw new Error('--api-key 或 KOMBAI_API_KEY 必填');
    console.log(JSON.stringify(await verifyApiKey(apiKey), null, 2));
    return;
  }

  throw new Error(`未知 auth 命令: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
