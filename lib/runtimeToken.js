const config = require('../config.json');

function getRuntimeToken() {
  return process.env.DISCORD_TOKEN || config.Token || '';
}

module.exports = { getRuntimeToken };
