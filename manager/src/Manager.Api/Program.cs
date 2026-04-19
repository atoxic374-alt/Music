using System.Text;
using Manager.Api.Services;
using Manager.Api.Storage;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Prometheus;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<INodeRegistry, InMemoryNodeRegistry>();
builder.Services.AddSingleton<ILoadBalancer, WeightedLoadBalancer>();
builder.Services.AddSingleton<ISubscriptionService, RedisSubscriptionService>();
builder.Services.AddSingleton<IFailoverCoordinator, FailoverCoordinator>();
builder.Services.AddSingleton<ICommandBus, RedisStreamCommandBus>();

var redisConnection = builder.Configuration.GetValue<string>("Redis:Connection") ?? "localhost:6379";
builder.Services.AddSingleton(new RedisClient(redisConnection));

var jwtKey = builder.Configuration.GetValue<string>("Security:NodeJwtKey") ?? "replace-me-with-long-secret";
var jwtIssuer = builder.Configuration.GetValue<string>("Security:Issuer") ?? "music-manager";
var jwtAudience = builder.Configuration.GetValue<string>("Security:Audience") ?? "audio-node";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseHttpMetrics();

var activeSessionsGauge = Metrics.CreateGauge("music_active_sessions", "Current active voice sessions.");

app.MapPost("/v1/play", async (PlayCommand cmd, ISubscriptionService subscriptionService, ILoadBalancer balancer, ICommandBus commandBus) =>
{
    var allowed = await subscriptionService.CanPlayAsync(cmd.BotId, cmd.GuildId, CancellationToken.None);
    if (!allowed)
    {
        return Results.Forbid();
    }

    var node = balancer.PickBestNode();
    if (node is null)
    {
        return Results.Problem("No healthy audio node available", statusCode: 503);
    }

    var session = new PlaySessionRequest(cmd.BotId, cmd.GuildId, cmd.TrackUrl, cmd.Platform, cmd.RequestedAtUtc);
    var commandId = await commandBus.EnqueueNodeCommandAsync(
        new NodeCommand(Guid.NewGuid().ToString("N"), node.NodeId, "play", System.Text.Json.JsonSerializer.Serialize(session), DateTimeOffset.UtcNow),
        CancellationToken.None);

    activeSessionsGauge.Inc();

    return Results.Ok(new
    {
        selectedNode = node.NodeId,
        strategy = "dynamic-load-balancing",
        commandId,
        transport = "redis-streams",
        session
    });
});

app.MapPost("/v1/nodes/{nodeId}/heartbeat", (string nodeId, NodeHeartbeat heartbeat, INodeRegistry registry) =>
{
    registry.UpsertHeartbeat(nodeId, heartbeat);
    return Results.Accepted();
}).RequireAuthorization();

app.MapPost("/v1/nodes/{nodeId}/failed", async (string nodeId, IFailoverCoordinator failover) =>
{
    var moved = await failover.MigrateSessionsAsync(nodeId, CancellationToken.None);
    return Results.Ok(new { movedSessions = moved });
}).RequireAuthorization();

app.MapMetrics();
app.Run();

public sealed record PlayCommand(string BotId, string GuildId, string TrackUrl, string Platform, DateTimeOffset RequestedAtUtc);
