const fs = require('fs');
const { owners, emco, logChannelId } = require(`${process.cwd()}/config`);
const { exec } = require('child_process');
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');
const crypto = require('crypto');

module.exports = {
  name: 'giveuser',
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;

    if (message.author.bot) return;

    const mention = message.mentions.members.first();
    if (!mention) return message.reply("**يرجي إرفاق منشن الشخص.**");

    const userId = mention.id;
    const serverId = args[1];
    if (!serverId) return message.reply("**يرجي إرفاق ايدي السيرفر.**");

    let bots = [];
    try {
      const data = fs.readFileSync('./bots.json', 'utf8');
      bots = JSON.parse(data);
    } catch (error) {
      console.error('❌>', error);
    }

    const count = parseInt(args[2]);
    if (!count || count <= 0 || count > bots.length) {
      return message.reply('**يرجي إرفاق عدد البوتات.**');
    }

    const subscriptionTime = args[3];
    if (!subscriptionTime)
      return message.reply("**يرجى إرفاق وقت صحيح للاشتراك.**");

    const subscriptionDuration = ms(subscriptionTime);
    if (!subscriptionDuration)
      return message.reply("**يرجى إرفاق وقت صحيح للاشتراك.**");

    const expirationTime = Date.now() + subscriptionDuration;

    const randomCode = generateRandomCode(5);

    const logsData = {
      user: userId,
      server: serverId,
      botsCount: count,
      subscriptionTime: subscriptionTime,
      expirationTime: expirationTime,
      code: `#${randomCode}`
    };

    try {
      const logs = fs.readFileSync('./logs.json', 'utf8');
      const logsArray = JSON.parse(logs);
      logsArray.push(logsData);
      fs.writeFileSync('./logs.json', JSON.stringify(logsArray, null, 2));
    } catch (error) {
      console.error('❌>', error);
    }

    const givenTokens = bots.splice(0, count);
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

    givenTokens.forEach(token => {
      tokens.push({
        token: token.token,
        Server: serverId,
        channel: null,
        chat: null,
        status: null,
        client: userId,
        useEmbeds: false,
        code: `#${randomCode}`
      });
    });

    fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
    fs.writeFileSync('./bots.json', JSON.stringify(bots, null, 2));

    exec('pm2 stop index.js && pm2 start index.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`❌> ${error}`);
        return;
      }
      console.log(`❌> ${stdout}`);
      console.log(`❌> ${stderr}`);
    });


    if (client.token) message.react(`✅`).catch(() => {});


    const logChannel = client.channels.cache.find(channel => channel.id === logChannelId);
    await mention.send({
      content: "> تم إضافة اشتراك جديد إلى حسابك . انظر إلى التفاصيل أدناه:",
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: mention.user.username, iconURL: mention.user.displayAvatarURL({ dynamic: true, size: 1024, format: 'png' }) })
          .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
          .setDescription(`**الاشتراك : \`Music x${count}\`\nمدة الاشتراك : \`${subscriptionTime}\`\nايدي السيرفر : \`${serverId}\`\nكود الاشتراك : \`#${randomCode}\`**`)
          .setFooter({ text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true }) })
          .setColor(emco)
          .setTimestamp()
      ],
    }).catch(error => {
      console.error(`Failed to send message to ${mention.user.tag}:`, error);
    });

    const embed = new EmbedBuilder()
      .setTitle('Add Subscription Details')
      .setThumbnail("https://www.raed.net/img?id=756037")
      .setDescription(`**Admin Name:** \`${message.author.username}\` / <@${message.author.id}>\n**User ID:** \`${userId}\` / <@${userId}>\n**ServerId:** \`${serverId}\`\n**Number of Bots:** \`${count}\`\n**Subscription Time:** \`${subscriptionTime}\`\n**Expiration Time:** \`${new Date(expirationTime).toLocaleString()}\`\n**Code:** \`${randomCode}\``)
     .setColor(emco);

    logChannel.send({ embeds: [embed] });
  }
};



function generateRandomCode(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }
  return code;
}