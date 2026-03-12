const storage = require('../lib/storage');
const fs = require('fs/promises');

async function read(path) {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}

(async () => {
  const tokens = await read('./tokens.json');
  const bots = await read('./bots.json');
  const logs = await read('./logs.json');

  await storage.setTokens(Array.isArray(tokens) ? tokens : []);
  await storage.setBots(Array.isArray(bots) ? bots : []);
  await storage.setLogs(Array.isArray(logs) ? logs : []);

  console.log('JSON storage is active. Data files were normalized successfully.');
})();
