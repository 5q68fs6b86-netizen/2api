#!/usr/bin/env node
'use strict';

const { registerAccount } = require('../src/kombaiAuth');

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const result = await registerAccount({
    authUrl: readArg('--auth-url'),
    email: readArg('--email'),
    emailPrefix: readArg('--email-prefix'),
    password: readArg('--password'),
    turnstileToken: readArg('--turnstile-token') || process.env.TURNSTILE_TOKEN,
    inviteToken: readArg('--invite-token'),
    waitForVerification: process.argv.includes('--wait-email'),
    login: !process.argv.includes('--no-login'),
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
