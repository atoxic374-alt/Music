const { owners } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');
const storage = require('../../lib/storage');

module.exports = {
  name: 'bots',
  run: async (client, message) => {
    if (!owners.includes(message.author.id)) return;

    const tokens = await storage.getTokens();
    const embed = new EmbedBuilder().setTitle('Bots info');

    const displayedServerIds = new Set();
    const displayedBotClientIds = new Set();

    (Array.isArray(tokens) ? tokens : []).forEach((tokenData) => {
      const { Server, client: botClientId } = tokenData;
      if (Server && botClientId && !displayedServerIds.has(Server) && !displayedBotClientIds.has(botClientId)) {
        const botCountInServer = tokens.filter((t) => t.Server === Server).length;
        embed.addFields({ name: `Server ID: \`${Server}\``, value: `**Client ID: \`${botClientId}\`\nClient Name:  \`(\` <@${botClientId}> \`)\`\nTotal Bots: \`${botCountInServer}\`**` });
        displayedServerIds.add(Server);
        displayedBotClientIds.add(botClientId);
      }
    });

    message.channel.send({ embeds: [embed] });
  },
};
