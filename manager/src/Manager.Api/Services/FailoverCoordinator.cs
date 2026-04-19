namespace Manager.Api.Services;

public sealed class FailoverCoordinator(INodeRegistry registry) : IFailoverCoordinator
{
    public Task<int> MigrateSessionsAsync(string failedNodeId, CancellationToken cancellationToken)
    {
        // Placeholder: in production, read active sessions for failedNodeId from Redis
        // and reassign each to the best node while preserving player offset.
        var available = registry.GetNodes().Count(n => n.Healthy && n.NodeId != failedNodeId);
        return Task.FromResult(available == 0 ? 0 : 1);
    }
}
