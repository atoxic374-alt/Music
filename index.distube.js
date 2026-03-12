const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const express = require('express');

const config = require('./config.json');
const { getRuntimeToken } = require('./lib/runtimeToken');

const prefix = config?.prefix || '!';
const emco = config?.emco || '#7B7884';
const useEmbeds = config?.useEmbeds !== false;

const app = express();
const metrics = {
  startedAt: Date.now(),
  playRequests: 0,
  errors: 0,
};

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    backend: 'distube',
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    startedAt: new Date(metrics.startedAt).toISOString(),
  });
});

app.get('/metrics', (req, res) => {
  const lines = [
    `music_started_at_ms ${metrics.startedAt}`,
    `music_play_requests_total ${metrics.playRequests}`,
    `music_distube_errors_total ${metrics.errors}`,
  ];
  res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n'));
});

app.listen(30001, () => {
  console.log('[DisTube] metrics server started on :30001');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  plugins: [
    new SpotifyPlugin(),
    new SoundCloudPlugin(),
    new YtDlpPlugin(),
  ],
});

function sendReply(message, text) {
  if (!useEmbeds) return message.reply(text);
  const embed = new EmbedBuilder().setColor(emco).setDescription(text);
  return message.reply({ embeds: [embed] });
}

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();

  try {
    if (['play', 'p', 'شغل', 'ش'].includes(cmd)) {
      const query = args.join(' ').trim();
      if (!query) return sendReply(message, '**اكتب اسم/رابط المقطع بعد الأمر.**');
      const voice = message.member?.voice?.channel;
      if (!voice) return sendReply(message, '**ادخل روم صوتي أولاً.**');
      metrics.playRequests += 1;
      await distube.play(voice, query, { textChannel: message.channel, member: message.member });
      return;
    }

    if (['skip', 'تخطي'].includes(cmd)) {
      await distube.skip(message);
      return sendReply(message, '**تم تخطي المقطع.**');
    }

    if (['stop', 'leave', 'وقف'].includes(cmd)) {
      distube.stop(message);
      return sendReply(message, '**تم إيقاف التشغيل والخروج من الروم.**');
    }

    if (['pause', 'ايقاف'].includes(cmd)) {
      distube.pause(message);
      return sendReply(message, '**تم إيقاف الصوت مؤقتًا.**');
    }

    if (['resume', 'كمل'].includes(cmd)) {
      distube.resume(message);
      return sendReply(message, '**تم استكمال التشغيل.**');
    }

    if (['volume', 'vol', 'صوت'].includes(cmd)) {
      const v = Number(args[0]);
      if (!Number.isFinite(v)) return sendReply(message, '**اكتب رقم الصوت (1-150).**');
      const volume = Math.max(1, Math.min(150, Math.floor(v)));
      distube.setVolume(message, volume);
      return sendReply(message, '**تم ضبط الصوت إلى `' + volume + '%`**');
    }

    if (['np', 'nowplaying', 'الان'].includes(cmd)) {
      const queue = distube.getQueue(message);
      if (!queue?.songs?.[0]) return sendReply(message, '**لا يوجد شيء شغال الآن.**');
      const s = queue.songs[0];
      return sendReply(message, `**الآن:** ${s.name}\\n**المدة:** ${s.formattedDuration}`);
    }

    if (['queue', 'q', 'طابور'].includes(cmd)) {
      const queue = distube.getQueue(message);
      if (!queue?.songs?.length) return sendReply(message, '**الطابور فارغ.**');
      const lines = queue.songs.slice(0, 10).map((s, i) => `${i + 1}) ${s.name}`).join('\\n');
      return sendReply(message, `**الطابور:**\\n${lines}`);
    }
  } catch (err) {
    metrics.errors += 1;
    return sendReply(message, `**حدث خطأ:** ${err?.message || err}`);
  }
});

distube
  .on('playSong', (queue, song) => {
    queue.textChannel.send('▶️ Now Playing: **' + song.name + '** - `' + song.formattedDuration + '`').catch(() => {});
  })
  .on('addSong', (queue, song) => {
    queue.textChannel.send(`➕ Added: **${song.name}**`).catch(() => {});
  })
  .on('error', (channel, error) => {
    metrics.errors += 1;
    if (channel?.send) channel.send(`❌ ${error?.message || error}`).catch(() => {});
  });

const token = getRuntimeToken();
if (!token) {
  console.error('Missing token. Set DISCORD_TOKEN');
  process.exit(1);
}

client.login(token);
