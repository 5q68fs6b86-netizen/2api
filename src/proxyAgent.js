'use strict';

const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

function normalizeProxyUrl(proxyUrl, defaultScheme = 'http') {
  const value = String(proxyUrl || '').trim();
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `${defaultScheme}://${value}`;
}

function createProxyAgent(proxyUrl, targetUrl = '') {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  const scheme = normalized.slice(0, normalized.indexOf(':')).toLowerCase();
  if (scheme === 'socks' || scheme === 'socks4' || scheme === 'socks4a' || scheme === 'socks5' || scheme === 'socks5h') {
    return new SocksProxyAgent(normalized);
  }

  if (scheme === 'http' || scheme === 'https') {
    const targetScheme = String(targetUrl || '').split(':', 1)[0].toLowerCase();
    if (targetScheme === 'http' || targetScheme === 'ws') return new HttpProxyAgent(normalized);
    return new HttpsProxyAgent(normalized);
  }

  throw new Error(`Unsupported proxy scheme: ${scheme}`);
}

module.exports = {
  createProxyAgent,
  normalizeProxyUrl,
};
