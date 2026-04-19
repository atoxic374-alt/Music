using Manager.Api.Storage;

namespace Manager.Api.Services;

public sealed class RedisStreamCommandBus(RedisClient redisClient) : ICommandBus
{
    private const string StreamKey = "music:commands:stream";

    public async Task<string> EnqueueNodeCommandAsync(NodeCommand command, CancellationToken cancellationToken)
    {
        var values = new Dictionary<string, string>
        {
            ["command_id"] = command.CommandId,
            ["node_id"] = command.NodeId,
            ["kind"] = command.Kind,
            ["payload"] = command.PayloadJson,
            ["created_at"] = command.CreatedAtUtc.ToUnixTimeMilliseconds().ToString()
        };

        var id = await redisClient.AppendStreamAsync(StreamKey, values);
        return id.ToString();
    }
}
