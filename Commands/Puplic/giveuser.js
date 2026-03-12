const { owners, emco, logChannelId } = require(`${process.cwd()}/config`);
const { exec } = require('child_process');
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');
const storage = require('../../lib/storage');

module.exports = {
  name: 'giveuser',
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const mention = message.mentions.members.first();
    if (!mention) return message.reply('**يرجي إرفاق منشن الشخص.**');

    const userId = mention.id;
    const serverId = args[1];
    if (!serverId) return message.reply('**يرجي إرفاق ايدي السيرفر.**');

    let bots = await storage.getBots();
    if (!Array.isArray(bots)) bots = [];

    const count = parseInt(args[2]);
    if (!count || count <= 0 || count > bots.length) return message.reply('**يرجي إرفاق عدد البوتات.**');

    const subscriptionTime = args[3];
    if (!subscriptionTime) return message.reply('**يرجى إرفاق وقت صحيح للاشتراك.**');

    const subscriptionDuration = ms(subscriptionTime);
    if (!subscriptionDuration) return message.reply('**يرجى إرفاق وقت صحيح للاشتراك.**');

    const expirationTime = Date.now() + subscriptionDuration;
    const randomCode = generateRandomCode(5);

    const logsData = {
      user: userId,
      server: serverId,
      botsCount: count,
      subscriptionTime,
      expirationTime,
      code: `#${randomCode}`,
    };

    const logsArray = await storage.getLogs();
    logsArray.push(logsData);
    await storage.setLogs(logsArray);

    const givenTokens = bots.splice(0, count);
    let tokens = await storage.getTokens();
    if (!Array.isArray(tokens)) tokens = [];

    givenTokens.forEach((token) => {
      tokens.push({ token: token.token, Server: serverId, channel: null, chat: null, status: null, client: userId, useEmbeds: false, code: `#${randomCode}` });
    });

    await storage.setTokens(tokens);
    await storage.setBots(bots);

    exec('pm2 stop index.js && pm2 start index.js', () => {});

    if (client.token) message.react('✅').catch(() => {});

    const logChannel = client.channels.cache.find((channel) => channel.id === logChannelId);
    await mention.send({
      content: '> تم إضافة اشتراك جديد إلى حسابك . انظر إلى التفاصيل أدناه:',
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: mention.user.username, iconURL: mention.user.displayAvatarURL({ dynamic: true, size: 1024, format: 'png' }) })
          .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
          .setDescription(`**الاشتراك : \`Music x${count}\`\nمدة الاشتراك : \`${subscriptionTime}\`\nايدي السيرفر : \`${serverId}\`\nكود الاشتراك : \`#${randomCode}\`**`)
          .setFooter({ text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true }) })
          .setColor(emco)
          .setTimestamp(),
      ],
    }).catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('Add Subscription Details')
      .setThumbnail('https://www.raed.net/img?id=756037')
      .setDescription(`**Admin Name:** \`${message.author.username}\` / <@${message.author.id}>\n**User ID:** \`${userId}\` / <@${userId}>\n**ServerId:** \`${serverId}\`\n**Number of Bots:** \`${count}\`\n**Subscription Time:** \`${subscriptionTime}\`\n**Expiration Time:** \`${new Date(expirationTime).toLocaleString()}\`\n**Code:** \`${randomCode}\``)
      .setColor(emco);

    logChannel?.send({ embeds: [embed] });
  },
};

function generateRandomCode(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < length; i++) code += characters.charAt(Math.floor(Math.random() * characters.length));
  return code;
}
