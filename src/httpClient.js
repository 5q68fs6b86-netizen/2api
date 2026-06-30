'use strict';

const http = require('http');
const https = require('https');
const { createProxyAgent } = require('./proxyAgent');

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  addFromHeaders(setCookieHeaders = []) {
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of headers) {
      if (!header) continue;
      const pair = String(header).split(';', 1)[0];
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies.entries());
  }
}

function parseBody(body, contentType = '') {
  if (!body) return null;
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === 'https:' ? https : http;
    const body = options.body === undefined
      ? undefined
      : typeof options.body === 'string' || Buffer.isBuffer(options.body)
        ? options.body
        : ArrayBuffer.isView(options.body)
          ? Buffer.from(options.body.buffer, options.body.byteOffset, options.body.byteLength)
          : JSON.stringify(options.body);

    const headers = { ...(options.headers || {}) };
    if (body && !headers['Content-Length']) headers['Content-Length'] = Buffer.byteLength(body);

    const proxyUrl = options.proxy || options.proxyUrl || '';
    const req = mod.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 30000,
      ...(proxyUrl ? { agent: createProxyAgent(proxyUrl, url) } : {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          data: parseBody(text, String(res.headers['content-type'] || '')),
        });
      });
    });

    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  CookieJar,
  request,
};
