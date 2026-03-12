const { ShardingManager } = require('discord.js');
const path = require('path');
const config = require('./config.json');

const token = process.env.DISCORD_TOKEN || config.Token;
if (!token) {
  console.error('Missing token for sharding manager. Set DISCORD_TOKEN or config.Token');
  process.exit(1);
}

const manager = new ShardingManager(path.join(__dirname, 'index.js'), {
  token,
  totalShards: 'auto',
  respawn: true,
});

manager.on('shardCreate', (shard) => {
  console.log(`[ShardManager] Launched shard ${shard.id}`);
});

manager.spawn({ timeout: -1 }).catch((err) => {
  console.error('[ShardManager] spawn failed:', err);
  process.exit(1);
});
