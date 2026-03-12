# Music

بوت إدارة متعدد (Multi-bot) للموسيقى على Discord مع دعم Lavalink + Sharding + ضبط تلقائي للأداء.

## ✅ تم تنفيذ طلبك
- **لا حاجة Redis أو Postgres**: النظام الآن يعمل افتراضيًا على تخزين JSON محلي مجاني 100%.
- **الضبط صار تلقائي بالكامل**: الإقلاع المتوازي، تأخير الإقلاع، وحدود الأداء يتم ضبطها تلقائيًا حسب CPU/RAM في السيرفر.
- **يوتيوب مسموح افتراضيًا**.

---

## إعداد سريع من الصفر

## 1) المتطلبات
- Node.js 18 أو 20
- Docker (اختياري لكنه الأفضل لتشغيل Lavalink)
- توكن بوت Discord

## 2) تثبيت الحزم
```bash
npm install
```

## 3) ملف `.env`
أنشئ ملف `.env` في جذر المشروع:
```env
DISCORD_TOKEN=PUT_YOUR_MAIN_BOT_TOKEN_HERE
```

## 4) تعديل `config.json`
- `owners`: ضع Discord IDs للإدارة.
- `prefix`: بادئة الأوامر.
- `lavalink.nodes`: عدّل بيانات نود Lavalink.

> التخزين الافتراضي الآن:
```json
"storage": {
  "provider": "json"
}
```

## 5) تشغيل Lavalink (محلي مجاني)
```bash
docker run -d --name lavalink \
  -p 2333:2333 \
  -e SERVER_PORT=2333 \
  -e LAVALINK_SERVER_PASSWORD=CHANGE_ME \
  ghcr.io/lavalink-devs/lavalink:4
```

ثم طابق كلمة المرور في `config.json`.

## 6) تشغيل البوت
```bash
npm start
```

## 7) التحقق
```bash
curl http://127.0.0.1:30000/healthz
curl http://127.0.0.1:30000/metrics
```

---

## كيف يعمل الضبط التلقائي الآن؟
- عند تشغيل البوت، يتم حساب بروفايل تلقائي حسب موارد الجهاز:
  - `maxParallelSubBotBoot`
  - `subBotBootDelayMs`
  - حدود التحمل للذاكرة
- Auto-tune يستمر أثناء التشغيل ويعدل القيم تلقائيًا كل فترة.
- لا تحتاج أوامر يدوية لرفع/خفض الأداء في الوضع الطبيعي.

---


## بديل مجاني قوي بدون Lavalink (مؤقت)
إذا لا تريد تشغيل Lavalink حاليًا، تقدر تستخدم تشغيل محلي عبر مكتبة **DisTube** (بدون سيرفر صوت خارجي):

```bash
npm run start:distube
```

- هذا الوضع مجاني بالكامل ويشتغل مباشرة بعد وضع `DISCORD_TOKEN`.
- يدعم أوامر أساسية: `play`, `skip`, `stop`, `pause`, `resume`, `volume`, `queue`, `np`.
- يبقى نظام Lavalink الحالي موجود كخيار يدوي (`npm run start:lavalink`).

---


## أوامر التشغيل
```bash
npm start          # Distube (default)
npm run start:lavalink
npm run start:single
```
