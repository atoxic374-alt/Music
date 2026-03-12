const fs = require('fs');
const { owners, prefix, emco } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'allsub',
  aliases: ["allsub"],
  run: async (client, message, args) => {
    if (!owners.includes(message.author.id)) return;

    try {
      const logs = fs.readFileSync('./logs.json', 'utf8');
      const logsArray = JSON.parse(logs);

      if (logsArray.length === 0) {
        return message.reply('**لا توجد اشتراكات مسجلة حاليًا.**');
      }

      // ترتيب الاشتراكات بناءً على اسم المستخدم
      logsArray.sort((a, b) => a.user.localeCompare(b.user));

      const embed = new EmbedBuilder()
        .setTitle('All Subscriptions')
        .setColor(emco)
        .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1198447335341031534/clock.png?ex=65bef00e&is=65ac7b0e&hm=667bad0bcc0ac7e53c62dd3b0f078541256fc21883a07541ba5188ec15f041b3&")
        .setFooter({ text: `${message.client.user.username} | Timer`, iconURL: message.client.user.displayAvatarURL({ dynamic: true }) });

      logsArray.forEach((userSubscription, index) => {
        const expirationTime = userSubscription.expirationTime;
        const remainingTime = expirationTime - Date.now();

        // حساب الأيام والساعات والدقائق والثواني المتبقية
        const days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);

        const formattedTime = `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds ? `${seconds}s` : ''}`;
        
        const guildId = userSubscription.server; // قم بتحديد الخاصية المناسبة من كائن الاشتراك

        embed.setDescription(`${embed.description || ''}\n**\`${index + 1}\` | <@${userSubscription.user}> | \`Music x${userSubscription.botsCount}\` | \`${userSubscription.code}\` | ${formattedTime} **`);
      });

      // إرسال رسالة الرد ك Embed
      message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('❌>', error);
      message.reply('حدث خطأ أثناء قراءة ملف السجلات.');
    }
  }
};
