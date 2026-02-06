/**
 * Advanced configuration example: Demonstrates all ConfigBuilder options.
 *
 * Most options have sensible defaults. Only apiKey is required.
 * This example shows every available option for reference.
 *
 * Usage:
 *   npx ts-node examples/advanced-config.ts
 */

import {
  SlipstreamClient,
  configBuilder,
  BackoffStrategy,
  PriorityFeeSpeed,
} from '@allenhark/slipstream';

async function main() {
  // Minimal config -- just an API key
  const minimal = configBuilder()
    .apiKey('sk_live_your_key_here')
    .build();

  // Region preference -- routes to preferred region when available
  const withRegion = configBuilder()
    .apiKey('sk_live_your_key_here')
    .region('us-east')
    .build();

  // Explicit endpoint -- bypass discovery entirely
  const explicit = configBuilder()
    .apiKey('sk_live_your_key_here')
    .endpoint('http://10.0.1.1:9000')
    .build();

  // Full configuration with every option
  const full = configBuilder()
    .apiKey('sk_live_your_key_here')
    .region('eu-central')
    .discoveryUrl('https://discovery.slipstream.allenhark.com')
    .connectionTimeout(15000)
    .maxRetries(5)
    .leaderHints(true)
    .streamTipInstructions(true)
    .streamPriorityFees(true)
    .protocolTimeouts({ websocket: 5000, http: 10000 })
    .priorityFee({
      enabled: true,
      speed: PriorityFeeSpeed.UltraFast,
      maxTip: 0.01, // Cap tip at 0.01 SOL
    })
    .retryBackoff(BackoffStrategy.Exponential)
    .minConfidence(60)
    .idleTimeout(300000) // Disconnect after 5 minutes idle
    .build();

  // Connect with the full config
  const client = await SlipstreamClient.connect(full);

  // Inspect the resolved configuration
  const config = client.config();
  console.log('=== Resolved Config ===');
  console.log(`Region:           ${config.region ?? 'auto'}`);
  console.log(`Endpoint:         ${config.endpoint ?? 'discovered'}`);
  console.log(`Discovery URL:    ${config.discoveryUrl}`);
  console.log(`Timeout:          ${config.connectionTimeout}ms`);
  console.log(`Max retries:      ${config.maxRetries}`);
  console.log(`Leader hints:     ${config.leaderHints}`);
  console.log(`Tip stream:       ${config.streamTipInstructions}`);
  console.log(`Fee stream:       ${config.streamPriorityFees}`);
  console.log(`WS timeout:       ${config.protocolTimeouts.websocket}ms`);
  console.log(`HTTP timeout:     ${config.protocolTimeouts.http}ms`);
  console.log(`Priority fee:     ${config.priorityFee.enabled} (${config.priorityFee.speed})`);
  console.log(`Backoff:          ${config.retryBackoff}`);
  console.log(`Min confidence:   ${config.minConfidence}`);
  console.log(`Idle timeout:     ${config.idleTimeout ?? 'none'}ms`);

  // Connection info from the worker
  const info = client.connectionInfo();
  console.log('\n=== Connection Info ===');
  console.log(`Session:  ${info.sessionId}`);
  console.log(`Protocol: ${info.protocol}`);
  console.log(`Region:   ${info.region}`);
  console.log(`Features: ${info.features.join(', ')}`);
  console.log(`Rate:     ${info.rateLimit.rps} rps (burst: ${info.rateLimit.burst})`);

  await client.disconnect();
}

main().catch(console.error);
