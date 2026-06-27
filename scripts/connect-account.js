#!/usr/bin/env node
'use strict';

const { execFile } = require('child_process');
const {
  buildAuthConnectUrl,
  pollAuthCode,
  verifyApiKey,
} = require('../src/kombaiClient');
const { AccountPool } = require('../src/accountPool');

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

function boolArg(name, defaultValue = false) {
  if (process.argv.includes(name)) return true;
  if (process.argv.includes(`--no-${name.slice(2)}`)) return false;
  return defaultValue;
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

function extractApiKeyToken(data) {
  if (!data || typeof data !== 'object') return '';
  return data.apiKeyToken
    || data.apiKey
    || data.token
    || (data.data && extractApiKeyToken(data.data))
    || '';
}

function usage() {
  console.log(`用法:
  npm run connect-account -- [选项]

选项:
  --label <name>          保存到号池的账号标签
  --code <code>           使用指定授权 code
  --type <new|login>      授权类型，默认 new
  --timeout-ms <ms>       轮询超时，默认 900000
  --interval-ms <ms>      轮询间隔，默认 2000
  --open                  自动尝试打开浏览器
  --no-verify             保存前不调用 verifyApiKey

说明:
  该脚本生成 Kombai 官方 vscode-connect 授权链接，等待浏览器完成注册/登录后，
  自动轮询 apiKeyToken 并写入本项目号池。`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const label = readArg('--label') || 'connected account';
  const auth = buildAuthConnectUrl({
    code: readArg('--code'),
    type: readArg('--type') || 'new',
    redirectUri: readArg('--redirect-uri'),
    from: readArg('--from'),
  });

  console.log('授权链接已生成。请在浏览器完成 Kombai 官方注册/登录/验证：');
  console.log(auth.url);
  console.log('');
  console.log(`授权 code: ${auth.code}`);
  console.log('等待授权完成，按 Ctrl+C 可取消。');

  if (boolArg('--open')) openUrl(auth.url);

  const result = await pollAuthCode(auth.code, {
    timeoutMs: readArg('--timeout-ms') || 15 * 60 * 1000,
    intervalMs: readArg('--interval-ms') || 2000,
  });

  const apiKey = extractApiKeyToken(result);
  if (!apiKey) {
    const error = new Error('授权响应里没有 apiKeyToken，无法写入号池');
    error.data = result;
    throw error;
  }

  if (!process.argv.includes('--no-verify')) {
    await verifyApiKey(apiKey);
  }

  const pool = new AccountPool();
  const account = pool.addAccount({ apiKey, label });
  console.log('');
  console.log('账号已写入号池：');
  console.log(JSON.stringify(account, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  if (error.data) console.error(JSON.stringify(error.data, null, 2));
  process.exit(1);
});
