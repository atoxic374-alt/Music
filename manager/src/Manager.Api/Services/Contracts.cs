namespace Manager.Api.Services;

public sealed record NodeSnapshot(string NodeId, double CpuPercent, double MemoryPercent, double RttMs, double PacketLossPercent, bool Healthy);
public sealed record NodeHeartbeat(double CpuPercent, double MemoryPercent, double RttMs, double PacketLossPercent, DateTimeOffset TimestampUtc);
public sealed record PlaySessionRequest(string BotId, string GuildId, string TrackUrl, string Platform, DateTimeOffset RequestedAtUtc);
public sealed record NodeCommand(string CommandId, string NodeId, string Kind, string PayloadJson, DateTimeOffset CreatedAtUtc);

public interface INodeRegistry
{
    IReadOnlyCollection<NodeSnapshot> GetNodes();
    void UpsertHeartbeat(string nodeId, NodeHeartbeat heartbeat);
}

public interface ILoadBalancer
{
    NodeSnapshot? PickBestNode();
}

public interface ISubscriptionService
{
    Task<bool> CanPlayAsync(string botId, string guildId, CancellationToken cancellationToken);
}

public interface IFailoverCoordinator
{
    Task<int> MigrateSessionsAsync(string failedNodeId, CancellationToken cancellationToken);
}

public interface ICommandBus
{
    Task<string> EnqueueNodeCommandAsync(NodeCommand command, CancellationToken cancellationToken);
}
