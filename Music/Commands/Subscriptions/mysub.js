const fs = require('fs');
const ms = require('ms');
const { owners, prefix, emco } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'mysub',
  aliases: ["اشتراك"],
  run: async (client, message, args) => {
    let userId;

    // Check if the user mentioned someone or provided a user ID
    if (message.mentions.users.size > 0) {
      userId = message.mentions.users.first().id;
    } else if (args[0]) {
      userId = args[0];
    } else {
      // If neither mentioned nor provided an ID, default to the message author
      userId = message.author.id;
    }

    try {
      const logs = fs.readFileSync('./logs.json', 'utf8');
      const logsArray = JSON.parse(logs);

      const userSubscriptions = logsArray.filter(entry => entry.user === userId);

      if (userSubscriptions.length === 0) {
        return message.reply('**لا يوجد لديك أي اشتراك .**');
      }

      const embed = new EmbedBuilder()
        .setTitle('Music Subscriptions')
        .setColor(emco)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `${message.client.user.username} | Timer`, iconURL: message.client.user.displayAvatarURL({ dynamic: true }) });

      userSubscriptions.forEach((userSubscription, index) => {
        const expirationTime = userSubscription.expirationTime;
        const remainingTime = expirationTime - Date.now();

        // حساب الأيام والساعات والدقائق والثواني المتبقية
        const days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);

        const formattedTime = `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds ? `${seconds}s` : ''}`;
        embed.setDescription(`${embed.description || ''}\n**\`${index + 1}\` | \`Music x${userSubscription.botsCount}\` | \`${userSubscription.code}\` | ${formattedTime}**`);
      });

      // إرسال رسالة الرد ك Embed مع الوصف
      message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('❌>', error);
      message.reply('حدث خطأ أثناء قراءة ملف السجلات.');
    }
  }
};
