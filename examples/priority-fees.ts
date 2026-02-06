/**
 * Priority fees example: Configure priority fee handling and
 * subscribe to real-time fee recommendations.
 *
 * Priority fees determine compute unit pricing for transactions.
 * The SDK streams recommendations based on current network conditions.
 *
 * Speed tiers:
 *   - Slow:      lower fees, lower landing probability
 *   - Fast:      balanced fees and probability (default)
 *   - UltraFast: highest fees, highest landing probability
 *
 * Usage:
 *   npx ts-node examples/priority-fees.ts
 */

import {
  SlipstreamClient,
  configBuilder,
  PriorityFeeSpeed,
  PriorityFee,
} from '@allenhark/slipstream';

async function main() {
  // Configure with priority fees enabled
  const client = await SlipstreamClient.connect(
    configBuilder()
      .apiKey('sk_live_your_key_here')
      .streamPriorityFees(true)
      .priorityFee({
        enabled: true,
        speed: PriorityFeeSpeed.Fast,
        maxTip: 0.005, // Cap at 0.005 SOL per transaction
      })
      .build()
  );

  // Track fee history for analysis
  const feeHistory: PriorityFee[] = [];

  client.on('priorityFee', (fee: PriorityFee) => {
    feeHistory.push(fee);

    console.log(`[${fee.speed}] price=${fee.computeUnitPrice} ` +
      `limit=${fee.computeUnitLimit} ` +
      `cost=${fee.estimatedCostSol.toFixed(6)} SOL ` +
      `probability=${(fee.landingProbability * 100).toFixed(0)}% ` +
      `congestion=${fee.networkCongestion} ` +
      `success=${(fee.recentSuccessRate * 100).toFixed(0)}%`);

    // Alert on high congestion
    if (fee.networkCongestion === 'high') {
      console.log('  WARNING: High network congestion, consider increasing fees');
    }
  });

  // Periodically report average fees
  setInterval(() => {
    if (feeHistory.length === 0) return;

    const recent = feeHistory.slice(-10);
    const avgPrice = recent.reduce((s, f) => s + f.computeUnitPrice, 0) / recent.length;
    const avgProb = recent.reduce((s, f) => s + f.landingProbability, 0) / recent.length;

    console.log(`\n[Stats] avg price=${avgPrice.toFixed(0)} ` +
      `avg probability=${(avgProb * 100).toFixed(0)}% ` +
      `samples=${feeHistory.length}\n`);
  }, 10000);

  console.log('Streaming priority fees... (Ctrl+C to stop)');
  await new Promise(() => {});
}

main().catch(console.error);
