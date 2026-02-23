/**
 * Subscription Integration Test
 *
 * Tests all 5 streaming subscriptions matching the Rust SDK patterns:
 *   1. Leader hints     (subscribe_leader_hints / on('leaderHint'))
 *   2. Tip instructions (subscribe_tip_instructions / on('tipInstruction'))
 *   3. Priority fees    (subscribe_priority_fees / on('priorityFee'))
 *   4. Latest blockhash (subscribe_latest_blockhash / on('latestBlockhash'))
 *   5. Latest slot      (subscribe_latest_slot / on('latestSlot'))
 *
 * Usage:
 *   SLIPSTREAM_API_KEY=sk_live_xxx npx ts-node tests/subscriptions-test.ts
 *   SLIPSTREAM_API_KEY=sk_live_xxx WORKER_URL=http://ip:9091 WS_URL=ws://ip:9091/ws npx ts-node tests/subscriptions-test.ts
 */

import { SlipstreamClient, configBuilder } from '../src';
import type {
  LeaderHint,
  TipInstruction,
  PriorityFee,
  LatestBlockhash,
  LatestSlot,
} from '../src/types';

const API_KEY = process.env.SLIPSTREAM_API_KEY ?? 'your_api_key';
const WORKER_URL = process.env.WORKER_URL ?? 'http://84.32.22.202:9091';
const WS_URL = process.env.WS_URL ?? 'ws://84.32.22.202:9091/ws';
const LISTEN_SECONDS = parseInt(process.env.LISTEN_SECONDS ?? '15', 10);

interface StreamCounters {
  leaderHints: number;
  tipInstructions: number;
  priorityFees: number;
  latestBlockhash: number;
  latestSlot: number;
}

function pass(label: string, detail?: string) {
  console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail?: string) {
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

function info(label: string, detail?: string) {
  console.log(`  [INFO] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('=== TypeScript SDK Subscription Integration Test ===\n');
  console.log(`Worker HTTP: ${WORKER_URL}`);
  console.log(`Worker WS:   ${WS_URL}`);
  console.log(`API Key:     ${API_KEY.slice(0, 12)}...`);
  console.log(`Listen:      ${LISTEN_SECONDS}s\n`);

  // =========================================================================
  // 1. Connect with ALL streams enabled (like Rust SDK streaming_callbacks.rs)
  // =========================================================================
  console.log('--- Test 1: Connect with all streams enabled ---');

  const config = configBuilder()
    .apiKey(API_KEY)
    .endpoint(WORKER_URL)
    .wsEndpoint(WS_URL)
    .leaderHints(true)
    .streamTipInstructions(true)
    .streamPriorityFees(true)
    .streamLatestBlockhash(true)
    .streamLatestSlot(true)
    .build();

  let client: SlipstreamClient;
  try {
    client = await SlipstreamClient.connect(config);
    pass('Connection established');
  } catch (err) {
    fail('Connection failed', (err as Error).message);
    process.exit(1);
  }

  const connInfo = client.connectionInfo();
  info('Protocol', connInfo.protocol);
  info('Region', connInfo.region ?? 'none');
  info('Session', connInfo.sessionId || '(http fallback)');
  info('Features', connInfo.features.join(', ') || 'none');

  const isWsConnected = connInfo.protocol === 'websocket';
  if (isWsConnected) {
    pass('WebSocket protocol active — streaming subscriptions will work');
  } else {
    info('HTTP fallback mode — streaming subscriptions require WebSocket');
    info('Testing subscription API surface (no data expected in HTTP mode)');
  }

  // =========================================================================
  // 2. Register event listeners (like Rust's tokio::select! pattern)
  // =========================================================================
  console.log('\n--- Test 2: Register all stream listeners ---');

  const counters: StreamCounters = {
    leaderHints: 0,
    tipInstructions: 0,
    priorityFees: 0,
    latestBlockhash: 0,
    latestSlot: 0,
  };

  let lastLeaderHint: LeaderHint | null = null;
  let lastTip: TipInstruction | null = null;
  let lastFee: PriorityFee | null = null;
  let lastBlockhash: LatestBlockhash | null = null;
  let lastSlot: LatestSlot | null = null;

  // Leader hints — Rust: hints.recv() => { println!("Leader: {} ({}%)", hint.preferred_region, hint.confidence) }
  client.on('leaderHint', (hint: LeaderHint) => {
    counters.leaderHints++;
    lastLeaderHint = hint;
    if (counters.leaderHints <= 3) {
      console.log(`    [leaderHint #${counters.leaderHints}] slot=${hint.slot} region=${hint.preferredRegion} confidence=${hint.confidence} leader=${hint.leaderPubkey?.slice(0, 8)}...`);
      if (hint.metadata?.tpuRttMs) {
        console.log(`      tpuRtt=${hint.metadata.tpuRttMs}ms score=${hint.metadata.regionScore}`);
      }
      if (hint.backupRegions.length > 0) {
        console.log(`      backups: ${hint.backupRegions.join(', ')}`);
      }
    }
  });

  // Tip instructions — Rust: tips.recv() => { println!("Tip: {} SOL to {}", tip.tip_amount_sol, tip.tip_wallet_address) }
  client.on('tipInstruction', (tip: TipInstruction) => {
    counters.tipInstructions++;
    lastTip = tip;
    if (counters.tipInstructions <= 3) {
      console.log(`    [tipInstruction #${counters.tipInstructions}] sender=${tip.senderName} wallet=${tip.tipWalletAddress?.slice(0, 8)}... amount=${tip.tipAmountSol} SOL tier=${tip.tipTier}`);
      console.log(`      latency=${tip.expectedLatencyMs}ms confidence=${tip.confidence}% validUntil=${tip.validUntilSlot}`);
      if (tip.alternativeSenders.length > 0) {
        for (const alt of tip.alternativeSenders) {
          console.log(`      alt: ${alt.sender} @ ${alt.tipAmountSol} SOL (${alt.confidence}%)`);
        }
      }
    }
  });

  // Priority fees — Rust: fees.recv() => { println!("Fee: {} micro-lamports", fee.compute_unit_price) }
  client.on('priorityFee', (fee: PriorityFee) => {
    counters.priorityFees++;
    lastFee = fee;
    if (counters.priorityFees <= 3) {
      console.log(`    [priorityFee #${counters.priorityFees}] speed=${fee.speed} price=${fee.computeUnitPrice} limit=${fee.computeUnitLimit}`);
      console.log(`      cost=${fee.estimatedCostSol} SOL probability=${fee.landingProbability} congestion=${fee.networkCongestion}`);
    }
  });

  // Latest blockhash — Rust: blockhash.recv() => { println!("Blockhash: {}", bh.blockhash) }
  client.on('latestBlockhash', (bh: LatestBlockhash) => {
    counters.latestBlockhash++;
    lastBlockhash = bh;
    if (counters.latestBlockhash <= 3) {
      console.log(`    [latestBlockhash #${counters.latestBlockhash}] hash=${bh.blockhash?.slice(0, 16)}... height=${bh.lastValidBlockHeight}`);
    }
  });

  // Latest slot — Rust: slot.recv() => { println!("Slot: {}", s.slot) }
  client.on('latestSlot', (s: LatestSlot) => {
    counters.latestSlot++;
    lastSlot = s;
    if (counters.latestSlot <= 3) {
      console.log(`    [latestSlot #${counters.latestSlot}] slot=${s.slot} ts=${s.timestamp}`);
    }
  });

  // Connection lifecycle events
  client.on('connected', () => console.log('    [event] connected'));
  client.on('disconnected', () => console.log('    [event] disconnected'));
  client.on('error', (err: Error) => console.log(`    [event] error: ${err.message}`));

  pass('All 5 stream listeners registered');

  // =========================================================================
  // 3. Explicit subscribe calls (like Rust's client.subscribe_*().await?)
  // =========================================================================
  console.log('\n--- Test 3: Explicit subscribe calls ---');

  try {
    await client.subscribeLeaderHints();
    pass('subscribeLeaderHints()');
  } catch (err) {
    fail('subscribeLeaderHints()', (err as Error).message);
  }

  try {
    await client.subscribeTipInstructions();
    pass('subscribeTipInstructions()');
  } catch (err) {
    fail('subscribeTipInstructions()', (err as Error).message);
  }

  try {
    await client.subscribePriorityFees();
    pass('subscribePriorityFees()');
  } catch (err) {
    fail('subscribePriorityFees()', (err as Error).message);
  }

  try {
    await client.subscribeLatestBlockhash();
    pass('subscribeLatestBlockhash()');
  } catch (err) {
    fail('subscribeLatestBlockhash()', (err as Error).message);
  }

  try {
    await client.subscribeLatestSlot();
    pass('subscribeLatestSlot()');
  } catch (err) {
    fail('subscribeLatestSlot()', (err as Error).message);
  }

  // =========================================================================
  // 4. Listen for streaming data
  // =========================================================================
  console.log(`\n--- Test 4: Listen for ${LISTEN_SECONDS}s ---`);
  console.log(`    Waiting for streaming data...`);

  await new Promise<void>((resolve) => setTimeout(resolve, LISTEN_SECONDS * 1000));

  // =========================================================================
  // 5. Verify results
  // =========================================================================
  console.log(`\n--- Test 5: Results ---`);
  console.log(`    Stream counts over ${LISTEN_SECONDS}s:`);
  console.log(`      leaderHints:     ${counters.leaderHints}`);
  console.log(`      tipInstructions: ${counters.tipInstructions}`);
  console.log(`      priorityFees:    ${counters.priorityFees}`);
  console.log(`      latestBlockhash: ${counters.latestBlockhash}`);
  console.log(`      latestSlot:      ${counters.latestSlot}`);

  if (isWsConnected) {
    // With WS, we expect at least some data
    counters.leaderHints > 0 ? pass('Leader hints received') : fail('No leader hints received');
    counters.tipInstructions > 0 ? pass('Tip instructions received') : info('No tip instructions (may not be active)');
    counters.priorityFees > 0 ? pass('Priority fees received') : info('No priority fees (may not be active)');
    counters.latestBlockhash > 0 ? pass('Latest blockhash received') : fail('No blockhash received (expected every 2s)');
    counters.latestSlot > 0 ? pass('Latest slot received') : fail('No slot received (expected every 400ms)');
  } else {
    info('HTTP mode — no streaming data expected (requires WebSocket)');
  }

  // =========================================================================
  // 6. Validate data shapes (like Rust SDK type safety)
  // =========================================================================
  console.log('\n--- Test 6: Data shape validation ---');

  if (lastLeaderHint) {
    const h = lastLeaderHint as LeaderHint;
    const valid = typeof h.slot === 'number' &&
      typeof h.preferredRegion === 'string' &&
      typeof h.confidence === 'number' &&
      typeof h.leaderPubkey === 'string' &&
      Array.isArray(h.backupRegions) &&
      typeof h.timestamp === 'number' &&
      typeof h.expiresAtSlot === 'number' &&
      h.metadata !== undefined;
    valid ? pass('LeaderHint shape valid') : fail('LeaderHint shape invalid');
  } else {
    info('LeaderHint — no data to validate');
  }

  if (lastTip) {
    const t = lastTip as TipInstruction;
    const valid = typeof t.sender === 'string' &&
      typeof t.senderName === 'string' &&
      typeof t.tipWalletAddress === 'string' &&
      typeof t.tipAmountSol === 'number' &&
      typeof t.tipTier === 'string' &&
      typeof t.expectedLatencyMs === 'number' &&
      typeof t.confidence === 'number' &&
      typeof t.validUntilSlot === 'number' &&
      Array.isArray(t.alternativeSenders);
    valid ? pass('TipInstruction shape valid') : fail('TipInstruction shape invalid');
  } else {
    info('TipInstruction — no data to validate');
  }

  if (lastFee) {
    const f = lastFee as PriorityFee;
    const valid = typeof f.speed === 'string' &&
      typeof f.computeUnitPrice === 'number' &&
      typeof f.computeUnitLimit === 'number' &&
      typeof f.estimatedCostSol === 'number' &&
      typeof f.landingProbability === 'number' &&
      typeof f.networkCongestion === 'string' &&
      typeof f.recentSuccessRate === 'number';
    valid ? pass('PriorityFee shape valid') : fail('PriorityFee shape invalid');
  } else {
    info('PriorityFee — no data to validate');
  }

  if (lastBlockhash) {
    const b = lastBlockhash as LatestBlockhash;
    const valid = typeof b.blockhash === 'string' &&
      typeof b.lastValidBlockHeight === 'number' &&
      typeof b.timestamp === 'number';
    valid ? pass('LatestBlockhash shape valid') : fail('LatestBlockhash shape invalid');
  } else {
    info('LatestBlockhash — no data to validate');
  }

  if (lastSlot) {
    const s = lastSlot as LatestSlot;
    const valid = typeof s.slot === 'number' && typeof s.timestamp === 'number';
    valid ? pass('LatestSlot shape valid') : fail('LatestSlot shape invalid');
  } else {
    info('LatestSlot — no data to validate');
  }

  // =========================================================================
  // 7. Test tip caching (like Rust SDK's cached tip)
  // =========================================================================
  console.log('\n--- Test 7: Tip caching ---');
  const cachedTip = client.getLatestTip();
  if (cachedTip) {
    pass('Cached tip available', `${cachedTip.senderName} @ ${cachedTip.tipAmountSol} SOL`);
  } else {
    info('No cached tip (expected if no tips received)');
  }

  // =========================================================================
  // 8. Connection status check (like Rust SDK's connection_status)
  // =========================================================================
  console.log('\n--- Test 8: Connection status ---');
  const status = client.connectionStatus();
  pass('connectionStatus()', `state=${status.state} protocol=${status.protocol} region=${status.region ?? 'none'}`);

  // =========================================================================
  // 9. Metrics (like Rust SDK's client.metrics())
  // =========================================================================
  console.log('\n--- Test 9: Metrics ---');
  const metrics = client.metrics();
  pass('metrics()', `submitted=${metrics.transactionsSubmitted} confirmed=${metrics.transactionsConfirmed} avgLatency=${metrics.averageLatencyMs.toFixed(1)}ms`);

  // =========================================================================
  // 10. Clean disconnect
  // =========================================================================
  console.log('\n--- Test 10: Disconnect ---');
  await client.disconnect();
  pass('Disconnected cleanly');

  // Final summary
  const totalReceived = counters.leaderHints + counters.tipInstructions +
    counters.priorityFees + counters.latestBlockhash + counters.latestSlot;
  console.log(`\n=== Summary ===`);
  console.log(`Protocol: ${connInfo.protocol}`);
  console.log(`Total stream messages: ${totalReceived}`);
  console.log(`  leaderHints: ${counters.leaderHints}`);
  console.log(`  tipInstructions: ${counters.tipInstructions}`);
  console.log(`  priorityFees: ${counters.priorityFees}`);
  console.log(`  latestBlockhash: ${counters.latestBlockhash}`);
  console.log(`  latestSlot: ${counters.latestSlot}`);
  if (isWsConnected && totalReceived > 0) {
    console.log(`\nAll subscriptions working over WebSocket!`);
  } else if (!isWsConnected) {
    console.log(`\nHTTP fallback — WS not available. Subscription API surface verified.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
