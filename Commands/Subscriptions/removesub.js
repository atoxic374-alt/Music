const { owners, emco } = require(`${process.cwd()}/config`);
const { EmbedBuilder, Client, GatewayIntentBits } = require('discord.js');
const storage = require('../../lib/storage');

module.exports = {
  name: 'removesub',
  aliases: ['remove'],
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const mention = message.mentions.members.first();
    if (!mention) return message.reply('**يرجي إرفاق منشن الشخص.**');

    const codeToRemove = args[1];
    if (!codeToRemove) return message.reply('**الرجاء تحديد ايدي الاشتراك الذي تريد إزالته.**');

    let removedTokens = [];
    try {
      let logsArray = await storage.getLogs();
      const matchingSubscriptions = logsArray.filter((entry) => entry.code === codeToRemove);
      if (matchingSubscriptions.length === 0) return message.reply('**لا يوجد اشتراكات مرتبطة بهذا الايدي.**');

      logsArray = logsArray.filter((entry) => entry.code !== codeToRemove);
      await storage.setLogs(logsArray);

      let tokensArray = await storage.getTokens();
      if (!Array.isArray(tokensArray)) tokensArray = [];
      const tokensToRemove = tokensArray.filter((tokenEntry) => matchingSubscriptions.some((subscription) => tokenEntry.code === subscription.code));
      tokensArray = tokensArray.filter((tokenEntry) => !tokensToRemove.includes(tokenEntry));

      let botsArray = await storage.getBots();
      if (!Array.isArray(botsArray)) botsArray = [];

      tokensToRemove.forEach((tokenEntry) => {
        botsArray.push({ token: tokenEntry.token, Server: null, channel: null, chat: null, status: null, client: null, useEmbeds: false });
        removedTokens.push(tokenEntry);
      });

      await storage.setBots(botsArray);
      await storage.setTokens(tokensArray);
      if (client.token) message.react('✅').catch(() => {});
    } catch (error) {
      console.error('❌>', error);
      message.reply('**حدث خطأ أثناء محاولة إزالة الاشتراك.**');
    }

    const numberOfBotsReset = removedTokens.length;
    setTimeout(async () => {
      removedTokens.forEach(async (token) => {
        try {
          const randomName = `Nova-${Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000}`;
          const botClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });
          await botClient.login(token.token);
          botClient.guilds.cache.forEach(async (guild) => { await guild.leave(); });
          await botClient.user.setAvatar('https://www.raed.net/img?id=756027');
          await botClient.user.setUsername(randomName);
          await botClient.destroy();
        } catch (error) {
          console.error(`حدث خطأ أثناء تشغيل التوكن: ${error}`);
        }
      });

      await mention.send({
        content: '> عزيزي العميل تم  انتهاء اشتراكك انظر الى التفاصيل ادناه:',
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: mention.user.username, iconURL: mention.user.displayAvatarURL({ dynamic: true, size: 1024, format: 'png' }) })
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
            .setDescription(`**الاشتراك : \`Music x${numberOfBotsReset}\` \`\nكود الاشتراك : \`${codeToRemove}\**`)
            .setFooter({ text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setColor(emco)
            .setTimestamp(),
        ],
      }).catch(() => {});

      const successEmbed = new EmbedBuilder()
        .setTitle('إستخدام ناجح ✅')
        .setColor(emco)
        .setDescription(`**تم إعادة تعيين \`\`${numberOfBotsReset}\`\` بوت وحفظهم في المخزن بنجاح!.**`);
      message.reply({ embeds: [successEmbed] });
    }, 0);
  },
};
