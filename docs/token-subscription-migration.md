# Token & Subscription Migration (Node.js -> C#)

## Mapping

- Node.js middleware للتحقق من الاشتراك -> `ISubscriptionService` في C#.
- cache keys في Redis:
  - `sub:{botId}:{guildId}` حالة الاشتراك.
  - `voice:session:{guildId}` حالة الجلسة النشطة.
  - `node:lease:{botId}` العقدة الحالية للبوت.

## Redis Streams بدلاً من Pub/Sub

- stream key: `music:commands:stream`.
- كل أمر تشغيل يحمل `command_id`, `node_id`, `kind`, `payload`.
- Node consumers تقرأ عبر consumer groups لضمان عدم ضياع الرسائل عند الانقطاع.

## Security

- JWT بين Manager وNodes (Authorization: Bearer <token>).
- لاحقاً يمكن ترقية القناة إلى mTLS داخل private network.

## Redis TTL Strategy

- subscription cache: 5 دقائق.
- voice session state: 30 ثانية (تحديث heartbeat).
- node lease lock: 15 ثانية.

## Failover

1. Manager يستقبل `node failed`.
2. قراءة كل `voice:session:*` المرتبطة بالعقدة.
3. إعادة اختيار node جديدة عبر `WeightedLoadBalancer`.
4. إرسال resume offset إلى العقدة الجديدة.
