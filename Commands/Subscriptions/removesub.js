const fs = require('fs');
const { owners, prefix, emco, useEmbeds, Support} = require(`${process.cwd()}/config`);
const { EmbedBuilder, Client, GatewayIntentBits } = require('discord.js');

module.exports = {
  name: 'removesub',
  aliases: ["remove"],
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;

    if (message.author.bot) return;
    
    const mention = message.mentions.members.first();
    if (!mention) return message.reply("**يرجي إرفاق منشن الشخص.**");

    const codeToRemove = args[1];
    if (!codeToRemove) return message.reply("**الرجاء تحديد ايدي الاشتراك الذي تريد إزالته.**");

    let removedTokens = [];
    try {
      const logs = fs.readFileSync('./logs.json', 'utf8');
      const logsArray = JSON.parse(logs);

      const matchingSubscriptions = logsArray.filter(entry => entry.code === codeToRemove);

      if (matchingSubscriptions.length === 0) {
        return message.reply("**لا يوجد اشتراكات مرتبطة بهذا الايدي.**");
      }

      // حذف الاشتراك من ملف logs.json
      matchingSubscriptions.forEach(subscription => {
        logsArray.splice(logsArray.indexOf(subscription), 1);
      });

      // تحديث ملف logs.json بعد الإزالة
      fs.writeFileSync('./logs.json', JSON.stringify(logsArray, null, 2));

      // حذف التوكنات المرتبطة بالكود من ملف tokens.json
      const tokens = fs.readFileSync('./tokens.json', 'utf8');
      let tokensArray = JSON.parse(tokens);
      if (!Array.isArray(tokensArray)) {
        tokensArray = [];
      }

      const tokensToRemove = tokensArray.filter(tokenEntry => matchingSubscriptions.some(subscription => tokenEntry.code === subscription.code));
      tokensArray = tokensArray.filter(tokenEntry => !tokensToRemove.includes(tokenEntry));

      // إضافة التوكنات المحذوفة إلى ملف bots.json
      const bots = fs.readFileSync('./bots.json', 'utf8');
      let botsArray = JSON.parse(bots);
      if (!Array.isArray(botsArray)) {
        botsArray = [];
      }

      tokensToRemove.forEach(tokenEntry => {
        botsArray.push({
          token: tokenEntry.token,
          Server: null,
          channel: null,
          chat: null,
          status: null,
          client: null,
          useEmbeds: false
        });
        removedTokens.push(tokenEntry);
      });

      // تحديث ملف bots.json بعد الإضافة
      fs.writeFileSync('./bots.json', JSON.stringify(botsArray, null, 2));

      // تحديث ملف tokens.json بعد الإزالة
      fs.writeFileSync('./tokens.json', JSON.stringify(tokensArray, null, 2));

      // رد برد التأكيد
      if (client.token) message.react("✅").catch(() => {});
    } catch (error) {
      console.error('❌>', error);
      message.reply('**حدث خطأ أثناء محاولة إزالة الاشتراك.**');
    }

    // الجزء الجديد
    const numberOfBotsReset = removedTokens.length;

    // دالة setTimeout لتأخير تغيير التوكنات
    setTimeout(async () => {
      removedTokens.forEach(async (token) => {
        try {
          const randomName = `Nova-${Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000}`;
          const botClient = new Client({
            intents: [
              GatewayIntentBits.Guilds,
              GatewayIntentBits.GuildMembers,
              GatewayIntentBits.GuildMessages,
            ],
          });

          await botClient.login(token.token);

          botClient.guilds.cache.forEach(async (guild) => {
            await guild.leave();
          });

          await botClient.user.setAvatar('https://www.raed.net/img?id=756027');
          await botClient.user.setUsername(randomName);

          await botClient.destroy();
        } catch (error) {
          console.error(`حدث خطأ أثناء تشغيل التوكن: ${error}`);
        }
      });


      await mention.send({
        content: "> عزيزي العميل تم  انتهاء اشتراكك انظر الى التفاصيل ادناه:",
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: mention.user.username, iconURL: mention.user.displayAvatarURL({ dynamic: true, size: 1024, format: 'png' }) })
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
            .setDescription(`**الاشتراك : \`Music x${numberOfBotsReset}\` \`\nكود الاشتراك : \`${codeToRemove}\**`)
            .setFooter({ text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setColor(emco)
            .setTimestamp()
        ],
      }).catch(error => {
        console.error(`Failed to send message to ${mention.user.tag}:`, error);
      });

      // إرسال Embed بعد الانتهاء
      const successEmbed = new EmbedBuilder()
        .setTitle("إستخدام ناجح ✅")
        .setColor(emco)
        .setDescription(`**تم إعادة تعيين \`\`${numberOfBotsReset}\`\` بوت وحفظهم في المخزن بنجاح!.**`);
      message.reply({ embeds: [successEmbed] });
    }, 0);  // يمكنك ضبط القيمة إلى الوقت الذي تشاء لتأخير التنفيذ
  }
};