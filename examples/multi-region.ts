/**
 * Multi-region example: Connect to workers across multiple regions
 * and auto-route transactions to the closest region to the current
 * Solana leader validator.
 *
 * MultiRegionClient uses leader hints to dynamically switch regions,
 * ensuring each transaction is sent from the lowest-latency worker.
 *
 * Usage:
 *   npx ts-node examples/multi-region.ts
 */

import {
  MultiRegionClient,
  configBuilder,
  RoutingRecommendation,
} from '@allenhark/slipstream';

async function main() {
  const config = configBuilder()
    .apiKey('sk_live_your_key_here')
    .leaderHints(true)
    .minConfidence(60)
    .build();

  // Auto-discover all regions and connect
  const multi = await MultiRegionClient.connect(config, {
    autoFollowLeader: true,     // Switch region when leader changes
    minSwitchConfidence: 70,    // Only switch on high-confidence hints
    switchCooldownMs: 5000,     // Wait 5s between region switches
    broadcastHighPriority: false,
    maxBroadcastRegions: 3,
  });

  console.log('Connected regions:', multi.connectedRegions().join(', '));

  // Listen for routing updates (fires when best region changes)
  multi.on('routingUpdate', (routing: RoutingRecommendation) => {
    console.log(`[Routing] region=${routing.bestRegion} ` +
      `leader=${routing.leaderPubkey?.slice(0, 8)}... ` +
      `confidence=${routing.confidence}% ` +
      `rtt=${routing.expectedRttMs}ms`);
    console.log(`  Fallbacks: ${routing.fallbackRegions.join(', ')}`);
  });

  // Submit transactions -- they auto-route to the best region
  const fakeTx = new Uint8Array(256); // Replace with real signed transaction
  const result = await multi.submitTransaction(fakeTx);
  console.log(`Submitted: ${result.transactionId} (status: ${result.status})`);

  // Check current routing decision
  const routing = multi.getCurrentRouting();
  if (routing) {
    console.log(`\nCurrent routing: ${routing.bestRegion} (slot ${routing.slot})`);
  }

  // Keep running to observe routing changes
  console.log('\nWatching routing changes... (Ctrl+C to stop)');

  // Periodically submit to see routing in action
  const interval = setInterval(async () => {
    try {
      const r = await multi.submitTransaction(fakeTx);
      const region = r.routing?.region ?? 'unknown';
      console.log(`TX ${r.transactionId.slice(0, 8)}... -> ${region}`);
    } catch (err) {
      console.error('Submit failed:', (err as Error).message);
    }
  }, 2000);

  // Clean up on exit
  process.on('SIGINT', async () => {
    clearInterval(interval);
    await multi.disconnectAll();
    process.exit(0);
  });
}

main().catch(console.error);
