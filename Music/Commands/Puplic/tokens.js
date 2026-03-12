const { owners, prefix, emco } = require(`${process.cwd()}/config`);
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'tokens',
  run: (client, message) => {

    if (!owners.includes(message.author.id)) return;


    if (message.author.bot) return;

    // قراءة محتوى الملف bots.json
    let bots = [];
    try {
      const data = fs.readFileSync('./bots.json', 'utf8');
      bots = JSON.parse(data);
    } catch (error) {
      console.error('حدث خطأ أثناء قراءة الملف bots.json:', error);
    }

    // استخراج عدد التوكنات من bots.json
    const botTokenCount = bots.length;

    // قراءة محتوى الملف tokens.json
    let tokens = [];
    try {
      const data = fs.readFileSync('./tokens.json', 'utf8');
      tokens = JSON.parse(data);
    } catch (error) {
      console.error('🔴>', error);
    }

    // استخراج عدد التوكنات من tokens.json
    const userTokenCount = tokens.length;

    // إرسال الرسالة مع عدد التوكنات من كل ملف
    const embed = new EmbedBuilder()
    .setTitle('Token Status')
    .setColor(emco)
    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
    .setDescription(`Total Tokens Stock ( \`${botTokenCount}\` <🔴)\nTotal Tokens Running ( \`${userTokenCount}\` <🟢) `)
   

  message.reply({ embeds: [embed] });

  }
}
