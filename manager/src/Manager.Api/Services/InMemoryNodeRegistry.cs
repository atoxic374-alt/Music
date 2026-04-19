using System.Collections.Concurrent;

namespace Manager.Api.Services;

public sealed class InMemoryNodeRegistry : INodeRegistry
{
    private readonly ConcurrentDictionary<string, NodeSnapshot> _nodes = new();

    public IReadOnlyCollection<NodeSnapshot> GetNodes() => _nodes.Values;

    public void UpsertHeartbeat(string nodeId, NodeHeartbeat heartbeat)
    {
        var snapshot = new NodeSnapshot(
            nodeId,
            heartbeat.CpuPercent,
            heartbeat.MemoryPercent,
            heartbeat.RttMs,
            heartbeat.PacketLossPercent,
            Healthy: DateTimeOffset.UtcNow - heartbeat.TimestampUtc < TimeSpan.FromSeconds(10));

        _nodes.AddOrUpdate(nodeId, snapshot, (_, _) => snapshot);
    }
}
