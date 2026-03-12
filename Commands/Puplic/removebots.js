const fs = require('fs');
const { owners, prefix } = require(`${process.cwd()}/config`);
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'removebots',
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;

    if (message.author.bot) return;

    const targetId = args[0];
    if (!targetId) return message.reply("**يرجى إرفاق إيدي الشخص أو السيرفر.**");

    // تحميل التوكنات من ملف tokens.json
    let tokens = [];
    try {
      const tokensData = fs.readFileSync('./tokens.json', 'utf8');
      tokens = JSON.parse(tokensData);
      if (!Array.isArray(tokens)) {
        tokens = [];
      }
    } catch (error) {
      console.error('حدث خطأ أثناء قراءة الملف tokens.json:', error);
    }

    // حذف التوكنات من المصفوفة
    const removedTokens = tokens.filter(token => token.Server === targetId || token.client === targetId);
    tokens = tokens.filter(token => !(token.Server === targetId || token.client === targetId));

    removedTokens.forEach(token => {
      token.Server = null;
      token.channel = null;
      token.chat = null;
      token.status = null;
      token.client = null;
      token.useEmbeds = false;
    });

    // تحميل البوتات من ملف bots.json
    let bots = [];
    try {
      const botsData = fs.readFileSync('./bots.json', 'utf8');
      bots = JSON.parse(botsData);
      if (!Array.isArray(bots)) {
        bots = [];
      }
    } catch (error) {
      console.error('❌>', error);
    }

    // إضافة التوكنات المحذوفة إلى ملف bots.json
    bots = bots.concat(removedTokens);

    // حفظ التغييرات في ملفات JSON
    fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
    fs.writeFileSync('./bots.json', JSON.stringify(bots, null, 2));

    // عدد البوتات التي تم إعادة تعيينها
    const numberOfBotsReset = removedTokens.length;

    // دالة setTimeout لتأخير تغيير التوكنات
    setTimeout(async () => {
      removedTokens.forEach(async (token) => {
        try {
          const randomName = `ceent-${Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000}`;
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

          await botClient.user.setAvatar('https://www.raed.net/img?id=756036');
          await botClient.user.setUsername(randomName);

          await botClient.destroy();
        } catch (error) {
          console.error(`حدث خطأ أثناء تشغيل التوكن: ${error}`);
        }
      });

      // إرسال Embed بعد الانتهاء
      const successEmbed = new EmbedBuilder()
        .setTitle("إستخدام ناجح ✅")
        .setDescription(`**تم إعادة تعيين \`\`${numberOfBotsReset}\`\` بوت وحفظهم في المخزن بنجاح!.**`)
      message.reply({ embeds: [successEmbed] });
    }, 0);  // يمكنك ضبط القيمة إلى الوقت الذي تشاء لتأخير التنفيذ
  }
};
