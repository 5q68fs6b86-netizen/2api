'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeProxyUrl } = require('./proxyAgent');
const { getStableFootprintOptions } = require('./footprint');
const { PostgresStateStore } = require('./postgresStateStore');

const DEFAULT_POOL_SIZE = 5;
const DEFAULT_STATE = {
  version: 1,
  config: {
    desiredPoolSize: DEFAULT_POOL_SIZE,
    randomProxy: true,
    failoverEnabled: true,
  },
  accounts: [],
  proxies: [],
};

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function makeId(prefix) {
  if (typeof crypto.randomUUID === 'function') return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 12) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function splitList(value) {
  return String(value || '')
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferProxyRegion(rawProxy) {
  const raw = String(rawProxy || '').trim();
  const prefixedRegion = raw.match(/^([A-Za-z]{2,5}):[^/].*@/);
  if (prefixedRegion) return prefixedRegion[1].toUpperCase();

  try {
    const parsed = new URL(normalizeProxyUrl(raw));
    if (parsed.username && /^[A-Za-z]{2,5}$/.test(parsed.username)) return parsed.username.toUpperCase();
  } catch (_) {
    // best effort
  }
  return '';
}

function maskProxy(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  try {
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password) {
      const auth = `${parsed.username || ''}${parsed.password ? ':***' : ''}@`;
      return `${parsed.protocol}//${auth}${parsed.host}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return maskSecret(proxyUrl);
  }
}

function sanitizeConfig(input, current = DEFAULT_STATE.config) {
  const desiredPoolSize = Number(input.desiredPoolSize ?? current.desiredPoolSize ?? DEFAULT_POOL_SIZE);
  return {
    desiredPoolSize: Number.isFinite(desiredPoolSize) ? Math.max(1, Math.min(100, Math.floor(desiredPoolSize))) : DEFAULT_POOL_SIZE,
    randomProxy: input.randomProxy === undefined ? current.randomProxy !== false : input.randomProxy !== false,
    failoverEnabled: input.failoverEnabled === undefined ? current.failoverEnabled !== false : input.failoverEnabled !== false,
  };
}

function normalizeState(parsed = {}, fallbackConfig = DEFAULT_STATE.config) {
  return {
    ...DEFAULT_STATE,
    ...parsed,
    config: sanitizeConfig(parsed.config || {}, fallbackConfig),
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    proxies: Array.isArray(parsed.proxies) ? parsed.proxies : [],
  };
}

function makeAccount({ apiKey, label = '', source = 'stored', enabled = true, id, footprintSeed = '' }) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('apiKey 必填');
  return {
    id: id || makeId('acct'),
    label: String(label || '').trim(),
    apiKey: key,
    keyHash: shortHash(key),
    enabled: enabled !== false,
    source,
    footprintSeed: String(footprintSeed || '').trim(),
    status: 'unknown',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
    lastErrorAt: null,
    lastError: '',
    successCount: 0,
    failCount: 0,
  };
}

function accountFootprint(account) {
  return getStableFootprintOptions(account.footprintSeed || account.apiKey || account.keyHash || account.id);
}

function isKnownUnusableAccount(account) {
  if (!account || account.enabled === false) return true;
  const message = String(account.lastError || '').toLowerCase();
  return [
    'footprintblocked=true',
    'too many accounts',
    'remainingcredits=0',
    '账号不可用',
  ].some((needle) => message.includes(needle));
}

function makeProxy({ uri, label = '', region = '', source = 'stored', enabled = true, id }) {
  const normalized = normalizeProxyUrl(uri);
  if (!normalized) throw new Error('proxy uri 必填');
  return {
    id: id || makeId('proxy'),
    label: String(label || '').trim(),
    uri: normalized,
    region: String(region || inferProxyRegion(normalized)).trim().toUpperCase(),
    enabled: enabled !== false,
    source,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
    lastErrorAt: null,
    lastError: '',
    successCount: 0,
    failCount: 0,
  };
}

class AccountPool {
  constructor(options = {}) {
    this.dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.statePath = options.statePath || process.env.ACCOUNT_POOL_FILE || path.join(this.dataDir, 'account-pool.json');
    this.store = options.store || new PostgresStateStore();
    this.state = this.load();
    this.proxyCursor = 0;
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return normalizeState(parsed, DEFAULT_STATE.config);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`读取号池配置失败，将使用默认配置: ${error.message}`);
      }
      return {
        ...DEFAULT_STATE,
        config: sanitizeConfig({ desiredPoolSize: process.env.ACCOUNT_POOL_SIZE }, DEFAULT_STATE.config),
      };
    }
  }

  async init() {
    if (!this.store || !this.store.enabled()) return;
    try {
      const stored = await this.store.load();
      if (stored) {
        this.state = normalizeState(stored, this.state.config);
        this.saveLocal();
        console.log('[account-pool] loaded state from PostgreSQL');
        return;
      }
      await this.store.save(this.state);
      console.log('[account-pool] initialized PostgreSQL state from local file');
    } catch (error) {
      console.error(`[account-pool] PostgreSQL storage unavailable, using local file: ${error.message}`);
    }
  }

  saveLocal() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  save() {
    this.saveLocal();
    if (this.store && this.store.enabled()) {
      this.store.save(this.state).catch((error) => {
        console.error(`[account-pool] 保存 PostgreSQL 状态失败: ${error.message}`);
      });
    }
  }

  envAccounts() {
    const keys = [...splitList(process.env.KOMBAI_API_KEYS), ...splitList(process.env.KOMBAI_API_KEY)];
    const seen = new Set();
    return keys
      .filter((apiKey) => {
        const hash = shortHash(apiKey);
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      })
      .map((apiKey, index) => makeAccount({
        id: `env_acct_${shortHash(apiKey)}`,
        label: `ENV ${index + 1}`,
        apiKey,
        source: 'env',
      }));
  }

  envProxies() {
    const proxies = splitList(process.env.PROXY_LIST || process.env.KOMBAI_PROXIES);
    const seen = new Set();
    return proxies
      .filter((uri) => {
        const normalized = normalizeProxyUrl(uri);
        const hash = shortHash(normalized);
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      })
      .map((uri, index) => makeProxy({
        id: `env_proxy_${shortHash(normalizeProxyUrl(uri))}`,
        label: `ENV proxy ${index + 1}`,
        uri,
        source: 'env',
      }));
  }

  allAccounts({ includeSecrets = false } = {}) {
    const storedHashes = new Set(this.state.accounts.map((account) => account.keyHash));
    const accounts = [
      ...this.state.accounts,
      ...this.envAccounts().filter((account) => !storedHashes.has(account.keyHash)),
    ];
    return includeSecrets ? accounts : accounts.map((account) => this.publicAccount(account));
  }

  allProxies({ includeSecrets = false } = {}) {
    const storedUris = new Set(this.state.proxies.map((proxy) => proxy.uri));
    const proxies = [
      ...this.state.proxies,
      ...this.envProxies().filter((proxy) => !storedUris.has(proxy.uri)),
    ];
    return includeSecrets ? proxies : proxies.map((proxy) => this.publicProxy(proxy));
  }

  publicAccount(account) {
    return {
      id: account.id,
      label: account.label,
      enabled: account.enabled !== false,
      source: account.source || 'stored',
      status: account.status || 'unknown',
      apiKey: maskSecret(account.apiKey),
      keyHash: account.keyHash,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastUsedAt: account.lastUsedAt,
      lastErrorAt: account.lastErrorAt,
      lastError: account.lastError || '',
      successCount: account.successCount || 0,
      failCount: account.failCount || 0,
    };
  }

  publicProxy(proxy) {
    return {
      id: proxy.id,
      label: proxy.label,
      region: proxy.region || '',
      enabled: proxy.enabled !== false,
      source: proxy.source || 'stored',
      uri: maskProxy(proxy.uri),
      createdAt: proxy.createdAt,
      updatedAt: proxy.updatedAt,
      lastUsedAt: proxy.lastUsedAt,
      lastErrorAt: proxy.lastErrorAt,
      lastError: proxy.lastError || '',
      successCount: proxy.successCount || 0,
      failCount: proxy.failCount || 0,
    };
  }

  getState() {
    const accounts = this.allAccounts();
    const activeAccounts = accounts.filter((account) => account.enabled && !isKnownUnusableAccount(account)).length;
    return {
      config: this.state.config,
      storage: this.store ? this.store.status() : { type: 'file', ready: true, table: '' },
      pool: {
        desiredPoolSize: this.state.config.desiredPoolSize,
        activeAccounts,
        unusableAccounts: accounts.filter((account) => account.enabled && isKnownUnusableAccount(account)).length,
        missingAccounts: Math.max(0, this.state.config.desiredPoolSize - activeAccounts),
        autoCreateSupported: true,
        note: '支持自动注册：使用 POST /admin/api/auto-register 自动注册一个账号，或 POST /admin/api/auto-fill 填充号池。',
      },
      accounts,
      proxies: this.allProxies(),
    };
  }

  updateConfig(patch) {
    this.state.config = sanitizeConfig(patch || {}, this.state.config);
    this.save();
    return this.getState();
  }

  addAccount(input) {
    const account = makeAccount(input || {});
    if (this.state.accounts.some((item) => item.keyHash === account.keyHash)) {
      throw new Error('该 API key 已存在');
    }
    this.state.accounts.push(account);
    this.save();
    return this.publicAccount(account);
  }

  updateAccount(id, patch = {}) {
    const account = this.state.accounts.find((item) => item.id === id);
    if (!account) throw new Error('账号不存在或来自环境变量，不能修改');
    if (patch.label !== undefined) account.label = String(patch.label || '').trim();
    if (patch.enabled !== undefined) account.enabled = patch.enabled !== false;
    account.updatedAt = nowIso();
    this.save();
    return this.publicAccount(account);
  }

  removeAccount(id) {
    const before = this.state.accounts.length;
    this.state.accounts = this.state.accounts.filter((item) => item.id !== id);
    if (this.state.accounts.length === before) throw new Error('账号不存在或来自环境变量，不能删除');
    this.save();
    return this.getState();
  }

  addProxy(input) {
    const proxy = makeProxy(input || {});
    if (this.state.proxies.some((item) => item.uri === proxy.uri)) {
      throw new Error('该代理已存在');
    }
    this.state.proxies.push(proxy);
    this.save();
    return this.publicProxy(proxy);
  }

  updateProxy(id, patch = {}) {
    const proxy = this.state.proxies.find((item) => item.id === id);
    if (!proxy) throw new Error('代理不存在或来自环境变量，不能修改');
    if (patch.label !== undefined) proxy.label = String(patch.label || '').trim();
    if (patch.region !== undefined) proxy.region = String(patch.region || '').trim().toUpperCase();
    if (patch.enabled !== undefined) proxy.enabled = patch.enabled !== false;
    proxy.updatedAt = nowIso();
    this.save();
    return this.publicProxy(proxy);
  }

  removeProxy(id) {
    const before = this.state.proxies.length;
    this.state.proxies = this.state.proxies.filter((item) => item.id !== id);
    if (this.state.proxies.length === before) throw new Error('代理不存在或来自环境变量，不能删除');
    this.save();
    return this.getState();
  }

  accountAttempts(directApiKey = '') {
    if (directApiKey) {
      return [{
        source: 'request',
        accountId: null,
        label: 'request bearer',
        apiKey: directApiKey,
        footprint: getStableFootprintOptions(directApiKey),
      }];
    }

    const enabledAccounts = this.allAccounts({ includeSecrets: true }).filter((account) => account.enabled !== false);
    const usableAccounts = enabledAccounts.filter((account) => !isKnownUnusableAccount(account));
    const accounts = usableAccounts.length > 0 ? usableAccounts : enabledAccounts;
    return accounts.map((account) => ({
      source: account.source || 'stored',
      accountId: account.id,
      label: account.label || maskSecret(account.apiKey),
      apiKey: account.apiKey,
      footprint: accountFootprint(account),
    }));
  }

  pickProxy() {
    const proxies = this.allProxies({ includeSecrets: true }).filter((proxy) => proxy.enabled !== false);
    if (proxies.length === 0) return null;

    if (this.state.config.randomProxy !== false) {
      return proxies[Math.floor(Math.random() * proxies.length)];
    }

    const proxy = proxies[this.proxyCursor % proxies.length];
    this.proxyCursor += 1;
    return proxy;
  }

  findStoredAccount(id) {
    return this.state.accounts.find((account) => account.id === id);
  }

  findStoredProxy(id) {
    return this.state.proxies.find((proxy) => proxy.id === id);
  }

  recordSuccess(context = {}) {
    const at = nowIso();
    const account = this.findStoredAccount(context.accountId);
    if (account) {
      account.status = 'ok';
      account.lastUsedAt = at;
      account.lastError = '';
      account.successCount = (account.successCount || 0) + 1;
      account.updatedAt = at;
    }

    const proxy = context.proxy && this.findStoredProxy(context.proxy.id);
    if (proxy) {
      proxy.lastUsedAt = at;
      proxy.lastError = '';
      proxy.successCount = (proxy.successCount || 0) + 1;
      proxy.updatedAt = at;
    }

    if (account || proxy) this.save();
  }

  recordFailure(context = {}, error) {
    const at = nowIso();
    const message = error && error.message ? error.message : String(error || 'unknown error');
    const account = this.findStoredAccount(context.accountId);
    if (account) {
      account.status = 'error';
      account.lastUsedAt = at;
      account.lastErrorAt = at;
      account.lastError = message.slice(0, 500);
      account.failCount = (account.failCount || 0) + 1;
      account.updatedAt = at;
    }

    const proxy = context.proxy && this.findStoredProxy(context.proxy.id);
    if (proxy) {
      proxy.lastUsedAt = at;
      proxy.lastErrorAt = at;
      proxy.lastError = message.slice(0, 500);
      proxy.failCount = (proxy.failCount || 0) + 1;
      proxy.updatedAt = at;
    }

    if (account || proxy) this.save();
  }
}

function isRetryableAccountError(error) {
  const status = error && (error.statusCode || error.status);
  if ([401, 403, 429].includes(Number(status))) return true;

  const message = `${error && error.message ? error.message : error}`.toLowerCase();
  return [
    'credit',
    'balance',
    'quota',
    'insufficient',
    'forbidden',
    'unauthorized',
    'timeout',
    'socket',
    'econn',
    'unknown error',
    'footprintblocked',
    'too many accounts',
    '账号不可用',
    '403',
    '429',
  ].some((needle) => message.includes(needle));
}

module.exports = {
  AccountPool,
  isRetryableAccountError,
  maskSecret,
  maskProxy,
};
