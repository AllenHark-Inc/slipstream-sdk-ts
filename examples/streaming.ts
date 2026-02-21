/**
 * Streaming example: Subscribe to leader hints, tip instructions,
 * and priority fee updates via WebSocket.
 *
 * Streams are delivered in real-time over the WebSocket connection.
 * Leader hints arrive every ~250ms, tips on change or every 1s,
 * and priority fees every 1s.
 *
 * Usage:
 *   npx ts-node examples/streaming.ts
 */

import {
  SlipstreamClient,
  configBuilder,
  LeaderHint,
  TipInstruction,
  PriorityFee,
} from '@allenhark/slipstream';

async function main() {
  // Enable all streams via config
  const client = await SlipstreamClient.connect(
    configBuilder()
      .apiKey('sk_live_your_key_here')
      .leaderHints(true)
      .streamTipInstructions(true)
      .streamPriorityFees(true)
      .build()
  );

  // Leader hints: which region is closest to the current Solana leader
  client.on('leaderHint', (hint: LeaderHint) => {
    console.log(`[Leader Hint] slot=${hint.slot} region=${hint.preferredRegion} ` +
      `confidence=${hint.confidence}% rtt=${hint.metadata.tpuRttMs}ms`);

    if (hint.backupRegions.length > 0) {
      console.log(`  Backups: ${hint.backupRegions.join(', ')}`);
    }

    if (hint.metadata.regionRttMs) {
      for (const [region, rtt] of Object.entries(hint.metadata.regionRttMs)) {
        console.log(`  ${region}: ${rtt}ms`);
      }
    }
  });

  // Tip instructions: wallet + amount for streaming tip mode
  client.on('tipInstruction', (tip: TipInstruction) => {
    console.log(`[Tip] sender=${tip.senderName} wallet=${tip.tipWalletAddress} ` +
      `amount=${tip.tipAmountSol} SOL tier=${tip.tipTier} ` +
      `latency=${tip.expectedLatencyMs}ms confidence=${tip.confidence}% ` +
      `validUntil=${tip.validUntilSlot}`);

    for (const alt of tip.alternativeSenders) {
      console.log(`  Alt: ${alt.sender} @ ${alt.tipAmountSol} SOL (${alt.confidence}%)`);
    }
  });

  // Priority fees: compute unit pricing recommendations
  client.on('priorityFee', (fee: PriorityFee) => {
    console.log(`[Fee] speed=${fee.speed} price=${fee.computeUnitPrice} ` +
      `cost=${fee.estimatedCostSol} SOL probability=${(fee.landingProbability * 100).toFixed(0)}% ` +
      `congestion=${fee.networkCongestion}`);
  });

  // Connection lifecycle events
  client.on('connected', () => console.log('[Connected]'));
  client.on('disconnected', () => console.log('[Disconnected]'));
  client.on('error', (err: Error) => console.error('[Error]', err.message));

  // Access the cached latest tip at any time
  setTimeout(() => {
    const latestTip = client.getLatestTip();
    if (latestTip) {
      console.log(`\nCached tip: ${latestTip.senderName} @ ${latestTip.tipAmountSol} SOL`);
    }
  }, 5000);

  // Keep running until Ctrl+C
  console.log('Listening for streams... (Ctrl+C to stop)');
  await new Promise(() => {});
}

main().catch(console.error);
