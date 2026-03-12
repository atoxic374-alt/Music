const { owners, prefix } = require(`${process.cwd()}/config`);
const fs = require('fs');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'help',
    run: async (client, message) => {

        if (!owners.includes(message.author.id)) return;

        // إنشاء زر الرسالة
        const button = new ButtonBuilder()
            .setStyle(ButtonStyle.Success) // يمكنك تغيير الألوان (Primary, Secondary, Success, Danger, Link)
            .setLabel('اضغط هنا')
            .setEmoji("<:326568_check_circle_icon:1223344091358822501>")
            .setCustomId('help'); // هذا هو المعرف الذي سيتم استخدامه للتعرف على الزر

        const row = new ActionRowBuilder().addComponents(button);

        await message.reply({
            content: `**لعرض قائمة الاوامر الخاصه أضغط علي الزر**`,
            components: [row]
        });

        // الاستماع إلى استجابة الزر
        const filter = interaction => interaction.customId === 'help' && interaction.user.id === message.author.id;

        const collector = message.channel.createMessageComponentCollector({ filter, time: 15000 }); 

        collector.on('collect', async interaction => {
            interaction.reply(
{ content: `
🎶> \`vip\` : **عرض الأوامر الخاصة بالعملاء**
🎶> \`addtoken\` : **إضافة توكن للمخزن**
🎶> \`giveuser\` : **إضافة بوتات ميوزك للعميل**
🎶> \`removebots\` : **حذف بوتات ميوزك من العميل إوعادة حفظها**
🎶> \`bots\` : **عرض ايدي سيرفرات البوتات للعملاء**
🎶> \`addsubtime\` : **اضافة وقت إضافي للعميل*
🎶> \`allsub\` : **عرض جميع الاشتراكات**
🎶> \`removesub\` : **حذف اشتراك شخص**
🎶> \`tokens\` : **عرض مجموع التوكنات المحفوظه بالمخزن**
🎶> \`alnuimi\` : ** صنع لدى نست**


`, ephemeral: true }); 
        });
    }
}
