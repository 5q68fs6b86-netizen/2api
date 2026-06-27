#!/usr/bin/env node
'use strict';

const { registerAccount } = require('../src/kombaiAuth');

async function main() {
  const result = await registerAccount({
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
