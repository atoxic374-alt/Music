# Distributed Music Infrastructure (C# + Rust)

هذا المستند يحدد تصميم نظام تشغيل موسيقى موزّع عالي الأداء يدعم آلاف البوتات، مع استبدال Lavalink بالكامل.

## 1) البنية العامة

- **Central Manager (.NET 8 / C#)**
  - استقبال أوامر Discord من طبقة البوتات.
  - إدارة Tokens + الاشتراكات + صلاحية التشغيل.
  - توزيع الجلسات على Audio Nodes عبر خوارزمية Dynamic Load Balancing.
  - مراقبة صحة العقد (Health + Heartbeats).
  - إدارة الترحيل التلقائي عند سقوط أي Node (Auto-Healing).
  - إرسال أوامر التشغيل عبر **Redis Streams** بدلاً من Pub/Sub لضمان التسليم.

- **Audio Nodes (Rust)**
  - تشغيل/معالجة الصوت منخفضة الاستهلاك.
  - **Opus Direct Pass-through** عند توفر source Opus-compatible لتجنب إعادة التشفير.
  - Jitter Buffer + Packet Loss Concealment hooks.
  - Zero-copy buffers حيثما أمكن (Bytes/Arc slices).
  - **IPv6 Rotator** لتبديل IP المصدر في طلبات fetch وتقليل خطر 429.
  - **Dynamic Extractor Plugins** (مثل yt-dlp) قابلة للتحديث السريع.

- **Gateway Proxy Cluster**
  - مجموعة Proxies بدل proxy وحيد لمنع SPOF.
  - تسجيل heartbeat لكل Proxy في Redis.
  - Shard routing عبر Rendezvous hashing لضمان توزيع ثابت.

- **Security Layer**
  - JWT auth بين Manager <-> Node (قابل للاستبدال بـ mTLS لاحقاً).
  - توثيق أوامر العقدة ومنع الطلبات غير المصرح بها.

- **Observability**
  - Prometheus metrics من Manager و Nodes و Gateway Proxy.
  - Grafana dashboards: active sessions, packet loss, node RTT, memory/bot.

## 2) مسار البيانات

1. Discord command -> Manager.
2. Manager يتحقق من الاشتراك + token state من Redis/DB.
3. Manager يختار Node (أقل ضغط + latency + packet-loss score).
4. Manager يضيف play command إلى Redis Stream.
5. Node consumer-group يقرأ الأمر بشكل موثوق.
6. Node ينفذ extractor pipeline ويطبق IPv6 rotation عند fetch.
7. Node يبدأ stream مع Opus pass-through إن أمكن.
8. عند failure: Manager ينفذ migrate session إلى Node بديل.

## 3) التوسّع و التوازن الديناميكي

**Node score** = (CPU * 0.45) + (Mem * 0.25) + (RTT * 0.20) + (PacketLoss * 0.10)

- يتم اختيار أقل score متاح.
- منع تكدس مفاجئ عبر soft-cap + cool-down لكل Node.
- دعم weighted routing (مثال: Nodes أقوى تاخذ وزن أعلى).

## 4) خطط الاختبارات الأساسية

- **Memory Profiling**: قياس استهلاك الذاكرة لكل bot instance (الهدف < 5MB).
- **CPU Stress (1000 bots)**: محاكاة متوازية وتشغيل audio sessions.
- **Latency (<100ms)**: من لحظة الأمر إلى أول packet صوت.
- **Packet Loss Handling**: tc/netem (Linux) لاختبار jitter/loss.
- **Jitter Buffer Test**: قياس ثبات الصوت عند تأخر الحزم.
- **Memory Leak Audit**: soak test طويل + heap snapshots.

## 5) إلغاء Lavalink

- لا يوجد أي اعتماد على Lavalink.
- كامل orchestration موجود داخل Manager.
- عقد الصوت Rust native.
