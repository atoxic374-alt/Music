const { owners, prefix } = require(`${process.cwd()}/config`);
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: 'addtoken',
  run: async (client, message) => {

    if (!owners.includes(message.author.id)) return;


    const botIntents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ];

    const clientCheck = new Client({ intents: botIntents });

    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args.shift().toLowerCase();
    const tokenValues = args;

    if (tokenValues.length === 0) return message.reply('**يرجى إرفاق التوكن بعد الامر.**');

    const validTokens = [];

    for (const tokenValue of tokenValues) {
      try {
        await clientCheck.login(tokenValue);
        validTokens.push(tokenValue);
      } catch (error) {
        if (error.message === 'TOKEN_INVALID') {
          console.error(`❌ it's no use > ${tokenValue}`);
          message.reply(`❌ it's no use > ${tokenValue}`);
        } else {
          console.error(`❌> ${tokenValue}`, error.message);
          message.reply(`**❌ it's no use >** \`${tokenValue}\``);
        }
      }
    }

    if (validTokens.length > 0) {
      if (client.token) message.react("✅").catch(() => {});

      let bots = [];
      try {
        const data = fs.readFileSync('./bots.json', 'utf8');
        bots = JSON.parse(data);
        if (!Array.isArray(bots)) {
          bots = [];
        }
      } catch (error) {
        console.error('❌>', error);
      }

      for (const tokenValue of validTokens) {
        const tokenExists = bots.some(bot => bot.token === tokenValue);
        if (!tokenExists) {
          bots.push({
            token: tokenValue,
            Server: null,
            channel: null,
            chat: null,
            status: null,
            client: null,
            useEmbeds: false
          });
        }
      }
      fs.writeFileSync('./bots.json', JSON.stringify(bots, null, 2));

      // دالة لتوليد رقم عشوائي مكون من أربعة أرقام
      function generateRandomNumber() {
        return Math.floor(1000 + Math.random() * 9000); // يولد رقمًا بين 1000 و 9999
      }

      // تأخير تغيير صورة البوت وتعيين الاسم
      setTimeout(async () => {
        for (const tokenValue of validTokens) {
          try {
            const botClient = new Client({ intents: botIntents });
            await botClient.login(tokenValue);

            const randomNumber = generateRandomNumber();
            await botClient.user.setUsername(`Nova-${randomNumber}`);
            await botClient.user.setAvatar('https://cdn.discordapp.com/attachments/1236436781390495894/1243265862064930876/YiwCyvs.png?ex=6650d910&is=664f8790&hm=b59fe69e79d42e8bcdaffd1d687a218301a64fa81915ab74affad8533307e827&');

            // تسجيل خروج البوت بعد تغيير البيانات الشخصية
            await botClient.destroy();
          } catch (avatarError) {
            console.error(`❌>`, avatarError.message);
          }
        }
      }, 5000);
    }
  }
}