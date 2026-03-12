const fs = require('fs/promises');

const config = require('../../config.json');
const provider = 'json';

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

async function acquireLock(name, ttlMs = 15000) {
  const lockKey = `music:lock:${name}`;
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

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

  const data = await readJsonFile(FILES[key]);

  cacheSet(key, data);
  return data;
}

async function writeByAhmed(key, value) {
  const arr = Array.isArray(value) ? value : [];
  await writeJsonFile(FILES[key], arr);

  cacheDel(key);
  cacheSet(key, arr);
}

module.exports = {
  provider,
  getTokens: () => readByAhmed('tokens'),
  setTokens: (v) => writeByAhmed('tokens', v),
  getBots: () => readByAhmed('bots'),
  setBots: (v) => writeByAhmed('bots', v),
  getLogs: () => readByAhmed('logs'),
  setLogs: (v) => writeByAhmed('logs', v),
  acquireLock,
};
