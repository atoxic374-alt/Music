const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ComponentType, ActivityType } = require('discord.js');

module.exports = {
  name: 'vip',
  run: async (client, message) => {
    if (message.author.bot) return;
    const userId = message.author.id;

    if (!fs.existsSync('./tokens.json')) {
      return;
    }

    let tokens = [];
    try {
      const tokensData = fs.readFileSync('./tokens.json', 'utf8');
      tokens = JSON.parse(tokensData);
    } catch (error) {
      console.error('حدث خطأ أثناء قراءة الملف tokens.json:', error);
      return message.reply('حدث خطأ أثناء قراءة الملف.');
    }

    const userTokens = tokens.filter(token => token.client === userId);

    if (userTokens.length === 0) {
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('musicOptions')
      .setPlaceholder('يرجى الاختيار ..')
      .addOptions([
        {
          label: 'روابط البوتات',
          emoji: '🔗',
          description: 'احصل على روابط جميع برامج البوتات التي تمتلكها',
          value: 'allBotsLinks',
        },
        {
          label: 'إدارة السيرفرات',
          emoji: '🛠️',
          description: 'نقل وإضافة السيرفرات حيث توجد البوتات',
          value: 'updateServerId',
        },{
          label: 'تغيير صور',
          emoji: '🖼️',
          description: 'تغيير صورة جميع البوتات',
          value: 'changeBotAvatars',
        },{
          label: 'إعادة التشغيل',
          emoji: '🔄',
          description: 'إعادة تشغيل جميع البوتات التي تمتلكها',
          value: 'restartAllBots',
        },{
          label: 'تغير الحالة',
          emoji: '🟢',
          description: 'تغير حالة جميع البوتات',
          value: 'changeBotStatus',
        }
      ]);

    const deleteButton = new ButtonBuilder()
      .setCustomId('Cancel3')
      .setLabel('إلغاء')
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger);

    const totalBots = userTokens.length;

    message.reply({
      content: `**إجمالي عدد البوتات هوا : ${totalBots}**`,
      components: [
        new ActionRowBuilder().addComponents(selectMenu),
        new ActionRowBuilder().addComponents(deleteButton)
      ], 
    });
      
    const filter = (interaction) => interaction.user.id === message.author.id;
    const collector = message.channel.createMessageComponentCollector({ filter, componentType: ComponentType.StringSelect, time: 60000 });

    collector.on('collect', async (interaction) => {
      collector.stop();
      if (interaction.customId === 'Cancel3') {
        await interaction.message.delete();
        return;
      }

      const selectedOption = interaction.values?.[0];
      if (!selectedOption) return;

      if (selectedOption === 'allBotsLinks') {
        await interaction.deferReply();
        const botInfoPromises = userTokens.map(async (token, index) => {
          const bot = new Client({ intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
          ] });
          try {
            await bot.login(token.token);
            return `\`${index + 1}\` - \`${bot.user?.username || 'غير معروف'}\` https://discord.com/api/oauth2/authorize?client_id=${bot.user?.id}&permissions=0&scope=bot`;
          } finally {
            try { await bot.destroy(); } catch {}
          }
        });

        try {
          const botInfos = await Promise.all(botInfoPromises);
          for (const [i, info] of botInfos.entries()) {
            try { await interaction.user.send(`**🔗 : رابط بوت الميوزك رقم ${i + 1}:**\n${info}`); } catch {}
          }
          await interaction.followUp({ content: `*تم إرسال روابط جميع البوتات، ${botInfos.length} بوت.*` });
        } catch (err) {
          console.error('حدث خطأ أثناء تسجيل الدخول:', err);
          await interaction.followUp({ content: 'حدث خطأ أثناء تسجيل الدخول.' });
        }
      } else if (selectedOption === 'updateServerId') {
        await interaction.deferReply();
        await interaction.followUp({ content: '**يرجى إرفاق ايدي السيرفر المُرد فالشات.**', ephemeral: true });

        const serverIdCollector = message.channel.createMessageCollector({
          filter: (m) => m.author.id === message.author.id && m.content.trim().length > 0,
          time: 10000,
        });

        serverIdCollector.on('collect', async (response) => {
          const newServerId = response.content.trim();
          for (const t of userTokens) t.Server = newServerId;
          fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2));
          try { await message.react('✅'); } catch {}

          const movePromises = userTokens.map(async (tok) => {
            const bot = new Client({ intents: [
              GatewayIntentBits.Guilds,
              GatewayIntentBits.GuildMessages,
              GatewayIntentBits.GuildMessageReactions,
            ] });
            try {
              await bot.login(tok.token);
              for (const guild of bot.guilds.cache.values()) {
                if (guild.id === newServerId) continue;
                if (guild.ownerId === bot.user.id) continue;
                try { await guild.leave(); } catch {}
              }
              return `\`${bot.user?.username || 'غير معروف'}\` https://discord.com/api/oauth2/authorize?client_id=${bot.user?.id}&permissions=0&scope=bot`;
            } finally {
              try { await bot.destroy(); } catch {}
            }
          });

          try {
            const moved = await Promise.all(movePromises);
            await message.author.send(`**🔗 : روابط البوتات التي تم نقلها**\n${moved.map((v,i)=>`\`${i+1}\` - ${v}`).join('\n')}`);
            const embed = new EmbedBuilder()
              .setTitle('إستخدام ناجح ✅')
              .setDescription(`تم إرسال رابط جميع البوتات، ${moved.length} بوت.`);
            await interaction.followUp({ embeds: [embed] });
          } catch {
            const embed = new EmbedBuilder()
              .setTitle('خطأ في الإرسال ❌')
              .setDescription('حدثت مشكلة أثناء إرسال الروابط في الخاص.');
            await interaction.followUp({ embeds: [embed] });
          }

          serverIdCollector.stop();
        });
      } else if (selectedOption === 'changeBotAvatars') {
        await interaction.deferReply();
        const prompt = new EmbedBuilder().setDescription(`<@${interaction.user.id}>\nيرجى إرفاق الصورة الجديدة، ملاحظة: يجب أن تكون الصورة مرفقة كـ صورة وليس رابط وأن يكون حجم الصورة أقل من 10 ميغابايت`);
        const cancel = new ButtonBuilder().setCustomId('cancelChangeAvatar').setLabel('الغاء').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(cancel);
        const promptMsg = await interaction.followUp({ embeds: [prompt], components: [row] });

        const comp = interaction.channel.createMessageComponentCollector({ filter: (i) => i.user.id === message.author.id, time: 70000 });
        comp.on('collect', async (btn) => {
          if (btn.customId === 'cancelChangeAvatar') {
            await btn.update({ content: 'تم الغاء العملية.', components: [] });
            comp.stop();
          }
        });

        const msgCol = interaction.channel.createMessageCollector({ filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0, time: 70000 });
        msgCol.on('collect', async (m) => {
          const imageUrl = m.attachments.first().url;
          for (const tok of userTokens) {
            const bot = new Client({ intents: [
              GatewayIntentBits.Guilds,
              GatewayIntentBits.GuildMessages,
              GatewayIntentBits.GuildMessageReactions,
            ] });
            try {
              await bot.login(tok.token);
              await bot.user.setAvatar(imageUrl);
            } catch (err) {
              console.error('Avatar change error:', err?.message);
            } finally {
              try { await bot.destroy(); } catch {}
            }
          }
          const done = new EmbedBuilder().setTitle('إستخدام ناجح ✅').setDescription('**تم تغير صور جميع البوتات بنجاح** .');
          await promptMsg.edit({ embeds: [done], components: [] });
          msgCol.stop();
        });

        msgCol.on('end', () => { if (!promptMsg.deleted) try { promptMsg.delete(); } catch {} });
      } else if (selectedOption === 'restartAllBots') {
        await interaction.deferReply();
        for (const tok of userTokens) {
          const bot = new Client({ intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
          ] });
          try {
            await bot.login(tok.token);
          } catch {}
          try { await bot.destroy(); } catch {}
          try { const newBot = new Client({ intents: bot.options.intents }); await newBot.login(tok.token); await newBot.destroy(); } catch {}
        }
        const ok = new EmbedBuilder().setTitle('إستخدام ناجح ✅').setDescription('**تم إعادة تشغيل جميع البوتات بنجاح.**');
        await interaction.followUp({ embeds: [ok] });
      } else if (selectedOption === 'changeBotStatus') {
        await interaction.deferReply();
        const promptEmbed = new EmbedBuilder()
          .setDescription(`<@${interaction.user.id}>\nيرجى إدخال الحالة التي تريد تعيينها للبوتات`);
        const cancelButton = new ButtonBuilder()
          .setCustomId('cancelChangeStatus')
          .setLabel('الغاء')
          .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(cancelButton);
        const promptMsg = await interaction.followUp({ embeds: [promptEmbed], components: [row] });

        const msgCollector = interaction.channel.createMessageCollector({ filter: (m) => m.author.id === interaction.user.id, time: 70000 });
        const compCollector = interaction.channel.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id && i.customId === 'cancelChangeStatus', time: 70000 });

        compCollector.on('collect', async (i) => {
          await i.update({ content: 'تم الغاء العملية.', components: [] });
          msgCollector.stop();
        });

        msgCollector.on('collect', async (m) => {
          const newStatus = m.content.trim().toLowerCase();
          for (const tok of userTokens) {
            const bot = new Client({ intents: [
              GatewayIntentBits.Guilds,
              GatewayIntentBits.GuildMessages,
              GatewayIntentBits.GuildMessageReactions,
            ] });
            try {
              await bot.login(tok.token);
              await bot.user.setPresence({
                activities: [{ name: newStatus, type: ActivityType.Streaming, url: `https://twitch.tv/${newStatus}` }],
                status: newStatus,
              });
            } catch (err) {
              console.error('Status change error:', err?.message);
            } finally {
              try { await bot.destroy(); } catch {}
            }
          }
          const done = new EmbedBuilder().setTitle('إستخدام ناجح ✅').setDescription('**تم تغيير حالة جميع البوتات بنجاح**.');
          try { await promptMsg.edit({ embeds: [done], components: [] }); } catch {}
          msgCollector.stop();
        });

        msgCollector.on('end', async () => {
          if (!promptMsg.deleted) {
            try { await promptMsg.delete(); } catch {}
          }
        });
      }
    });
  }
};