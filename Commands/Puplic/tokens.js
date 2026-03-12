const { owners, emco } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');
const storage = require('../../lib/storage');

module.exports = {
  name: 'tokens',
  run: async (client, message) => {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const bots = await storage.getBots();
    const tokens = await storage.getTokens();

    const embed = new EmbedBuilder()
      .setTitle('Token Status')
      .setColor(emco)
      .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
      .setDescription(`Total Tokens By Ahmed ( \`${(bots || []).length}\` <🔴)\nTotal Tokens Running ( \`${(tokens || []).length}\` <🟢) `);

    message.reply({ embeds: [embed] });
  },
};
