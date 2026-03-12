const { PermissionsBitField, GatewayIntentBits, Partials, Client, EmbedBuilder, AttachmentBuilder, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, WebhookClient, ActivityType, ChannelType, Options } = require('discord.js');
const { VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static') || 'ffmpeg';
const sodium = require('libsodium-wrappers');
const { Shoukaku, Connectors } = require('shoukaku');
require('events').EventEmitter.defaultMaxListeners = 200;
const express = require('express');
const app = express();
const config = require('./config.json');
const storage = require('./lib/storage');

app.get('/', (req, res) => {
  res.send('Hello Express app!')
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    startedAt: new Date(metrics.startedAt).toISOString(),
  });
});

app.get('/metrics', (req, res) => {
  const lines = [
    `music_started_at_ms ${metrics.startedAt}`,
    `music_subbots_boot_requested ${metrics.subBotsBootRequested}`,
    `music_subbots_booted ${metrics.subBotsBooted}`,
    `music_play_requests_total ${metrics.playRequests}`,
    `music_play_blocked_compliance_total ${metrics.playBlockedByCompliance}`,
    `music_play_resolve_misses_total ${metrics.playResolveMisses}`,
    `music_autotune_adjustments_total ${metrics.autoTuneAdjustments}`,
    `music_cpu_load_1m ${metrics.cpuLoad1m}`,
    `music_boot_parallel_current ${bootstrapConfig.maxParallelSubBotBoot}`,
    `music_boot_delay_ms_current ${bootstrapConfig.subBotBootDelayMs}`,
  ];
  res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n'));
});
app.listen(30000, () => {
  console.log('Server Started..');
});

// Suppress debug spam (messages starting with [LL], [Presence], [AUTO])
const __origLog = console.log;
const __origWarn = console.warn;
const __origError = console.error;
const shouldSuppressLog = (entry) => typeof entry === 'string' && (entry.startsWith('[LL') || entry.startsWith('[Presence') || entry.startsWith('[AUTO'));
console.log = (...args) => { if (shouldSuppressLog(args[0])) return; __origLog(...args); };
console.warn = (...args) => { if (shouldSuppressLog(args[0])) return; __origWarn(...args); };
console.error = (...args) => { if (shouldSuppressLog(args[0])) return; __origError(...args); };

function convertTimeToSeconds(timeString) {
  const time = timeString.toLowerCase();
  const units = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800
  };

  const unit = time.charAt(time.length - 1);
  const value = parseInt(time.slice(0, time.length - 1));
  if (unit in units) {
    return value * units[unit];

  } else {
    return 0; 
  }
}

async function deleteUnauthorizedOwnerMessages(record) {
  if (!record?.ownerMessages?.length) return;
  for (const ref of record.ownerMessages) {
    try {
      const channel = await client.channels.fetch(ref.channelId).catch(() => null);
      if (!channel) continue;
      const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
      if (!msg) continue;
      await msg.delete().catch(() => {});
    } catch {}
  }
  record.ownerMessages = [];
}


const performanceConfig = {
  lightMode: config?.performance?.lightMode !== false,
  messageCacheSize: Number(config?.performance?.messageCacheSize ?? 25),
  messageCacheTTLSeconds: Number(config?.performance?.messageCacheTTLSeconds ?? 180),
  sweepIntervalSeconds: Number(config?.performance?.sweepIntervalSeconds ?? 120),
  disableGuildMembersIntent: config?.performance?.disableGuildMembersIntent !== false,
  disablePartialsOnSubBots: config?.performance?.disablePartialsOnSubBots !== false,
};

const complianceConfig = {
  enforceLicensedSourcesOnly: config?.compliance?.enforceLicensedSourcesOnly === true,
  blockedDomains: Array.isArray(config?.compliance?.blockedDomains) ? config.compliance.blockedDomains : ['youtube.com', 'youtu.be'],
  allowedDomains: Array.isArray(config?.compliance?.allowedDomains) ? config.compliance.allowedDomains : [],
  allowSearchWhenComplianceEnabled: config?.compliance?.allowSearchWhenComplianceEnabled === true,
};


const bootstrapConfig = {
  maxParallelSubBotBoot: Math.max(1, Number(config?.performance?.maxParallelSubBotBoot ?? 8)),
  subBotBootDelayMs: Math.max(0, Number(config?.performance?.subBotBootDelayMs ?? 150)),
};

const metrics = {
  startedAt: Date.now(),
  subBotsBootRequested: 0,
  subBotsBooted: 0,
  playRequests: 0,
  playBlockedByCompliance: 0,
  playResolveMisses: 0,
  autoTuneAdjustments: 0,
  cpuLoad1m: 0,
};


function runtimePreflightChecks() {
  if (storage.provider === 'json') {
    console.warn('[PERF] storage.provider=json is not recommended for high scale. Use redis/postgres.');
  }
  const nodeCount = Array.isArray(config?.lavalink?.nodes) ? config.lavalink.nodes.length : 0;
  if (nodeCount < 2) {
    console.warn('[PERF] Less than 2 Lavalink nodes configured. High load may degrade quality/latency.');
  }
}

function getRuntimeStats() {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const load = Array.isArray(require('os').loadavg()) ? require('os').loadavg()[0] : 0;
  metrics.cpuLoad1m = Number(load || 0);
  return { rssMb, load1m: Number(load || 0) };
}

function autoTunePerformance() {
  if (!config?.performance?.enableAutoTune) return;
  const floor = Math.max(1, Number(config?.performance?.maxParallelSubBotBootFloor ?? 4));
  const ceil = Math.max(floor, Number(config?.performance?.maxParallelSubBotBootCeil ?? 20));
  const softMem = Math.max(256, Number(config?.performance?.memorySoftLimitMb ?? 1400));

  const st = getRuntimeStats();
  const highLoad = st.load1m > 2.2 || st.rssMb > softMem;
  const lowLoad = st.load1m < 1.2 && st.rssMb < (softMem * 0.75);

  if (highLoad && bootstrapConfig.maxParallelSubBotBoot > floor) {
    bootstrapConfig.maxParallelSubBotBoot = Math.max(floor, bootstrapConfig.maxParallelSubBotBoot - 1);
    bootstrapConfig.subBotBootDelayMs = Math.min(500, bootstrapConfig.subBotBootDelayMs + 20);
    metrics.autoTuneAdjustments += 1;
  } else if (lowLoad && bootstrapConfig.maxParallelSubBotBoot < ceil) {
    bootstrapConfig.maxParallelSubBotBoot = Math.min(ceil, bootstrapConfig.maxParallelSubBotBoot + 1);
    bootstrapConfig.subBotBootDelayMs = Math.max(20, bootstrapConfig.subBotBootDelayMs - 10);
    metrics.autoTuneAdjustments += 1;
  }
}

const audioConfig = {
  defaultVolume: Number(config?.audio?.defaultVolume ?? 65),
  applyFilters: config?.audio?.applyFilters !== false,
  equalizerPreset: Array.isArray(config?.audio?.equalizerPreset) ? config.audio.equalizerPreset : [
    { band: 0, gain: 0.05 },
    { band: 1, gain: 0.08 },
    { band: 2, gain: 0.06 },
    { band: 3, gain: 0.03 },
    { band: 4, gain: 0.0 },
    { band: 5, gain: -0.01 },
    { band: 6, gain: -0.02 },
    { band: 7, gain: 0.01 },
    { band: 8, gain: 0.03 },
    { band: 9, gain: 0.02 },
    { band: 10, gain: 0.0 },
    { band: 11, gain: -0.02 },
    { band: 12, gain: -0.03 },
    { band: 13, gain: -0.01 },
    { band: 14, gain: 0.0 }
  ],
};

function buildClientOptions(base = {}, isSubBot = false) {
  const opts = {
    ...base,
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: performanceConfig.lightMode ? performanceConfig.messageCacheSize : 200,
    }),
  };

  if (performanceConfig.lightMode) {
    opts.sweepers = {
      messages: {
        interval: performanceConfig.sweepIntervalSeconds,
        lifetime: performanceConfig.messageCacheTTLSeconds,
      },
    };
  }

  if (isSubBot && performanceConfig.disablePartialsOnSubBots) {
    opts.partials = [];
  }

  return opts;
}

function isBlockedByCompliance(input = '') {
  const text = String(input || '').toLowerCase();
  if (!complianceConfig.enforceLicensedSourcesOnly) return false;
  if (!text) return false;
  const isUrl = /^https?:\/\//i.test(text);
  if (!isUrl) return !complianceConfig.allowSearchWhenComplianceEnabled;

  const hasAllowed = Array.isArray(complianceConfig.allowedDomains) && complianceConfig.allowedDomains.length > 0;
  if (hasAllowed) {
    const allowed = complianceConfig.allowedDomains.some((d) => text.includes(String(d).toLowerCase()));
    if (!allowed) return true;
  }

  return complianceConfig.blockedDomains.some((d) => text.includes(String(d).toLowerCase()));
}

function getDefaultSubBotVolume() {
  if (!Number.isFinite(audioConfig.defaultVolume)) return 65;
  return Math.max(1, Math.min(150, Math.floor(audioConfig.defaultVolume)));
}

const controllerIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

if (!performanceConfig.disableGuildMembersIntent) {
  controllerIntents.push(GatewayIntentBits.GuildMembers);
}

const client = new Client(buildClientOptions({
  intents: [
    ...controllerIntents,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
  allowedMentions: {
    parse: ['users'],
    repliedUser: false
  }
}));



const ms = require("ms");
const fs = require('fs');
const { owners, prefix, emco, useEmbeds, Support, logChannelId } = require(`${process.cwd()}/config`);
const fetch = require("node-fetch");
client.prefix = prefix;
module.exports = client;
client.commands = new Collection();
client.slashCommands = new Collection();
client.config = require(`${process.cwd()}/config`);
require("./handler")(client);
const tempData = new Collection();
tempData.set("bots", []);

client.subBotRegistry = client.subBotRegistry || new Map();
client.unauthorizedAlerts = client.unauthorizedAlerts || new Map();
client.unauthorizedIgnores = client.unauthorizedIgnores || new Set();

const byAhmedOwnerId = Array.isArray(owners) && owners.length > 0 ? owners[0] : null;

function replyArabic(target, text) {
  if (!text) return null;
  if (useEmbeds) {
    const embed = new EmbedBuilder().setColor(emco || '#ffffff').setDescription(text);
    return target.reply({ embeds: [embed] });
  }
  return target.reply(text);
}

function buildOwnerFooterEmbed(ownerId) {
  const targetOwnerId = ownerId || byAhmedOwnerId;
  const mention = targetOwnerId ? `<@${targetOwnerId}>` : 'Unknown';
  const ownerIdText = targetOwnerId || 'Unknown';
  return new EmbedBuilder()
    .setColor(emco || '#ffffff')
    .setDescription(`**المالك :** ${mention}\n**معرّف المالك :** \`${ownerIdText}\``)
    .setTimestamp(new Date());
}

function buildSupportActionRow() {
  if (!Support) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('الدعم')
      .setStyle(ButtonStyle.Link)
      .setURL(Support)
  );
}

function enhanceDmPayload(payload, ownerId) {
  const embedFooter = buildOwnerFooterEmbed(ownerId);
  const supportRow = buildSupportActionRow();
  const combined = { ...payload };
  combined.embeds = [ ...(payload.embeds || []), embedFooter ];
  if (supportRow) {
    combined.components = [ ...(payload.components || []), supportRow ];
  }
  return combined;
}

async function sendOwnerDm(target, payload, ownerId) {
  if (!target) return null;
  const finalPayload = enhanceDmPayload(payload, ownerId);
  return target.send(finalPayload);
}

function makeUnauthorizedAlertId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function makeUnauthorizedKey(clientOwnerId, guildId) {
  return `${clientOwnerId || 'unknown'}:${guildId}`;
}

function findUnauthorizedRecordByKey(key) {
  for (const record of client.unauthorizedAlerts.values()) {
    if (record.key === key) return record;
  }
  return null;
}

function buildUnauthorizedActionRow(alertId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`unauth:leave:${alertId}`)
      .setLabel('إخراج البوتات')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`unauth:notify:${alertId}`)
      .setLabel('تنبيه العميل')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`unauth:ignore:${alertId}`)
      .setLabel('تجاهل التنبيه')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildUnauthorizedEmbed(record) {
  const botLines = (record.bots || []).map((bot, index) => `> **${index + 1}. ${bot.botTag || 'غير معروف'}** (ID: ${bot.botId || 'N/A'})`).join('\n') || '> **لا توجد بيانات بوت.**';
  const embed = new EmbedBuilder()
    .setTitle('تنبيه: تم اكتشاف سيرفر غير مصرح')
    .setColor(emco || 0xffffff)
    .setDescription('> **النظام اكتشف وجود بوتات ميوزك داخل سيرفر غير مسجل في الاشتراك.**')
    .addFields(
      { name: 'السيرفر الذي دخل إليه', value: `> **${record.guildName || 'غير معروف'}** ( ${record.guildId} )`, inline: false },
      { name: 'السيرفر المصرح به', value: `> **${record.allowedServerId || 'غير محدد'}**`, inline: false },
      { name: 'عميل الاشتراك', value: record.clientOwnerId ? `> <@${record.clientOwnerId}>` : '> **غير معروف**', inline: false },
      { name: 'البوتات الحالية في السيرفر', value: botLines, inline: false }
    )
    .setTimestamp(new Date());
  if (record.lastNotifiedAt) {
    embed.addFields({ name: 'حالة التنبيه', value: `> **تم تنبيه العميل في <t:${Math.floor(record.lastNotifiedAt / 1000)}:f>**` });
  }
  return embed;
}

function buildUnauthorizedAlertPayload(record) {
  return {
    content: '> **تم اكتشاف بوت داخل سيرفر غير مصرح، يرجى اختيار الإجراء المناسب.**',
    embeds: [buildUnauthorizedEmbed(record)],
    components: [buildUnauthorizedActionRow(record.alertId)]
  };
}

async function updateUnauthorizedAlertMessages(record) {
  if (!record?.ownerMessages?.length) return;
  const basePayload = buildUnauthorizedAlertPayload(record);
  for (const ref of record.ownerMessages) {
    try {
      const channel = await client.channels.fetch(ref.channelId).catch(() => null);
      if (!channel) continue;
      const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
      if (!msg) continue;
      const finalPayload = enhanceDmPayload(basePayload, ref.ownerId);
      await msg.edit(finalPayload).catch(() => {});
    } catch {}
  }
}

async function registerUnauthorizedAlert(payload = {}) {
  const { token, guildId, clientOwnerId } = payload;
  if (!token || !guildId) return;
  const key = makeUnauthorizedKey(clientOwnerId, guildId);
  if (client.unauthorizedIgnores.has(key)) return;

  const botEntry = {
    token,
    botId: payload.botId,
    botTag: payload.botTag
  };

  let record = findUnauthorizedRecordByKey(key);
  if (record) {
    const exists = (record.bots || []).some((b) => b.token === botEntry.token);
    if (!exists) {
      record.bots.push(botEntry);
      record.updatedAt = Date.now();
      await updateUnauthorizedAlertMessages(record);
    }
    return;
  }

  const alertId = makeUnauthorizedAlertId();
  record = {
    ...payload,
    key,
    alertId,
    createdAt: Date.now(),
    bots: [botEntry],
    ownerMessages: []
  };
  client.unauthorizedAlerts.set(alertId, record);

  const recipients = Array.isArray(owners) ? owners : [];
  const basePayload = buildUnauthorizedAlertPayload(record);
  for (const ownerId of recipients) {
    try {
      const user = await client.users.fetch(ownerId).catch(() => null);
      if (!user) continue;
      const sent = await sendOwnerDm(user, basePayload, ownerId).catch(() => null);
      if (sent) {
        record.ownerMessages.push({ ownerId, channelId: sent.channelId, messageId: sent.id });
      }
    } catch {}
  }
}

async function forceLeaveForAlert(alertInfo) {
  if (!alertInfo) return false;
  const registry = client.subBotRegistry;
  if (!registry) return false;
  const targets = Array.isArray(alertInfo.bots) && alertInfo.bots.length > 0 ? alertInfo.bots : [{ token: alertInfo.token }];
  let success = false;
  for (const bot of targets) {
    try {
      const instance = registry.get(bot.token);
      if (!instance) continue;
      const guild = instance.guilds.cache.get(alertInfo.guildId);
      if (!guild) continue;
      await guild.leave();
      success = true;
    } catch {}
  }
  return success;
}

async function notifyClientOwnerOfIssue(alertInfo) {
  if (!alertInfo?.clientOwnerId) return false;
  try {
    const user = await client.users.fetch(alertInfo.clientOwnerId).catch(() => null);
    if (!user) return false;
    const botsList = (alertInfo.bots || []).map((bot, index) => `> **${index + 1}. ${bot.botTag || 'غير معروف'}** (ID: ${bot.botId || 'N/A'})`).join('\n') || '> **لا توجد بيانات بوت.**';
    const embed = new EmbedBuilder()
      .setTitle('تنبيه: البوت خارج السيرفر المصرح به')
      .setColor(emco || 0xffffff)
      .setDescription('> **يرجى التأكد من نقل بوتاتك فوراً إلى السيرفر المصرح به في اشتراكك.**')
      .addFields(
        { name: 'السيرفر الحالي', value: `> **${alertInfo.guildName || 'غير معروف'}** ( ${alertInfo.guildId} )` },
        { name: 'السيرفر المصرح به', value: `> **${alertInfo.allowedServerId || 'غير محدد'}**` },
        { name: 'البوتات المتأثرة', value: botsList }
      );
    await sendOwnerDm(user, { embeds: [embed] }, alertInfo.clientOwnerId).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function notifyClientOwnerOfRemoval(alertInfo, success) {
  if (!alertInfo?.clientOwnerId) return;
  try {
    const user = await client.users.fetch(alertInfo.clientOwnerId).catch(() => null);
    if (!user) return;
    const statusLine = success ? '> **تم إخراج جميع البوتات من السيرفر غير المصرح.**' : '> **تعذر إخراج بعض البوتات من السيرفر غير المصرح.**';
    const botsList = (alertInfo.bots || []).map((bot, index) => `> **${index + 1}. ${bot.botTag || 'غير معروف'}** (ID: ${bot.botId || 'N/A'})`).join('\n') || '> **لا توجد بيانات بوت.**';
    const embed = new EmbedBuilder()
      .setTitle('تنبيه: إجراء على البوتات خارج السيرفر المصرح')
      .setColor(emco || 0xffffff)
      .setDescription(`${statusLine}\n> **يرجى الالتزام بالسيرفر المصرح به في اشتراكك.**`)
      .addFields(
        { name: 'السيرفر الذي تم التعامل معه', value: `> **${alertInfo.guildName || 'غير معروف'}** ( ${alertInfo.guildId} )` },
        { name: 'السيرفر المصرح به', value: `> **${alertInfo.allowedServerId || 'غير محدد'}**` },
        { name: 'البوتات', value: botsList }
      );
    await sendOwnerDm(user, { embeds: [embed] }, alertInfo.clientOwnerId).catch(() => {});
  } catch {}
}







client.once('ready', () => {
  runtimePreflightChecks();
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(() => { checkSubscriptions().catch(() => {}); }, 30000);
  setInterval(() => { autoTunePerformance(); }, Math.max(5000, Number(config?.performance?.autoTuneIntervalMs ?? 30000)));
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId?.startsWith('unauth:')) return;
  const [ , action, alertId ] = customId.split(':');
  const alertInfo = client.unauthorizedAlerts.get(alertId);
  if (!alertInfo) {
    await interaction.reply({ content: '> **هذا التنبيه لم يعد متاحاً.**', ephemeral: true });
    return;
  }
  const allowed = Array.isArray(owners) ? owners : [];
  if (!allowed.includes(interaction.user.id)) {
    await interaction.reply({ content: '> **ليس لديك صلاحية للتحكم في هذه التنبيهات.**', ephemeral: true });
    return;
  }
  switch (action) {
    case 'leave':
      {
        const ok = await forceLeaveForAlert(alertInfo);
        await notifyClientOwnerOfRemoval(alertInfo, ok);
        await interaction.reply({ content: ok ? '> **تم إخراج جميع البوتات من السيرفر.**' : '> **تعذر إخراج البوتات، حاول لاحقاً.**', ephemeral: true });
        await deleteUnauthorizedOwnerMessages(alertInfo);
        client.unauthorizedAlerts.delete(alertId);
        const key = makeUnauthorizedKey(alertInfo.clientOwnerId, alertInfo.guildId);
        client.unauthorizedIgnores.delete(key);
      }
      break;
    case 'notify':
      {
        const notified = await notifyClientOwnerOfIssue(alertInfo);
        if (notified) {
          alertInfo.lastNotifiedAt = Date.now();
          await updateUnauthorizedAlertMessages(alertInfo);
        }
        await interaction.reply({ content: '> **تم تنبيه العميل.**', ephemeral: true });
      }
      break;
    case 'ignore':
      {
        const key = makeUnauthorizedKey(alertInfo.clientOwnerId, alertInfo.guildId);
        client.unauthorizedIgnores.add(key);
        await interaction.reply({ content: '> **تم التجاهل، لن يتم إرسال تنبيه آخر لهذا السيرفر إلا إذا دخل البوت سيرفر مختلف.**', ephemeral: true });
        await deleteUnauthorizedOwnerMessages(alertInfo);
        client.unauthorizedAlerts.delete(alertId);
      }
      break;
    default:
      await interaction.reply({ content: '> **Unknown action.**', ephemeral: true });
      break;
  }
});

// دالة للتحقق من حالة الاشتراكات
async function checkSubscriptions() {
  let subLock = null;
  try {
    subLock = await storage.acquireLock('checkSubscriptions', 25000);
    if (!subLock) return;

    const logsArray = await storage.getLogs();
    const logChannel = client.channels.cache.find((channel) => channel.id === logChannelId);

    for (let index = logsArray.length - 1; index >= 0; index--) {
      const log = logsArray[index];
      const remainingTime = log.expirationTime - Date.now();
      if (remainingTime > 0) continue;

      const user = client.users.cache.get(log.user);
      if (user) {
        user.send({ files: ['https://cdn.discordapp.com/attachments/1200282105469485146/1224545663732416572/2_days.png?ex=661de205&is=660b6d05&hm=7e492e68b6c46ad87b7e667c3128f6b579e97012f1393bf36083bac17f4819a2&'] }).catch(() => {});

        const mention = `\`🔔\` - **Notice: <@&${Support}> **`;
        const embed = new EmbedBuilder()
          .setTitle('Anend Subscription Details')
          .setThumbnail('https://cdn.discordapp.com/attachments/1091536665912299530/1198777786312163438/deadline.png?ex=65c023d0&is=65adaed0&hm=9a84febd33023bb154c7ba9937d58240f4adbadb3416f7edfc814af816713164&')
          .setDescription(`**UserID:** \`${user.id}\`
**Username:** \`${user.username}\` / <@${user.id}>
**ServerId**: \`${log.server}\`
**Number of Bots:** \`${log.botsCount}\`
**Subscription Time:** \`${log.subscriptionTime}\`
**Expiration Time:** \`${new Date(log.expirationTime).toLocaleString()}\`
**Code:** \`${log.code}\``)
          .setColor(emco);
        logChannel?.send({ content: mention, embeds: [embed] }).catch(() => {});
      }

      logsArray.splice(index, 1);

      const tokensArray = await storage.getTokens();
      const tokensToRemove = tokensArray.filter((tokenEntry) => tokenEntry.code === log.code);
      const botsArray = await storage.getBots();

      tokensToRemove.forEach((tokenEntry) => {
        botsArray.push({ token: tokenEntry.token, Server: null, channel: null, chat: null, status: null, client: null, useEmbeds: false });
      });

      await storage.setBots(botsArray);
      const updatedTokensArray = tokensArray.filter((tokenEntry) => !tokensToRemove.includes(tokenEntry));
      await storage.setTokens(updatedTokensArray);
    }

    await storage.setLogs(logsArray);
  } catch (error) {
    console.error('❌>', error);
  } finally {
    try { await subLock?.release?.(); } catch {}
  }
}




(async () => {
  try {
    await sodium.ready;
  } catch (e) {
    console.warn('libsodium not ready:', e);
  }
  setTimeout(async () => {
    let tokens_data = await storage.getTokens();
    if (!Array.isArray(tokens_data) || !tokens_data[0]) return;

    metrics.subBotsBootRequested += tokens_data.length;

    async function runWithConcurrency(items, limit, fn) {
      const queue = [...items];
      const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) continue;
          try { await fn(item); } catch {}
          if (bootstrapConfig.subBotBootDelayMs > 0) {
            await new Promise((r) => setTimeout(r, bootstrapConfig.subBotBootDelayMs));
          }
        }
      });
      await Promise.all(workers);
    }

    await runWithConcurrency(tokens_data, bootstrapConfig.maxParallelSubBotBoot, async (tokenObj) => {
      if (!tokenObj?.token) return;
      runBotSystem(tokenObj.token);
      metrics.subBotsBooted += 1;
    });
  }, 3000);
})();

async function convert(harinder) {
  try {
    const temperance = await fetch(harinder);
    const myrtte = temperance.url;
    if (myrtte) {
      return `${""}${myrtte}${""}`;
    } else {
      return null;
    }
  } catch (deari) {
    return 0;
  }
}


async function runBotSystem(token) {
  const subBotIntents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ];

  if (!performanceConfig.disableGuildMembersIntent) {
    subBotIntents.push(GatewayIntentBits.GuildMembers);
  }

  const client83883 = new Client(buildClientOptions({
    intents: subBotIntents,
    partials: [Partials.Channel, Partials.GuildMember],
    allowedMentions: {
      parse: ['users'],
      repliedUser: false
    }
  }, true));

  function safeReact(msg, emoji) {
    if (client83883.token) {
      msg.react(emoji).catch(() => {});
    }
  }

  function safeSetUsername(name) {
    if (!client83883.token || !name) return;
    const now = Date.now();
    const limit = 2000;
    if (client83883.__lastNameChange && now - client83883.__lastNameChange < limit) return;
    client83883.__lastNameChange = now;
    return client83883.user.setUsername(String(name).slice(0, 32)).catch(err => {
      if (String(err.code) === '50035') {
        client83883.__lastNameChange = now - limit + 250; // allow retry soon if rate limited
      }
      console.error('❌>', err);
    });
  }

  // Helper to safely read & update this bot's token config
  function getAllTokensSafe() {
    try {
      const raw = fs.readFileSync('./tokens.json', 'utf8');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function updateTokenConfig(updater) {
    const tokens = getAllTokensSafe();
    const idx = tokens.findIndex((t) => t.token === token);
    if (idx === -1) return null;
    const obj = tokens[idx];
    try { updater(obj); } catch {}
    try { fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2)); } catch {}
    return obj;
  }

  // Helper to update all tokens for the same owner+server (group of music bots)
  function updateOwnerServerTokens(ownerId, serverId, updater) {
    const tokens = getAllTokensSafe();
    let changed = false;
    for (const t of tokens) {
      if (t.client === ownerId && t.Server === serverId) {
        try { updater(t); changed = true; } catch {}
      }
    }
    if (changed) {
      try { fs.writeFileSync('./tokens.json', JSON.stringify(tokens, null, 2)); } catch {}
    }
    return changed;
  }

  async function applyPresenceFromConfig(reason = 'manual') {
    try {
      const tokens = getAllTokensSafe();
      const tObj = tokens.find(t => t.token === token);
      const serverId = tObj?.Server;
      const statusRaw = (tObj?.status || 'streaming').toString().toLowerCase();
      const status = ['online', 'idle', 'dnd', 'streaming'].includes(statusRaw) ? statusRaw : 'streaming';
      const g = serverId ? client83883.guilds.cache.get(serverId) : client83883.guilds.cache.first();
      const name = g?.name || 'Music';
      const cleanUrlName = name.replace(/\s+/g, '');

      let presence;
      if (status === 'streaming') {
        presence = {
          activities: [{ name, type: ActivityType.Streaming, url: `https://twitch.tv/${cleanUrlName}` }],
          status: 'online'
        };
      } else {
        presence = {
          activities: [{ name, type: ActivityType.Playing }],
          status
        };
      }

      await client83883.user.setPresence(presence);
      client83883.__lastPresence = {
        reason,
        appliedAt: Date.now(),
        status: presence.status,
        activityType: presence.activities?.[0]?.type || 'unknown'
      };
    } catch (err) {
      try {
        console.error(`[Presence] Failed to apply presence (${reason})`, err?.message || err);
      } catch {}
    }
  }

  let currentConnection;
  function monitorVoice() { /* handled by Lavalink player */ }

  client83883.on('shardDisconnect', async () => {
    try {
      await client83883.destroy();
      await client83883.login(token);
    } catch (err) {
      console.error('Failed to reconnect sub-bot:', err);
    }
  });

  client83883.on('shardError', async () => {
    try {
      await client83883.destroy();
      await client83883.login(token);
    } catch (err) {
      console.error('Failed to recover from shard error:', err);
    }
  });

  client83883.on('invalidated', async () => {
    try {
      await client83883.destroy();
      await client83883.login(token);
    } catch (err) {
      console.error('Failed to recover from invalid session:', err);
    }
  });

  // Presence is applied on ready; shard events only handle reconnection.
 


  // Shoukaku (Lavalink) setup
  const nodeDefs = (config?.lavalink?.nodes || client.config?.lavalink?.nodes || []);
  if (!nodeDefs.length) { try { console.warn('[LL] No lavalink nodes found in config'); } catch {} }
  const nodes = nodeDefs.map(n => ({
    name: n.name,
    url: `${n.host}:${n.port}`,
    auth: n.password,
    secure: !!n.secure,
  }));
  client83883.shoukaku = new Shoukaku(new Connectors.DiscordJS(client83883), nodes, {
    moveOnDisconnect: false,
    reconnectTries: 2,
    reconnectInterval: 8_000,
    resume: true,
    resumeTimeout: 60,
  });
  client83883.queues = new Map(); // guildId -> { player, tracks, current, loop, volume, paused, joining }
  client83883.llReady = false;
  client83883.lastJoinAttempt = new Map();
  // Extra diagnostics
  client83883.shoukaku.on('error', (name, error) => { try { console.error(`[LL:${name}] error:`, error?.message || error); } catch {} });
  client83883.shoukaku.on('close', (name, code, reason) => { try { console.warn(`[LL:${name}] close ${code} ${reason||''}`); client83883.llReady = false; } catch {} });
  client83883.shoukaku.on('disconnect', (name, reason) => { try { console.warn(`[LL:${name}] disconnect ${reason||''}`); client83883.llReady = false; } catch {} });
  client83883.shoukaku.on('debug', (name, info) => { try { console.log(`[LL:${name}]`, info); } catch {} });

  function getBestNode() {
    const nodesArr = Array.from(client83883.shoukaku.nodes?.values?.() || []);
    if (!nodesArr.length) return null;
    const connected = nodesArr.filter((n) => n.state === 'CONNECTED' || n.state === 2);
    const pool = connected.length ? connected : nodesArr;
    pool.sort((a, b) => {
      const aPenalty = Number(a.stats?.cpu?.systemLoad || 0) + Number(a.stats?.players || 0) * 0.015;
      const bPenalty = Number(b.stats?.cpu?.systemLoad || 0) + Number(b.stats?.players || 0) * 0.015;
      return aPenalty - bPenalty;
    });
    return pool[0] || client83883.shoukaku.getIdealNode();
  }

  // When the Lavalink node is ready, auto-join the configured voice channel for this sub-bot
  client83883.shoukaku.on('ready', async (name) => {
    try { console.log(`[LL:${client83883.user?.tag}] Node ready: ${name}`); } catch {}
    client83883.llReady = true;
    try {
      const data = JSON.parse(fs.readFileSync('./tokens.json', 'utf8'));
      const tObj = data.find(t => t.token === token);
      if (!tObj?.Server || !tObj?.channel) return;
      const guild = client83883.guilds.cache.get(tObj.Server);
      const ch = guild?.channels.cache.get(tObj.channel);
      if (guild && ch && ch.joinable) {
        const qguild = client83883.queues.get(guild.id);
        if (!qguild?.player) await ensurePlayer(guild, ch.id).catch((e) => { console.error('[LL] ensurePlayer on ready error:', e?.message || e); });
      }
    } catch {}
  });

  function getGuildQueue(guildId) {
    let q = client83883.queues.get(guildId);
    if (!q) {
      q = { player: null, tracks: [], trackMessages: [], current: null, currentMessage: null, loop: false, volume: getDefaultSubBotVolume(), paused: false, joining: false };
      client83883.queues.set(guildId, q);
    }
    return q;
  }

  async function ensurePlayer(guild, channelId) {
    const node = getBestNode();
    if (!node) throw new Error('No Lavalink node available');
    let q = getGuildQueue(guild.id);
    // Reuse existing manager player if present; if different channel, fully recycle connection
    const managerPlayer = client83883.shoukaku.players.get(guild.id);
    if (managerPlayer) {
      if (managerPlayer.channelId === channelId) {
        q.player = managerPlayer;
        return managerPlayer;
      }
      try { await managerPlayer.disconnect(); } catch {}
      try { await client83883.shoukaku.leaveVoiceChannel?.(guild.id); } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (q.player && q.player.channelId === channelId) return q.player;
    try { console.log(`[LL] ensurePlayer -> guild:${guild.id} channel:${channelId}`); } catch {}
    let player;
    try {
      player = await client83883.shoukaku.joinVoiceChannel({ guildId: guild.id, channelId, shardId: guild.shardId, deaf: true });
    } catch (e) {
      // If another connection exists, reuse it instead of failing
      if (String(e || '').toLowerCase().includes('existing connection')) {
        const reuse = client83883.shoukaku.players.get(guild.id);
        if (reuse) {
          q.player = reuse;
          return reuse;
        }
        // If we can't find it in the manager, just return the current queue player (if any)
        if (q.player) return q.player;
        // No known player to reuse; rethrow so callers don't think a player exists
        throw e;
      }
      throw e;
    }
    try { console.log(`[LL] joined voice -> guild:${guild.id} channel:${channelId}`); } catch {}
    q.player = player;
    // attach listeners once
    if (!player.__bound) {
      player.__bound = true;
      player.on('end', async () => {
        const qq = getGuildQueue(guild.id);
        if (qq.loop && qq.current) qq.tracks.push(qq.current);
        await playNext(guild.id).catch(() => {});
      });
    }
    return player;
  }

  async function playNext(guildId) {
    const q = getGuildQueue(guildId);
    const next = q.tracks.shift();
    const nextMsg = q.trackMessages ? q.trackMessages.shift() : null;
    q.current = next || null;
    q.currentMessage = nextMsg || null;
    if (!next) {
      try { await q.player?.disconnect(); } catch {}
      q.currentMessage = null;
      return;
    }
    try {
      const encoded = next?.encoded || next?.track || next?.encodedTrack;
      if (!encoded) { console.error('Play error: missing encoded track'); return; }
      // Wait until bot is actually in a voice channel to avoid 400 on PATCH
      const desiredChannel = q.player?.channelId;
      let tries = 0;
      while (tries < 10) {
        const inVc = q.player && guildId && q.player.channelId && (q.player.channelId === desiredChannel);
        const me = client83883.guilds.cache.get(guildId)?.members?.me;
        const inDiscordVc = me?.voice?.channelId && desiredChannel && me.voice.channelId === desiredChannel;
        if (inVc && inDiscordVc) break;
        tries++;
        await new Promise(r => setTimeout(r, 150));
      }
      // Retry/backoff if Lavalink says 400 (voice not fully synced yet)
      let attempt = 0;
      let lastErr;
      while (attempt < 5) {
        try {
          await q.player.playTrack({ track: { encoded } });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const is400 = (e && (e.status === 400 || String(e).includes('Bad Request')));
          if (!is400) throw e;
          await new Promise(r => setTimeout(r, 300 + attempt * 250));
          attempt++;
        }
      }
      if (lastErr) throw lastErr;
      // Apply queue volume after playback starts so 50% really is half volume
      if (typeof playerSetVolume === 'function' && typeof q.volume === 'number') {
        try { await playerSetVolume(q.player, q.volume); } catch {}
      }
      await applyAudioQualityFilters(q.player).catch(() => {});
      if (q.currentMessage && q.current && q.current.info) {
        try {
          const title = q.current.info.title || 'Unknown';
          const url = q.current.info.uri || '';
          const durationMs = q.current.info.length || 0;
          if (useEmbeds) {
            const embed = new EmbedBuilder()
              .setAuthor({ name: "♬ Playing song" })
              .setColor(emco)
              .addFields(
                { name: 'Song Name', value: `***Started:* [${title}](${url})**` },
                { name: 'Song Duration', value: `(\`${ms(Number(durationMs) || 0)}\`)` }
              )
              .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169715395293368330/NowPlaying2.png?ex=661835da&is=6605c0da&hm=a9384f57cf29030ccb2d50f7a5de148579a68218812568a5299f08638a9fcc86&")
              .setFooter({ text: client83883.user.username, iconURL: client83883.user.displayAvatarURL() });
            await q.currentMessage.edit({ embeds: [embed], components: [row] }).catch(() => {});
          } else {
            await q.currentMessage.edit({ content: `_Now playing :_ **${title}**`, components: [row] }).catch(() => {});
          }
        } catch {}
      }
    } catch (e) { console.error('Play error:', e); }
  }

  async function resolveTracks(query) {
    const node = getBestNode();
    if (!node) return { tracks: [] };
    let q = query;
    if (!/^https?:\/\//i.test(query)) q = `ytsearch:${query}`;
    const res = await node.rest.resolve(q);
    let tracks = [];
    const lt = res?.loadType;
    if (lt === 'track' && res?.data && (res.data.encoded || res.data.track)) {
      tracks = [res.data.encoded ? res.data : (res.data.track ? res.data.track : res.data)];
    } else if (lt === 'search' && Array.isArray(res?.data)) {
      tracks = res.data;
    } else if (lt === 'playlist' && Array.isArray(res?.data?.tracks)) {
      tracks = res.data.tracks;
    } else if (Array.isArray(res)) {
      tracks = res;
    } else if (Array.isArray(res?.tracks)) {
      tracks = res.tracks;
    } else if (Array.isArray(res?.data?.tracks)) {
      tracks = res.data.tracks;
    } else if (Array.isArray(res?.data)) {
      tracks = res.data;
    } else if (Array.isArray(res?.data?.data)) {
      tracks = res.data.data;
    } else if (res?.data && typeof res.data === 'object') {
      if (res.data.encoded) tracks = [res.data];
      else if (res.data.track) tracks = [res.data.track];
    } else if (res && typeof res === 'object') {
      if (res.encoded) tracks = [res];
      else if (res.track) tracks = [res.track];
    }
    // Fallback: if original input looked like a URL and returned nothing, try a ytsearch
    if (!tracks.length && /^https?:\/\//i.test(query)) {
      try {
        const res2 = await node.rest.resolve(`ytsearch:${query}`);
        const lt2 = res2?.loadType;
        if (lt2 === 'search' && Array.isArray(res2?.data)) tracks = res2.data;
        else if (Array.isArray(res2?.tracks)) tracks = res2.tracks;
        else if (Array.isArray(res2?.data?.tracks)) tracks = res2.data.tracks;
      } catch {}
    }
    if (!tracks.length) {
      try {
        console.log('RESOLVE_DEBUG', {
          input: query,
          loadType: res?.loadType,
          hasTracks: Array.isArray(res?.tracks),
          hasDataArray: Array.isArray(res?.data),
          hasDataTracks: Array.isArray(res?.data?.tracks),
          keys: Object.keys(res || {})
        });
      } catch {}
      return { tracks: [] };
    }
    return { tracks, loadType: res?.loadType, playlistInfo: res?.playlistInfo };
  }

  async function applyAudioQualityFilters(player) {
    if (!player || !audioConfig.applyFilters) return;
    const filtersPayload = {
      equalizer: audioConfig.equalizerPreset,
      timescale: { speed: 1.0, pitch: 1.0, rate: 1.0 },
      volume: 1.0,
    };

    try {
      if (typeof player.setFilters === 'function') {
        await player.setFilters(filtersPayload);
        return;
      }
      if (typeof player.update === 'function') {
        await player.update({ filters: filtersPayload });
      }
    } catch (error) {
      console.warn('[AUDIO] Failed to apply filters:', error?.message || error);
    }
  }


  // Safe wrappers for player controls (supporting different lib variants)
  async function playerSetVolume(player, vol) {
    if (!player) return;
    if (typeof player.setVolume === 'function') return player.setVolume(vol);
    return player.update({ volume: vol });
  }

  async function playerSetPaused(player, paused) {
    if (!player) return;
    if (typeof player.setPaused === 'function') return player.setPaused(paused);
    return player.update({ pause: !!paused });
  }

  async function playerStop(player) {
    if (!player) return;
    if (typeof player.stopTrack === 'function') return player.stopTrack();
    return player.update({ encodedTrack: null });
  }



  const skipButton = new ButtonBuilder()
  .setCustomId('skipButton')
  .setEmoji("⏭️")
  .setStyle(ButtonStyle.Secondary);
const volumeUpButton = new ButtonBuilder()
  .setCustomId('volumeUpButton')
  .setEmoji("🔊")
  .setStyle(ButtonStyle.Secondary);
  const stopButton = new ButtonBuilder()
  .setCustomId('pauseButton')
  .setEmoji("⏯️")  // تغيير الإيموجي للإشارة للإيقاف المؤقت
  .setStyle(ButtonStyle.Secondary);
  const volumeDownButton = new ButtonBuilder()
  .setCustomId('volumeDownButton')
  .setEmoji("🔉")
  .setStyle(ButtonStyle.Secondary);
  const repeatButton = new ButtonBuilder()
  .setCustomId('repeatButton')
  .setEmoji("🔁")
  .setStyle(ButtonStyle.Secondary);
const row = new ActionRowBuilder()


  .addComponents(repeatButton, volumeDownButton, stopButton, volumeUpButton, skipButton);



  
  client83883.lastVolume = getDefaultSubBotVolume();

  client83883.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const q = client83883.queues.get(interaction.guildId);
    if (!q || !q.player) {
      await interaction.reply({ content: '***There is no song currently playing.***', ephemeral: true });
      return;
    }
    const queue = q; // alias for existing logic below
    
    switch (interaction.customId) {
      case 'repeatButton':
        queue.loop = !queue.loop;
        await interaction.reply({ content: `_Repeat mode set to :_ ${queue.loop ? '**ON**' : '**OFF**'}`, ephemeral: true });
        break;
    
      case 'volumeDownButton':
        const newVolumeDown = (queue.volume ?? 50) - 10;
        if (newVolumeDown >= 0) {
          queue.volume = newVolumeDown;
          await playerSetVolume(queue.player, newVolumeDown);
          await interaction.reply({ content: `***ϟ Volume changed from \`${queue.volume}%\` .***`, ephemeral: true });
        } else {
          await interaction.reply({ content: '***Volume cannot be set below 0%.***', ephemeral: true });
        }
        break;
    
      case 'pauseButton':
        if (queue.paused) {
          queue.paused = false;
          await playerSetPaused(queue.player, false);
          await interaction.reply({ content: '***song has resumed.***', ephemeral: true });
        } else {
          queue.paused = true;
          await playerSetPaused(queue.player, true);
          await interaction.reply({ content: '***song has been paused.***', ephemeral: true });
        }
        break;
    
      case 'volumeUpButton':
        const strictCap = Math.max(50, Number(config?.audio?.strictVolumeCap ?? 110));
        const newVolumeUp = (queue.volume ?? 50) + 10;
        if (newVolumeUp <= strictCap) {
          queue.volume = newVolumeUp;
          await playerSetVolume(queue.player, newVolumeUp);
          await interaction.reply({ content: `***volume has been raised to \`${queue.volume}%\` .***`, ephemeral: true });
        } else {
          queue.volume = strictCap;
          await playerSetVolume(queue.player, strictCap);
          await interaction.reply({ content: `***volume is raised to maximum by ${strictCap}%.***`, ephemeral: true });
        }
        break;
    
      case 'skipButton':
        if (!queue.player) {
          await interaction.reply({ content: '*Server queue is empty.*', ephemeral: true });
          return;
        }
        const nextTrackBtn = queue.tracks[0];
        await playerStop(queue.player);
        if (nextTrackBtn) {
          await interaction.reply({ content: `***ϟ Skipped, now playing:** ${nextTrackBtn.info?.title || 'Unknown'}*`, ephemeral: true });
        } else {
          await interaction.reply({ content: '***ϟ Skipped the current song. No more songs in queue.***', ephemeral: true });
        }
        break;
    
      default:
        await interaction.reply({ content: 'الزر غير معرف.', ephemeral: true });
        break;
    }
  });
  







  client83883.on('ready', async () => {
    let newData = tempData.get("bots");
    newData.push(client83883);
    tempData.set(`bots`, newData);

    let botNumber = newData.indexOf(client83883) + 1;
    console.log(`🎶 ${botNumber} > ${client83883.user.username} : ${client83883.guilds.cache.first()?.name}`);

    // Default presence based on By Ahmed status (streaming/server name if not set)
    await applyPresenceFromConfig('ready');

    client.subBotRegistry.set(token, client83883);

    let int = setInterval(async () => {
        let dataRaw;
        try { dataRaw = fs.readFileSync('./tokens.json', 'utf8'); } catch { return; }
        if (!dataRaw) return;
        let data;
        try { data = JSON.parse(dataRaw); } catch { return; }
        tokenObj = data.find((tokenBot) => tokenBot.token == token);
        if (!tokenObj) {
            client83883.destroy?.().catch(() => 0);
            return clearInterval(int);
        };

        let serverID = tokenObj.Server; // استخراج الـ ID للسيرفر من ملف التوكنات

        if (tokenObj.channel) {
            let guild = client83883.guilds.cache.get(serverID);
            if (guild) {
                const desiredChannelId = tokenObj?.channel;
                const meVoiceId = guild?.members?.me?.voice?.channelId || null;
                const qguild = getGuildQueue(guild.id);
                const shouldBeInDesired = !!desiredChannelId && meVoiceId !== desiredChannelId;
                const missingPlayer = !qguild?.player;
                if ((shouldBeInDesired || missingPlayer) && desiredChannelId) {
                    if (!client83883.llReady) return; // wait for node
                    const last = client83883.lastJoinAttempt.get(guild.id) || 0;
                    if (Date.now() - last < 15000 || qguild?.joining) return;
                    let musicChannel = guild.channels.cache.get(desiredChannelId);
                    if (!musicChannel) {
                      try { musicChannel = await guild.channels.fetch(desiredChannelId).catch(() => null); } catch {}
                    }
                    if (musicChannel && musicChannel.joinable) {
                        try { console.log(`[AUTO] enforcing 24/7 -> g:${guild.id} ch:${musicChannel.id} (needsJoin:${shouldBeInDesired} missingPlayer:${missingPlayer})`); } catch {}
                        qguild.joining = true;
                        ensurePlayer(guild, musicChannel.id)
                          .catch((e) => { console.error('[LL:auto] ensurePlayer error:', e?.message || e); })
                          .finally(() => { qguild.joining = false; client83883.lastJoinAttempt.set(guild.id, Date.now()); });
                    } else {
                        try { console.warn(`[AUTO] channel not found or not joinable -> g:${guild.id} ch:${desiredChannelId}`); } catch {}
                    }
                }
            }
        }
    }, 3000);
  });

  client83883.on('guildCreate', async (guild) => {
    const dataRaw = fs.readFileSync('./tokens.json', 'utf8');
    if (!dataRaw) return;
    let data;
    try { data = JSON.parse(dataRaw); } catch { return; }
    const tokenObj = data.find((t) => t.token === token);
    if (!tokenObj) return;
    const allowedServer = tokenObj.Server;
    if (!allowedServer) return;
    if (guild.id === allowedServer) return;
    registerUnauthorizedAlert({
      token,
      guildId: guild.id,
      guildName: guild.name,
      botId: client83883.user?.id,
      botTag: client83883.user?.tag,
      allowedServerId: allowedServer,
      clientOwnerId: tokenObj.client
    });
  });

  client83883.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.id !== client83883.user.id) return;

    let tokens;
    try {
      tokens = JSON.parse(fs.readFileSync('./tokens.json', 'utf8'));
    } catch {
      return;
    }
    const tObj = tokens.find(t => t.token === token);
    if (!tObj || !tObj.channel) return;

    // rejoin configured channel if moved or disconnected
    if (!newState.channel || newState.channelId !== tObj.channel) {
      const desiredId = tObj.channel;
      const target = newState.guild.channels.cache.get(desiredId);
      if (!target) return;

      if (target && target.joinable) {
        const qguild = client83883.queues.get(newState.guild.id);
        if (qguild?.player || qguild?.joining || !client83883.llReady) return;
        try { console.log(`[AUTO:vsu] rejoin -> g:${newState.guild.id} ch:${target.id}`); qguild.joining = true; await ensurePlayer(newState.guild, target.id); } catch (e) { console.error('[AUTO:vsu] ensurePlayer error:', e?.message || e); } finally { qguild.joining = false; }
        try {
          await newState.guild.members.me?.voice.setDeaf(true).catch(() => {});
        } catch {}
      }
      return;
    }

    // ensure the bot stays deafened when joining its configured channel
    try {
      await newState.guild.members.me?.voice.setDeaf(true).catch(() => {});
    } catch (err) {
      console.error('❌>', err);
    }
  });



client83883.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  let dataRaw;
  try { dataRaw = fs.readFileSync('./tokens.json', 'utf8'); } catch { return; }
  if (dataRaw == '' || !dataRaw) return;
  let data;
  try { data = JSON.parse(dataRaw); } catch { return; }
  let tokenObj = data.find((t) => t.token == token);
  if (!data || !tokenObj) return;
  const botId = client83883.user?.id;

  // Mention-based management commands: @Bot help / setup / join / leave / setchat / unchat / setprefix
  const mentionedBot = botId && (message.mentions.has(botId) || message.mentions.has(client83883.user));
  if (mentionedBot) {
    const mentionPattern = new RegExp(`^<@!?${botId}>`, 'i');
    const withoutMention = message.content.replace(mentionPattern, '').trim();
    if (withoutMention.length > 0) {
      const [rawCmd, ...rest] = withoutMention.split(/\s+/);
      const mgmt = (rawCmd || '').toLowerCase();
      const argText = rest.join(' ').trim();

      const guild = message.guild;
      const userVc = message.member?.voice?.channel;

      const replyAr = (ar) => replyArabic(message, ar);

      if (mgmt === 'help') {
        const isClient = tokenObj?.client && tokenObj.client === message.author.id;
        const musicLines = [
          '`play` / `شغل` : **تشغيل الأغاني**',
          '`stop` / `وقف` : **إيقاف التشغيل**',
          '`skip` / `تخطي` : **تخطي الأغنية الحالية**',
          '`volume` / `صوت` : **تعديل مستوى الصوت**',
          '`nowplaying` / `الشغال` : **عرض الأغنية الحالية**',
          '`loop` / `تكرار` : **تكرار الأغنية أو القائمة**',
          '`pause` / `توقيف` / `كمل` : **إيقاف مؤقت أو استئناف**',
          '`queue` / `قائمة` / `اغاني` : **عرض قائمة الانتظار**'
        ].join('\n');
        const managementLines = [
          '**أوامر الإدارة بالمنشن:**',
          '`@Bot help` : **عرض قائمة الأوامر**',
          '`@Bot setup` : **ربط روم الصوت وروم الأوامر وتغيير الاسم**',
          '`@Bot join` : **إدخال البوت رومك الصوتي وتفعيل 24/7**',
          '`@Bot leave` : **إخراج البوت وتعطيل 24/7**',
          '`@Bot setchat` : **تعيين هذا الروم كروم أوامر**',
          '`@Bot unchat` : **إلغاء تقييد روم الأوامر**',
          '`@Bot setprefix <رمز>` : **تغيير بريفكس جميع بوتاتك في السيرفر**',
          '`@Bot setstatus <online|idle|dnd|streaming>` : **تغيير حالة جميع بوتاتك في السيرفر**'
        ].join('\n');
        const description = isClient ? `${musicLines}\n\n${managementLines}` : musicLines;
        const buildEmbed = () => new EmbedBuilder()
          .setTitle('Music & Management Commands')
          .setColor(emco)
          .setDescription(description)
          .setThumbnail(client83883.user.displayAvatarURL())
          .setFooter({ text: client83883.user.username, iconURL: client83883.user.displayAvatarURL() });

        const sendHelpInChannel = async () => {
          let sent;
          if (useEmbeds) {
            sent = await message.reply({ embeds: [buildEmbed()] });
          } else {
            sent = await message.reply(description);
          }
          setTimeout(() => sent?.delete?.().catch(() => {}), 120000);
        };

        const ownerIdForDm = tokenObj?.client || message.author.id;
        const dmPayload = useEmbeds ? { embeds: [buildEmbed()] } : { content: description };
        const dmSent = await sendOwnerDm(message.author, dmPayload, ownerIdForDm).catch(() => null);
        if (dmSent) {
          const confirm = await message.reply('> **تم إرسال الأوامر في الخاص.**').catch(() => null);
          if (confirm) setTimeout(() => confirm.delete().catch(() => {}), 5000);
          return;
        }
        const notifyMsg = await message.reply('> **تعذر إرسال الرسالة في الخاص، يتم إرسال الأوامر في هذه القناة مؤقتاً.**').catch(() => null);
        if (notifyMsg) setTimeout(() => notifyMsg.delete().catch(() => {}), 5000);
        await sendHelpInChannel();
        return;
      }

      if (mgmt === 'setup') {
        if (!userVc) {
          await replyAr('> **يجب أن تكون في روم صوتي لاستخدام هذا الأمر.**');
          return;
        }
        const updated = updateTokenConfig((obj) => {
          obj.channel = userVc.id;
          obj.chat = message.channel.id;
        });
        if (!updated) {
          await replyAr('> **تعذر حفظ إعدادات البوت.**');
          return;
        }
        const q = getGuildQueue(guild.id);
        q.joining = true;
        try { await ensurePlayer(guild, userVc.id); } catch {} finally { q.joining = false; }
        safeSetUsername(userVc.name || guild.name || client83883.user.username);
        await replyAr(`> **تم ربط روم الصوت <#${userVc.id}> وروم الأوامر <#${message.channel.id}> وسيبقى البوت متصلاً 24/7.**`);
        return;
      }

      if (mgmt === 'join') {
        if (!userVc) {
          await replyAr('> **ادخل روم صوتي أولاً ثم استخدم هذا الأمر.**');
          return;
        }
        const updated = updateTokenConfig((obj) => {
          obj.channel = userVc.id;
        });
        if (!updated) {
          await replyAr('> **تعذر تحديث قناة البوت.**');
          return;
        }
        const q = getGuildQueue(guild.id);
        q.joining = true;
        try { await ensurePlayer(guild, userVc.id); } catch {} finally { q.joining = false; }
        safeSetUsername(userVc.name || guild.name || client83883.user.username);
        await replyAr(`> **تم إدخال البوت إلى <#${userVc.id}> وتفعيل 24/7.**`);
        return;
      }

      if (mgmt === 'leave') {
        const q = client83883.queues.get(guild.id);
        if (q?.player) {
          try { await q.player.disconnect(); } catch {}
          q.player = null;
          q.current = null;
          q.tracks = [];
          q.trackMessages = [];
          q.currentMessage = null;
          q.paused = false;
        }
        updateTokenConfig((obj) => { obj.channel = null; });
        await replyAr('> **تم إخراج البوت من الروم وتعطيل 24/7.**');
        return;
      }

      if (mgmt === 'setchat') {
        const updated = updateTokenConfig((obj) => { obj.chat = message.channel.id; });
        if (!updated) {
          await replyAr('> **تعذر حفظ روم الأوامر.**');
          return;
        }
        await replyAr('> **تم تعيين هذا الروم كروم أوامر للبوت.**');
        return;
      }

      if (mgmt === 'unchat') {
        const updated = updateTokenConfig((obj) => { obj.chat = null; });
        if (!updated) {
          await replyAr('> **تعذر إلغاء تقييد روم الأوامر.**');
          return;
        }
        await replyAr('> **تم إلغاء تقييد روم الأوامر، البوت سيرد في أي روم.**');
        return;
      }

      if (mgmt === 'setprefix') {
        const newPrefix = (argText || '').trim();
        if (!newPrefix || newPrefix.length !== 1) {
          await replyAr('> **يرجى إدخال رمز واحد فقط، مثال: `@Bot setprefix !`**');
          return;
        }
        if (message.author.id !== tokenObj.client) {
          await replyAr('> **هذا الأمر مخصص لمالك البوت فقط.**');
          return;
        }
        updateOwnerServerTokens(tokenObj.client, guild.id, (t) => {
          if (!Array.isArray(t.extraPrefixes)) t.extraPrefixes = [];
          if (!t.extraPrefixes.includes(newPrefix)) t.extraPrefixes.push(newPrefix);
        });
        await applyPresenceFromConfig();
        await replyAr(`> **تم إضافة البريفكس \`${newPrefix}\` لجميع البوتات الخاصة بك في هذا السيرفر.**`);
        return;
      }

      if (mgmt === 'setstatus') {
        if (message.author.id !== tokenObj.client) {
          await replyAr('> **هذا الأمر مخصص لمالك البوت فقط.**');
          return;
        }
        const desired = (argText || '').trim().toLowerCase();
        const allowed = ['online', 'idle', 'dnd', 'streaming'];
        if (!allowed.includes(desired)) {
          await replyAr('> **الخيارات المتاحة: `online`, `idle`, `dnd`, `streaming`.**');
          return;
        }
        const changed = updateOwnerServerTokens(tokenObj.client, guild.id, (t) => {
          t.status = desired;
        });
        if (changed) await applyPresenceFromConfig();
        await replyAr(`> **تم تغيير حالة جميع البوتات الخاصة بك في هذا السيرفر إلى \`${desired}\`.**`);
        return;
      }
    }
  }

  // Channel restriction (only after mention commands so management still works)
  if (tokenObj.chat && tokenObj.chat !== message.channel.id) return;

  let args = message.content?.trim().split(' ');
  if (!args || args.length === 0) return;

  const ownerId = tokenObj.client || null;
  let isPrimaryController = false;
  if (ownerId) {
    const tokensAll = getAllTokensSafe();
    const primaryToken = tokensAll.find((t) => t.client === ownerId && t.Server === message.guild.id);
    if (primaryToken && primaryToken.token === token) isPrimaryController = true;
  }
  const cmdsArray = {
    play: ['شغل', 'ش', 'p', 'play', 'P', 'Play'],
    stop: ['stop', 'وقف', 'Stop', 'توقيف'],
    skip: ['skip', 'سكب', 'تخطي', 's', 'س', 'S', 'Skip'],
    volume: ['volume', 'vol', 'صوت', 'v', 'ص', 'V', 'Vol', 'Volume'],
    nowplaying: ['nowplaying', 'np', 'Np', 'Nowplaying', 'الشغال', 'الان'],
    loop: ['loop', 'تكرار', 'l', 'L', 'Loop'],
    pause: ['pause', 'توقيف', 'كمل', 'pa', 'Pa', 'Pause'],
    queue: ['queue', 'قائمة', 'اغاني', 'q', 'qu', 'Q', 'Qu', 'Queue']
  };
  const firstWord = message.content.trim().split(/\s+/)[0].toLowerCase();
  let cmdName = firstWord;
  const tokenExtraPrefixes = Array.isArray(tokenObj.extraPrefixes) ? tokenObj.extraPrefixes.join('') : '';
  const globalPrefixes = typeof prefix === 'string' ? prefix : '';
  const allPrefixes = globalPrefixes + tokenExtraPrefixes;
  if (allPrefixes && allPrefixes.includes(firstWord[0])) {
    cmdName = firstWord.slice(1);
  }

  // Ensure only the intended sub-bot in this guild/channel responds
  if (tokenObj.Server && tokenObj.Server !== message.guild.id) return;
  const userVcId = message.member?.voice?.channelId;
  const desiredVcId = tokenObj.channel;
  const botVcId = message.guild.members.me?.voice?.channelId;
  if (desiredVcId && userVcId && userVcId !== desiredVcId) return;
  if (botVcId && userVcId && botVcId !== userVcId) return;

  // Global management commands via prefix (handled by واحد فقط من البوتات)
  if (isPrimaryController && ownerId && ['allsetchat', 'setprefix', 'setstatus'].includes(cmdName)) {
    if (message.author.id !== ownerId) {
      replyArabic(message, '> **هذا الأمر مخصص لمالك البوت فقط.**');
      return;
    }
    if (cmdName === 'allsetchat') {
      const mentioned = message.mentions.channels.first();
      let targetId = mentioned?.id;
      if (!targetId && args.length > 1) {
        targetId = args[1].replace(/[^0-9]/g, '') || null;
      }
      const targetChannel = targetId ? message.guild.channels.cache.get(targetId) : null;
      if (!targetChannel || (targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildAnnouncement)) {
        replyArabic(message, '> **يرجى تحديد روم كتابي صالح.**');
        return;
      }
      const changed = updateOwnerServerTokens(ownerId, message.guild.id, (t) => { t.chat = targetChannel.id; });
      if (!changed) {
        replyArabic(message, '> **لا يوجد بوتات مرتبطة بهذا السيرفر.**');
      } else {
        replyArabic(message, `> **تم تعيين <#${targetChannel.id}> كروم أوامر لجميع بوتاتك في هذا السيرفر.**`);
      }
      return;
    }

    if (cmdName === 'setprefix') {
      const newPrefix = (args[1] || '').trim();
      if (!newPrefix || newPrefix.length !== 1) {
        replyArabic(message, '> **يرجى إدخال رمز واحد فقط، مثال: `!setprefix -`.**');
        return;
      }
      const changed = updateOwnerServerTokens(ownerId, message.guild.id, (t) => {
        if (!Array.isArray(t.extraPrefixes)) t.extraPrefixes = [];
        if (!t.extraPrefixes.includes(newPrefix)) t.extraPrefixes.push(newPrefix);
      });
      if (!changed) {
        replyArabic(message, '> **لا يوجد بوتات مرتبطة بهذا السيرفر.**');
      } else {
        replyArabic(message, `> **تم إضافة البريفكس \`${newPrefix}\` لجميع بوتاتك في هذا السيرفر.**`);
      }
      return;
    }

    if (cmdName === 'setstatus') {
      const desired = (args[1] || '').trim().toLowerCase();
      const allowed = ['online', 'idle', 'dnd', 'streaming'];
      if (!allowed.includes(desired)) {
        replyArabic(message, '> **الخيارات المتاحة: `online`, `idle`, `dnd`, `streaming`.**');
        return;
      }
      const changed = updateOwnerServerTokens(ownerId, message.guild.id, (t) => {
        t.status = desired;
      });
      if (changed) await applyPresenceFromConfig();
      replyArabic(message, `> **تم تغيير حالة جميع بوتاتك في هذا السيرفر إلى \`${desired}\`.**`);
      return;
    }
  }

  if (cmdsArray.play.some((cmd) => cmdName === cmd)) {
    let song = message.content.split(' ').slice(1).join(' ')
    if (song) {
      const replyPlaying = async (msg, title, url, durationMs) => {
        if (useEmbeds) {
          const embed = new EmbedBuilder()
            .setAuthor({ name: "♬ Playing song" })
            .setColor(emco)
            .addFields(
              { name: 'Song Name', value: `***Started:* [${title}](${url})**` },
              { name: 'Song Duration', value: `(\`${ms(Number(durationMs) || 0)}\`)` }
            )
            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169715395293368330/NowPlaying2.png?ex=661835da&is=6605c0da&hm=a9384f57cf29030ccb2d50f7a5de148579a68218812568a5299f08638a9fcc86&")
            .setFooter({ text: client83883.user.username, iconURL: client83883.user.displayAvatarURL() });
          msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
        } else {
          msg.edit({ content: `_Now playing :_ **${title}**`, components: [row] }).catch(() => {});
        }
      };

      const replyQueued = async (msg, title, durationMs) => {
        if (useEmbeds) {
          const embed = new EmbedBuilder()
            .setAuthor({ name: "ϟ Adding to queue" })
            .setColor(emco)
            .addFields(
              { name: 'Song Name', value: `**${title}**` },
              { name: 'Song Duration', value: `(\`${ms(Number(durationMs) || 0)}\`)` }
            )
            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169710999268491325/NowPlaying.png?ex=661831c2&is=6605bcc2&hm=424be6f47230d31de4600b77810d886fe6f608766ed1b9b89ef08a98a1a9cebc&")
            .setFooter({ text: client83883.user.username, iconURL: client83883.user.displayAvatarURL() });
          msg.edit({ embeds: [embed] }).catch(() => {});
        } else {
          msg.edit({ content: `_Added :_ **${title}**`, components: [row] }).catch(() => {});
        }
      };

      const starter = useEmbeds
        ? await message.reply({ embeds: [new EmbedBuilder().setColor(emco).setDescription(`***ϟ Starting Playing.....***`)] })
        : await message.reply(`_ϟ Starting Playing....._`);

      metrics.playRequests += 1;
      const src = /^https?:\/\//i.test(song) ? song : String(await convert(song) || song);
      if (isBlockedByCompliance(src)) {
        metrics.playBlockedByCompliance += 1;
        const txt = '> **هذا المصدر غير مسموح حسب إعدادات الامتثال (Compliance).**';
        if (useEmbeds) {
          const embed = new EmbedBuilder().setColor(emco).setDescription(txt);
          return starter.edit({ embeds: [embed] }).catch(() => {});
        }
        return starter.edit(txt).catch(() => {});
      }
      const res = await resolveTracks(src);
      if (!res.tracks.length) {
        metrics.playResolveMisses += 1;
        if (useEmbeds) {
          const embed = new EmbedBuilder().setColor(emco).setDescription(`> ♨️ **لم يتم إيجاد نتائج بحث لـ** *${song}*`);
          return starter.edit({ embeds: [embed] }).catch(() => {});
        } else {
          return starter.edit(`> ♨️ **لم يتم إيجاد نتائج بحث لـ** *${song}*`).catch(() => {});
        }
      }
      const guild = message.guild;
      const vcId = message.member?.voice?.channelId;
      if (!vcId) return;
      const q = getGuildQueue(guild.id);
      // Attach this starter message to the track we're about to add
      if (!Array.isArray(q.trackMessages)) q.trackMessages = [];
      if (!q.player) {
        q.joining = true;
        try { await ensurePlayer(guild, vcId); } finally { q.joining = false; }
      }
      q.volume = client83883.lastVolume;
      const list = res.tracks;
      const added = list[0];
      // Consider any existing current track as 'playing' for queuing behavior,
      // so new songs don't interrupt the current one.
      const isPlaying = !!q.current;
      if (isPlaying) {
        q.tracks.push(added);
        q.trackMessages.push(starter);
        await replyQueued(starter, added.info?.title || 'Unknown', added.info?.uri || '', added.info?.length || 0);
      } else {
        q.tracks.push(added);
        q.trackMessages.push(starter);
        await playNext(guild.id);
        await replyPlaying(starter, added.info?.title || 'Unknown', added.info?.uri || '', added.info?.length || 0);
      }
    } else {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setAuthor({ name: "Play command usage:" })
          .setDescription(`***\`play [ title ]\` :** plays first result from **YouTube***.\n***\`play [URL]\` :** searches **YouTube, Spotify**, **SoundCloud***.`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.reply({ embeds: [embed] });
      } else {
        message.reply(`*Play command usage:*\n***play [ title ] :** plays first result from **YouTube***.\n***play [URL]:** searches **YouTube, Spotify**, **SoundCloud***.`);
      }
    }
  } else if (cmdsArray.stop.some((cmd) => cmdName === cmd)) {
    const q = client83883.queues.get(message.guildId);
    if (!q || !q.player) {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`**🎶 There must be music playing to use that!**`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.channel.send({ embeds: [embed] });
      } else {
        message.channel.send(`🎶 There must be music playing to use that!`);
      }
    } else {
      try { await q.player.stopTrack(); } catch {}
      try { await q.player.disconnect(); } catch {}
      q.tracks = []; q.trackMessages = []; q.current = null; q.currentMessage = null; q.player = null; q.paused = false;
    }

    if (useEmbeds) {
      const embed = new EmbedBuilder()
        .setDescription("**ϟ Songs Has Been :** ***Stopped***")
        .setColor(emco)
        .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169710999268491325/NowPlaying.png?ex=65566542&is=6543f042&hm=00a5c0c58c2c36e143b5b778cc3681aea08c75b8458c413133a490343197ec7b&");
      message.reply({ embeds: [embed] });
    } else {
      message.reply("ϟ **Stopped music, and the queue has been cleared**");
    }
  } else if (cmdsArray.loop.some((cmd) => cmdName === cmd)) {
    const q = client83883.queues.get(message.guildId);
    if (!q || !q.player) {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`**🎶 There must be music playing to use that!**`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.channel.send({ embeds: [embed] });
      } else {
        message.channel.send(`🎶 There must be music playing to use that!`);
      }
    } else {
      q.loop = !q.loop;
      const autoplay = q.loop ? 1 : 0;
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`_Repeat mode set to :_ ${autoplay == 1 ? "**ON ..**" : "**OFF ..**"}`)
          .setThumbnail("https://n9.cl/jvbma")
          .setColor(emco);
        message.reply({ embeds: [embed] });
      } else {
        message.reply(`_Repeat mode set to :_ ${autoplay == 1 ? "**ON ..**" : "**OFF ..**"}`);
      }
    }
  } else if (cmdsArray.pause.some((cmd) => cmdName === cmd)) {
    const q = client83883.queues.get(message.guildId);
    if (!q || !q.player) {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`**🎶 There must be music playing to use that!**`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.channel.send({ embeds: [embed] });
      } else {
        message.channel.send(`🎶 There must be music playing to use that!`);
      }
    } else {
      if (q.paused) {
        q.paused = false;
        await playerSetPaused(q.player, false);
        safeReact(message, "▶️");
      } else {
        q.paused = true;
        await playerSetPaused(q.player, true);
        safeReact(message, "⏸️");
      }
    }
  } else if (cmdsArray.nowplaying.some((cmd) => cmdName === cmd)) {
    const q = client83883.queues.get(message.guildId);
    if (!q || !q.player || !q.current) {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`**🎶 There must be music playing to use that!**`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.channel.send({ embeds: [embed] });
      } else {
        message.channel.send(`🎶 There must be music playing to use that!`);
      }
    } else {
      const song = q.current;
      const embed = new EmbedBuilder()
        .setAuthor({ name: 'Playing now', iconURL: client83883.user.displayAvatarURL({ dynamic: true }) })
        .setColor(emco)
        .setDescription(`**[${song.info?.title}](${song.info?.uri})**`)
        .setThumbnail(song.info?.artworkUrl || client83883.user.displayAvatarURL())
        .setFooter({ text: message.author.username, iconURL: message.author.avatarURL() });
      message.channel.send({ embeds: [embed] });
    }
  } else if (cmdsArray.volume.some((cmd) => cmdName === cmd)) {
    const args = message.content.split(' ');
    const q = client83883.queues.get(message.guildId);
    if (!q || !q.player) {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`**🎶 There must be music playing to use that!**`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.reply({ embeds: [embed] });
      } else {
        message.reply(`🎶 There must be music playing to use that!`);
      }
    } else {
      if (!args[1]) {
        if (useEmbeds) {
          const embed = new EmbedBuilder()
            .setDescription(`_🔊 Current volume is :_ **${q?.volume}**`)
            .setColor(emco)
            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1170057890506223647/4f4b99efc0371.png?ex=6557a853&is=65453353&hm=40e45c153b144474c1ca95c2854f3f21933cc20c1d2abc1f0ec1e8945da812ea&");
          message.reply({ embeds: [embed] });
        } else {
          message.reply(`_🔊 Current volume is :_ **${q?.volume}**`);
        }
      } else {
        const volume = parseInt(args[1]);
        if (isNaN(volume) || volume > 150 || volume < 0) {
          if (useEmbeds) {
            const embed = new EmbedBuilder()
              .setDescription(`🚫 Volume must be a valid integer between 0 and 150!`)
              .setColor(emco)
              .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
            message.channel.send({ embeds: [embed] });
          } else {
            message.channel.send(`🚫 Volume must be a valid integer between 0 and 150!`);
          }
        } else {
          client83883.lastVolume = volume;
          q.volume = volume;
          await playerSetVolume(q.player, volume);
          if (useEmbeds) {
            const embed = new EmbedBuilder()
              .setDescription(`***ϟ Volume changed from \`${volume}%\` .***`)
              .setColor(emco)
              .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1170057890506223647/4f4b99efc0371.png?ex=6557a853&is=65453353&hm=40e45c153b144474c1ca95c2854f3f21933cc20c1d2abc1f0ec1e8945da812ea&");
            message.reply({ embeds: [embed] });
          } else {
            message.reply(`*ϟ Volume changed from **\`${volume}%\`** .*`);
          }
        }
      }
    }
  } else if (cmdsArray.skip.some((cmd) => cmdName === cmd)) {
    const q = client83883.queues.get(message.guildId);
    if (!q || !q.player) return message.reply(`🎶 There must be music playing to use that!`);
    try {
      const prev = q.current;
      await playerStop(q.player);
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`***ϟ Skipped ${prev?.info?.title || 'song'}***`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169738053892460724/d4c0f597a003.png?ex=65567e74&is=65440974&hm=6bd3d52f027ee8c6803aa37dfd9702da63240c152a8c19a4c0a944a69e2fc890&");
        message.channel.send({ embeds: [embed] });
      } else {
        message.channel.send(`_skipped_`);
      }
    } catch (e) {
      if (`${e}`.includes("NO_UP_NEXT")) {
        try { await q.player.stopTrack(); } catch {}
        safeReact(message, `✅`);
      } else {
        if (useEmbeds) {
          const embed = new EmbedBuilder()
            .setColor(emco)
            .setDescription(`***ϟ Error***`);
          message.channel.send({ embeds: [embed] });
        } else {
          message.channel.send(`***ϟ Error***`);
        }
      }
    }
  } else if (cmdsArray.queue.some((cmd) => cmdName === cmd)) {
    const q = client83883.queues.get(message.guildId);
    if (!q || (!q.player && !q.current && !q?.tracks?.length)) {
      if (useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(`**🎶 There must be music playing to use that!**`)
          .setColor(emco)
          .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169712150130995220/no.png?ex=65566654&is=6543f154&hm=b95ef265828fafc88f4adc56d7ba9f07d44557c4ce8796c790313d889040eafb&");
        message.reply({ embeds: [embed] });
      } else {
        message.reply(`🎶 There must be music playing to use that!`);
      }
      return;
    }
    const list = [q.current, ...q.tracks].filter(Boolean);
    const songNames = list.map((t, index) => `\`${index + 1}\`. ${t.info?.title || 'Unknown'}`).join('\n');

    if (useEmbeds) {
      const embed = new EmbedBuilder()
        .setAuthor({ name: `ϟ Total songs :  ( ${list.length} )` })
        .setDescription(`*Now playing :* \n${songNames}`)
        .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1169715395293368330/NowPlaying2.png?ex=6556695a&is=6543f45a&hm=6e62a05e091aedec594efe90190303f0f3fd9734c071c15403350773af9f4cc1&")
        .setColor(emco)
        .setFooter({ text: `${client83883.user.username}`, iconURL: `${client83883.user.displayAvatarURL({ dynamic: true })}` });
      message.channel.send({ embeds: [embed] });
    } else {
      message.channel.send(`*Now playing :*\n${songNames}`);
    }
  }
});

  try {
    await client83883.login(token);
  } catch (e) {
    console.log(`❌ > ${token} ${e}`);
  }
};




process.on("uncaughtException", console.log);
process.on("unhandledRejection", console.log);
process.on("rejectionHandled", console.log);
