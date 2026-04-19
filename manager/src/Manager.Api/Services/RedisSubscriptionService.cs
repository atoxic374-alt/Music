using Manager.Api.Storage;

namespace Manager.Api.Services;

public sealed class RedisSubscriptionService(RedisClient redisClient) : ISubscriptionService
{
    public async Task<bool> CanPlayAsync(string botId, string guildId, CancellationToken cancellationToken)
    {
        var subscriptionKey = $"sub:{botId}:{guildId}";
        var cached = await redisClient.GetStringAsync(subscriptionKey);

        if (string.Equals(cached, "active", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // Hook for migrated Node.js business rules.
        await redisClient.SetStringAsync(subscriptionKey, "active", TimeSpan.FromMinutes(5));
        return true;
    }
}
