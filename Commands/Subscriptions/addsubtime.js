const { owners, emco, logChannelId } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');
const storage = require('../../lib/storage');

module.exports = {
  name: 'addsubtime',
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;

    const codeToAddTime = args[0];
    if (!codeToAddTime) return message.reply('**.يرجى أرفاق ايدي الاشتراك**');

    const timeToAdd = args[1];
    if (!timeToAdd || !ms(timeToAdd)) return message.reply('**يرجى إرفاق وقت صحيح.**');

    try {
      const logsArray = await storage.getLogs();
      const matchingSubscription = logsArray.find((entry) => entry.code === codeToAddTime);
      if (!matchingSubscription) return message.reply('**لا يوجد اشتراك مرتبط بهذا الايدي.**');

      matchingSubscription.expirationTime = matchingSubscription.expirationTime + ms(timeToAdd);
      await storage.setLogs(logsArray);
      message.react('✅').catch(() => {});

      const logChannel = client.channels.cache.find((channel) => channel.id === logChannelId);
      const embed = new EmbedBuilder()
        .setTitle('Add timeing')
        .setThumbnail('https://www.raed.net/img?id=756032')
        .setDescription(`**Admin Name:** ( <@${message.author.id}> )\n**Client Name:** ( <@${matchingSubscription.user}> )\n**Code:** \`${matchingSubscription.code}\`\n**Added:** \`${timeToAdd}\``)
        .setColor(emco);
      logChannel?.send({ embeds: [embed] });

      const successEmbed = new EmbedBuilder()
        .setTitle('تمت إضافة وقت بنجاح ✅')
        .setColor(emco)
        .setDescription(`**تمت إضافة \`\`${timeToAdd}\`\` إلى الاشتراك المرتبط بالرمز \`\`${codeToAddTime}\`\`.**`);
      message.reply({ embeds: [successEmbed] });
    } catch (error) {
      console.error('❌>', error);
      message.reply('**حدث خطأ أثناء محاولة إضافة وقت للاشتراك.**');
    }
  },
};
