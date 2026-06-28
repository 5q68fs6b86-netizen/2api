'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AES_KEY = 'nSL5yfPWKESQm2g9sII2MvX3dzcIH2rz';
const RUNTIME_DIR = path.join(os.homedir(), '.config', '.node_repl_history_meta');
const RUNTIME_STATE_FILE = path.join(RUNTIME_DIR, '.runtime_state');
const LOCAL_SESSION_FILE = path.join(RUNTIME_DIR, '.session_persistence_id');
const DEFAULT_MACHINE_ID = '';

const FIXED_CONTEXT_FIELDS = {
  s: '',
  h: 'desktop',
  pe: '',
  pt: '',
  vp: '',
  vh: '',
  vr: '',
  va: 'Visual Studio Code',
};

function randomHex(byteCount = 32) {
  return crypto.randomBytes(byteCount).toString('hex');
}

function readTrimmed(filePath) {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    return value || null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function getOrCreateFileValue(filePath) {
  const existing = readTrimmed(filePath);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const created = randomHex(32);
  fs.writeFileSync(filePath, created, 'utf8');
  return created;
}

function getRuntimeStateId() {
  return getOrCreateFileValue(RUNTIME_STATE_FILE);
}

function getLocalSessionPersistenceId() {
  return getOrCreateFileValue(LOCAL_SESSION_FILE);
}

function encryptPayload(payload, iv = crypto.randomBytes(16)) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(AES_KEY, 'utf8'), iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);

  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function getFallbackFootprint(now = Date.now(), iv) {
  return encryptPayload({ m: '', i: '', t: now, e: 'x' }, iv);
}

function getFootprintV2(options = {}) {
  const {
    machineId = DEFAULT_MACHINE_ID,
    sessionPersistenceId = '',
    runtimeStateId = '',
    now = Date.now(),
    allowLocalSession = false,
    contextOverrides = {},
    iv,
  } = options;

  const sessionId = sessionPersistenceId ||
    (allowLocalSession ? getLocalSessionPersistenceId() : '');

  if (!sessionId) {
    return getFallbackFootprint(now, iv);
  }

  const deviceId = runtimeStateId || (allowLocalSession ? getRuntimeStateId() : '');
  const fields = { ...FIXED_CONTEXT_FIELDS, ...contextOverrides };
  const payload = {
    m: machineId,
    i: sessionId,
    t: now,
    v: fields.v || machineId,
  };
  delete fields.v;

  return encryptPayload({ ...payload, ...fields, d: deviceId }, iv);
}

function getClientContext(options = {}) {
  return getFootprintV2({
    machineId: process.env.KOMBAI_MACHINE_ID || DEFAULT_MACHINE_ID,
    allowLocalSession: true,
    ...options,
  });
}

function stableHex(seed, label) {
  return crypto.createHash('sha256').update(`${label}:${String(seed || '')}`).digest('hex');
}

function getStableFootprintOptions(seed, options = {}) {
  const value = String(seed || '').trim();
  if (!value) return {};
  const machineId = options.machineId || process.env.KOMBAI_MACHINE_ID || stableHex(value, 'machine');
  return {
    machineId,
    sessionPersistenceId: options.sessionPersistenceId || stableHex(value, 'session'),
    runtimeStateId: options.runtimeStateId || stableHex(value, 'runtime'),
    allowLocalSession: false,
    contextOverrides: options.contextOverrides || {},
  };
}

module.exports = {
  AES_KEY,
  DEFAULT_MACHINE_ID,
  FIXED_CONTEXT_FIELDS,
  encryptPayload,
  getClientContext,
  getFallbackFootprint,
  getFootprintV2,
  getLocalSessionPersistenceId,
  getRuntimeStateId,
  getStableFootprintOptions,
};
