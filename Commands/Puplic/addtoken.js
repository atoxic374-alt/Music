const { owners } = require(`${process.cwd()}/config`);
const { Client, GatewayIntentBits } = require('discord.js');
const storage = require('../../lib/storage');

module.exports = {
  name: 'addtoken',
  run: async (client, message) => {
    if (!owners.includes(message.author.id)) return;

    const botIntents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
    if (message.author.bot) return;

    const args = message.content.split(' ');
    args.shift();
    const tokenValues = args;
    if (tokenValues.length === 0) return message.reply('**يرجى إرفاق التوكن بعد الامر.**');

    const validTokens = [];
    for (const tokenValue of tokenValues) {
      const validator = new Client({ intents: botIntents });
      try {
        await validator.login(tokenValue);
        validTokens.push(tokenValue);
      } catch (error) {
        message.reply(`**❌ it's no use >** \`${tokenValue}\``).catch(() => {});
      } finally {
        try { await validator.destroy(); } catch {}
      }
    }

    if (!validTokens.length) return;
    if (client.token) message.react('✅').catch(() => {});

    let bots = await storage.getBots();
    if (!Array.isArray(bots)) bots = [];

    for (const tokenValue of validTokens) {
      const tokenExists = bots.some((bot) => bot.token === tokenValue);
      if (!tokenExists) {
        bots.push({ token: tokenValue, Server: null, channel: null, chat: null, status: null, client: null, useEmbeds: false });
      }
    }
    await storage.setBots(bots);

    function generateRandomNumber() {
      return Math.floor(1000 + Math.random() * 9000);
    }

    setTimeout(async () => {
      for (const tokenValue of validTokens) {
        try {
          const botClient = new Client({ intents: botIntents });
          await botClient.login(tokenValue);
          const randomNumber = generateRandomNumber();
          await botClient.user.setUsername(`Nova-${randomNumber}`);
          await botClient.user.setAvatar('https://cdn.discordapp.com/attachments/1236436781390495894/1243265862064930876/YiwCyvs.png?ex=6650d910&is=664f8790&hm=b59fe69e79d42e8bcdaffd1d687a218301a64fa81915ab74affad8533307e827&');
          await botClient.destroy();
        } catch (avatarError) {
          console.error('❌>', avatarError?.message || avatarError);
        }
      }
    }, 5000);
  },
};
