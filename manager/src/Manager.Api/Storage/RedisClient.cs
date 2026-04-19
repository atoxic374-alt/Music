using StackExchange.Redis;

namespace Manager.Api.Storage;

public sealed class RedisClient
{
    private readonly ConnectionMultiplexer _connection;

    public RedisClient(string connectionString)
    {
        _connection = ConnectionMultiplexer.Connect(connectionString);
    }

    public async Task<string?> GetStringAsync(string key)
    {
        var db = _connection.GetDatabase();
        var value = await db.StringGetAsync(key);
        return value.HasValue ? value.ToString() : null;
    }

    public Task SetStringAsync(string key, string value, TimeSpan ttl)
    {
        var db = _connection.GetDatabase();
        return db.StringSetAsync(key, value, ttl);
    }

    public Task<RedisValue> AppendStreamAsync(string key, IReadOnlyDictionary<string, string> fields)
    {
        var db = _connection.GetDatabase();
        var entries = fields.Select(kv => new NameValueEntry(kv.Key, kv.Value)).ToArray();
        return db.StreamAddAsync(key, entries);
    }
}
