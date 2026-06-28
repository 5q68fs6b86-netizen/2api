'use strict';

const DEFAULT_TABLE = 'twoapi_state';
const ACCOUNT_POOL_KEY = 'account-pool';

function shouldUseSsl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return parsed.searchParams.get('sslmode') === 'require' || parsed.hostname.endsWith('.neon.tech');
  } catch (_) {
    return false;
  }
}

function connectionStringForPg(connectionString) {
  if (!shouldUseSsl(connectionString)) return connectionString;
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get('sslmode') === 'require') {
      parsed.searchParams.delete('sslmode');
      return parsed.toString();
    }
  } catch (_) {
    // pg will report invalid connection strings.
  }
  return connectionString;
}

function quoteIdentifier(identifier) {
  const value = String(identifier || DEFAULT_TABLE);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`非法 PostgreSQL 表名: ${value}`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

class PostgresStateStore {
  constructor(options = {}) {
    this.connectionString = options.connectionString || process.env.DATABASE_URL || '';
    this.tableName = options.tableName || process.env.ACCOUNT_POOL_DB_TABLE || DEFAULT_TABLE;
    this.table = quoteIdentifier(this.tableName);
    this.pool = null;
    this.ready = false;
    this.saveQueue = Promise.resolve();
  }

  enabled() {
    return Boolean(this.connectionString);
  }

  status() {
    return {
      type: this.enabled() ? 'postgres' : 'file',
      ready: this.ready,
      table: this.enabled() ? this.tableName : '',
    };
  }

  async connect() {
    if (!this.enabled()) return false;
    if (this.pool) return true;

    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: connectionStringForPg(this.connectionString),
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ...(shouldUseSsl(this.connectionString) ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    this.ready = true;
    return true;
  }

  async load() {
    if (!await this.connect()) return null;
    const result = await this.pool.query(
      `SELECT value FROM ${this.table} WHERE key = $1`,
      [ACCOUNT_POOL_KEY],
    );
    return result.rows[0] ? result.rows[0].value : null;
  }

  async save(state) {
    if (!this.enabled()) return;
    const snapshot = JSON.parse(JSON.stringify(state));
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        await this.connect();
        await this.pool.query(
          `INSERT INTO ${this.table} (key, value, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [ACCOUNT_POOL_KEY, JSON.stringify(snapshot)],
        );
      });
    await this.saveQueue;
  }

  async close() {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
    this.ready = false;
  }
}

module.exports = {
  ACCOUNT_POOL_KEY,
  DEFAULT_TABLE,
  PostgresStateStore,
};
