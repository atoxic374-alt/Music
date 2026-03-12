const { owners } = require(`${process.cwd()}/config`);
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const storage = require('../../lib/storage');

module.exports = {
  name: 'removebots',
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const targetId = args[0];
    if (!targetId) return message.reply('**يرجى إرفاق إيدي الشخص أو السيرفر.**');

    let tokens = await storage.getTokens();
    if (!Array.isArray(tokens)) tokens = [];

    const removedTokens = tokens.filter((token) => token.Server === targetId || token.client === targetId);
    tokens = tokens.filter((token) => !(token.Server === targetId || token.client === targetId));

    removedTokens.forEach((token) => {
      token.Server = null;
      token.channel = null;
      token.chat = null;
      token.status = null;
      token.client = null;
      token.useEmbeds = false;
    });

    let bots = await storage.getBots();
    if (!Array.isArray(bots)) bots = [];
    bots = bots.concat(removedTokens);

    await storage.setTokens(tokens);
    await storage.setBots(bots);

    const numberOfBotsReset = removedTokens.length;
    setTimeout(async () => {
      removedTokens.forEach(async (token) => {
        try {
          const randomName = `ceent-${Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000}`;
          const botClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });
          await botClient.login(token.token);
          botClient.guilds.cache.forEach(async (guild) => { await guild.leave(); });
          await botClient.user.setAvatar('https://www.raed.net/img?id=756036');
          await botClient.user.setUsername(randomName);
          await botClient.destroy();
        } catch (error) {
          console.error(`حدث خطأ أثناء تشغيل التوكن: ${error}`);
        }
      });

      const successEmbed = new EmbedBuilder()
        .setTitle('إستخدام ناجح ✅')
        .setDescription(`**تم إعادة تعيين \`\`${numberOfBotsReset}\`\` بوت وحفظهم في المخزن بنجاح!.**`);
      message.reply({ embeds: [successEmbed] });
    }, 0);
  },
};
