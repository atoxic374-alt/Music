const fs = require('fs');
const { owners, prefix } = require(`${process.cwd()}/config`);
const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'bots',
    run: (client, message) => {
        if (!owners.includes(message.author.id)) return;

        let tokens = [];
        try {
            const data = fs.readFileSync('./tokens.json', 'utf8');
            tokens = JSON.parse(data);
        } catch (error) {
            return message.reply('حدث خطأ أثناء قراءة ملف التوكنات.');
        }

        const embed = new EmbedBuilder()
            .setTitle("Bots info")

        const displayedServerIds = new Set();
        const displayedBotClientIds = new Set();

        tokens.forEach(tokenData => {
            const { Server, client: botClientId } = tokenData;
            if (Server && botClientId && !displayedServerIds.has(Server) && !displayedBotClientIds.has(botClientId)) {
                const botCountInServer = tokens.filter(t => t.Server === Server).length;
                embed.addFields({ name: `Server ID: \`${Server}\``, value: `**Client ID: \`${botClientId}\`\nClient Name:  \`(\` <@${botClientId}> \`)\`\nTotal Bots: \`${botCountInServer}\`**` });

                displayedServerIds.add(Server);
                displayedBotClientIds.add(botClientId);
            }
        });

        message.channel.send({ embeds: [embed] });
    }
};