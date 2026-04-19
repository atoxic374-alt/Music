import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 1000,
  duration: '30s',
};

export default function () {
  const payload = JSON.stringify({
    botId: `bot-${__VU}`,
    guildId: `guild-${__VU}`,
    trackUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
    platform: 'youtube',
    requestedAtUtc: new Date().toISOString(),
  });

  http.post('http://localhost:8080/v1/play', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  sleep(1);
}
