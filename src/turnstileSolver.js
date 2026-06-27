'use strict';

const { spawn } = require('child_process');
const path = require('path');

const SOLVER_SCRIPT = path.join(__dirname, '..', 'scripts', 'solve_turnstile.py');
const DEFAULT_TIMEOUT_MS = Number(process.env.TURNSTILE_TIMEOUT_MS || 90000);

/**
 * 调用 Python SeleniumBase 脚本求解 Turnstile
 *
 * @param {string} url - 注册页 URL
 * @param {object} [options]
 * @param {string} [options.proxy] - 代理地址
 * @param {number} [options.timeoutMs] - 超时毫秒数
 * @returns {Promise<{success: boolean, token?: string, cookies?: object, cf_clearance?: string, error?: string}>}
 */
function solveTurnstile(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const proxy = options.proxy || process.env.TURNSTILE_PROXY || '';

  const args = [SOLVER_SCRIPT, url, '-t', String(Math.floor(timeoutMs / 1000))];
  if (proxy) args.push('-p', proxy);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn('python3', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({ success: false, error: `Turnstile 求解超时 (${timeoutMs}ms)` });
      }
    }, timeoutMs + 5000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // 从 stdout 中提取最后一行 JSON
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1] || '';

      try {
        const result = JSON.parse(lastLine);
        resolve(result);
      } catch (_) {
        resolve({
          success: false,
          error: `解析输出失败 (code=${code}): ${lastLine.substring(0, 200)}${stderr ? '; stderr=' + stderr.substring(0, 200) : ''}`,
        });
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, error: `启动 solver 失败: ${err.message}` });
    });
  });
}

module.exports = { solveTurnstile };
