const fs = require('fs/promises');

const config = require('../../config.json');
const provider = (process.env.STORAGE_PROVIDER || config?.storage?.provider || '').trim().toLowerCase();
const redisUrl = process.env.REDIS_URL || config?.storage?.redisUrl || '';
const pgUrl = process.env.POSTGRES_URL || config?.storage?.postgresUrl || '';

const FILES = {
  tokens: './tokens.json',
  bots: './bots.json',
  logs: './logs.json',
};

const cacheTtlMs = Number(config?.performance?.storageCacheTtlMs ?? 2000);
const localCache = new Map();
const localLocks = new Map();

function cacheGet(key) {
  const row = localCache.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    localCache.delete(key);
    return null;
  }
  return row.value;
}

function cacheSet(key, value) {
  if (cacheTtlMs <= 0) return;
  localCache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
}

function cacheDel(key) {
  localCache.delete(key);
}

async function ensureArray(val) {
  return Array.isArray(val) ? val : [];
}

async function readJsonFile(path) {
  try {
    const raw = await fs.readFile(path, 'utf8');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return ensureArray(parsed);
  } catch {
    return [];
  }
}

async function writeJsonFile(path, data) {
  const payload = JSON.stringify(Array.isArray(data) ? data : [], null, 2);
  await fs.writeFile(path, payload, 'utf8');
}

let redisClient = null;
async function getRedis() {
  if (redisClient) return redisClient;
  const { createClient } = require('redis');
  redisClient = createClient({ url: redisUrl || undefined });
  redisClient.on('error', () => {});
  await redisClient.connect();
  return redisClient;
}

let pgClient = null;
async function getPg() {
  if (pgClient) return pgClient;
  const { Client } = require('pg');
  pgClient = new Client({ connectionString: pgUrl || undefined });
  await pgClient.connect();
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS by_ahmed_data (
      by_ahmed_key TEXT PRIMARY KEY,
      by_ahmed_value JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  return pgClient;
}

async function acquireLock(name, ttlMs = 15000) {
  const lockKey = `music:lock:${name}`;
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  if (provider === 'redis') {
    try {
      const c = await getRedis();
      const ok = await c.set(lockKey, owner, { NX: true, PX: ttlMs });
      if (ok !== 'OK') return null;
      return {
        owner,
        async release() {
          try {
            const current = await c.get(lockKey);
            if (current === owner) await c.del(lockKey);
          } catch {}
        },
      };
    } catch {
      return null;
    }
  }

  const now = Date.now();
  const existing = localLocks.get(lockKey);
  if (existing && existing.expiresAt > now) return null;
  localLocks.set(lockKey, { owner, expiresAt: now + ttlMs });

  return {
    owner,
    async release() {
      const current = localLocks.get(lockKey);
      if (current?.owner === owner) localLocks.delete(lockKey);
    },
  };
}

async function readByAhmed(key) {
  const cached = cacheGet(key);
  if (cached) return cached;

  let data;
  if (provider === 'redis') {
    const c = await getRedis();
    const raw = await c.get(`music:${key}`);
    if (!raw) data = [];
    else {
      try { data = await ensureArray(JSON.parse(raw)); } catch { data = []; }
    }
  } else if (provider === 'postgres' || provider === 'postgresql' || provider === 'pg') {
    const c = await getPg();
    const res = await c.query('SELECT by_ahmed_value FROM by_ahmed_data WHERE by_ahmed_key = $1 LIMIT 1', [key]);
    data = res.rows[0] ? await ensureArray(res.rows[0].by_ahmed_value) : [];
  } else {
    data = await readJsonFile(FILES[key]);
  }

  cacheSet(key, data);
  return data;
}

async function writeByAhmed(key, value) {
  const arr = Array.isArray(value) ? value : [];

  if (provider === 'redis') {
    const c = await getRedis();
    await c.set(`music:${key}`, JSON.stringify(arr));
  } else if (provider === 'postgres' || provider === 'postgresql' || provider === 'pg') {
    const c = await getPg();
    await c.query(
      `INSERT INTO by_ahmed_data (by_ahmed_key, by_ahmed_value) VALUES ($1, $2::jsonb)
       ON CONFLICT (by_ahmed_key) DO UPDATE SET by_ahmed_value = EXCLUDED.by_ahmed_value, updated_at = NOW()`,
      [key, JSON.stringify(arr)]
    );
  } else {
    await writeJsonFile(FILES[key], arr);
  }

  cacheDel(key);
  cacheSet(key, arr);
}

module.exports = {
  provider: provider || 'json',
  getTokens: () => readByAhmed('tokens'),
  setTokens: (v) => writeByAhmed('tokens', v),
  getBots: () => readByAhmed('bots'),
  setBots: (v) => writeByAhmed('bots', v),
  getLogs: () => readByAhmed('logs'),
  setLogs: (v) => writeByAhmed('logs', v),
  acquireLock,
};
