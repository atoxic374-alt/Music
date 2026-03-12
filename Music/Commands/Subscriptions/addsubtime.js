const fs = require('fs');
const { owners, emco, logChannelId } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');

module.exports = {
  name: 'addsubtime',
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;

    const codeToAddTime = args[0];
    if (!codeToAddTime) return message.reply("**.يرجى أرفاق ايدي الاشتراك**");

    const timeToAdd = args[1];
    if (!timeToAdd || !ms(timeToAdd)) return message.reply("**يرجى إرفاق وقت صحيح.**");

    try {
      const logs = fs.readFileSync('./logs.json', 'utf8');
      const logsArray = JSON.parse(logs);

      const matchingSubscription = logsArray.find(entry => entry.code === codeToAddTime);

      if (!matchingSubscription) {
        return message.reply("**لا يوجد اشتراك مرتبط بهذا الايدي.**");
      }

      // زيادة الوقت لصاحب الاشتراك المرتبط بالكود
      const newExpirationTime = matchingSubscription.expirationTime + ms(timeToAdd);
      matchingSubscription.expirationTime = newExpirationTime;

      const logChannel = client.channels.cache.find(channel => channel.id === logChannelId);
      fs.writeFileSync('./logs.json', JSON.stringify(logsArray, null, 2));

      // رد برد التأكيد
      message.react('✅');

      // إرسال معلومات الإضافة إلى روم الوج
      const adminName = message.author.username;
      const userId = matchingSubscription.user;
      const serverId = matchingSubscription.server;
      const botsCount = matchingSubscription.botsCount;
      const subscriptionTime = matchingSubscription.subscriptionTime;
      const expirationTime = matchingSubscription.expirationTime;
      const code = matchingSubscription.code;

      const embed = new EmbedBuilder()
        .setTitle('Add timeing')
        .setThumbnail("https://www.raed.net/img?id=756032")
        .setDescription(`**Admin Name:** ( <@${message.author.id}> )\n**Client Name:** ( <@${userId}> )\n**Code:** \`${code}\`\n**Added:** \`${timeToAdd}\``)
        .setColor(emco);

      logChannel.send({ embeds: [embed] });

      // إرسال Embed لتأكيد زيادة الوقت
      const successEmbed = new EmbedBuilder()
        .setTitle("تمت إضافة وقت بنجاح ✅")
        .setColor(emco)
        .setDescription(`**تمت إضافة \`\`${timeToAdd}\`\` إلى الاشتراك المرتبط بالرمز \`\`${codeToAddTime}\`\`.**`);
      message.reply({ embeds: [successEmbed] });
    } catch (error) {
      console.error('❌>', error);
      message.reply('**حدث خطأ أثناء محاولة إضافة وقت للاشتراك.**');
    }
  }
};
