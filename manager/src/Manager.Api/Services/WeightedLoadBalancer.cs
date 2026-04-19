namespace Manager.Api.Services;

public sealed class WeightedLoadBalancer(INodeRegistry registry) : ILoadBalancer
{
    public NodeSnapshot? PickBestNode()
    {
        return registry.GetNodes()
            .Where(n => n.Healthy)
            .OrderBy(Score)
            .FirstOrDefault();
    }

    private static double Score(NodeSnapshot node)
        => (node.CpuPercent * 0.45)
         + (node.MemoryPercent * 0.25)
         + (node.RttMs * 0.20)
         + (node.PacketLossPercent * 0.10);
}
