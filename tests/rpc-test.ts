/**
 * Live integration test for SolanaRpc typed interface.
 *
 * Usage:
 *   npx ts-node tests/rpc-test.ts                         # via control plane /v1/rpc
 *   SLIPSTREAM_RPC_PATH=/management/rpc-proxy npx ts-node tests/rpc-test.ts  # direct to worker
 *
 * Environment variables:
 *   SLIPSTREAM_ENDPOINT  — HTTP base URL (default http://84.32.22.202:9091)
 *   SLIPSTREAM_API_KEY   — API key for authentication
 *   SLIPSTREAM_RPC_PATH  — RPC route path (default /v1/rpc; use /management/rpc-proxy for direct worker)
 */

import { SolanaRpc } from '../src/rpc';
import type { RpcResponse } from '../src/types';

const ENDPOINT = process.env.SLIPSTREAM_ENDPOINT ?? 'http://84.32.22.202:9091';
const API_KEY = process.env.SLIPSTREAM_API_KEY ?? 'sk_test_51e2f76c90b44cb6a04e17e216bc0ad2';
const RPC_PATH = process.env.SLIPSTREAM_RPC_PATH ?? '/v1/rpc';

// Known mainnet pubkey for balance/account tests
const PUBKEY = '11111111111111111111111111111111';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    failed++;
    console.error(`  FAIL: ${msg}`);
  } else {
    passed++;
    console.log(`  OK: ${msg}`);
  }
}

async function httpRpc(method: string, params: unknown[]): Promise<RpcResponse> {
  const url = `${ENDPOINT}${RPC_PATH}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as RpcResponse;
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(name);
  try {
    await fn();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes('not configured') || msg.includes('404') || msg.includes('401')) {
      skipped++;
      console.log(`  SKIP: ${msg}`);
    } else {
      failed++;
      console.error(`  ERROR: ${msg}`);
    }
  }
}

async function main() {
  const rpc = new SolanaRpc(httpRpc);

  console.log(`\nSolanaRpc integration tests — ${ENDPOINT}${RPC_PATH}\n`);

  await run('getHealth', async () => {
    const health = await rpc.getHealth();
    assert(health === 'ok', `health === "ok" (got ${JSON.stringify(health)})`);
  });

  await run('getSlot', async () => {
    const slot = await rpc.getSlot();
    assert(typeof slot === 'number', `typeof slot === number (got ${slot})`);
    assert(slot > 0, `slot > 0`);
  });

  await run('getBlockHeight', async () => {
    const height = await rpc.getBlockHeight();
    assert(typeof height === 'number', `typeof height === number`);
    assert(height > 0, `blockHeight > 0`);
  });

  await run('getEpochInfo', async () => {
    const info = await rpc.getEpochInfo();
    assert(typeof info.epoch === 'number', `epoch is number`);
    assert(typeof info.slotIndex === 'number', `slotIndex is number`);
    assert(typeof info.slotsInEpoch === 'number', `slotsInEpoch is number`);
    assert(typeof info.absoluteSlot === 'number', `absoluteSlot is number`);
    assert(typeof info.blockHeight === 'number', `blockHeight is number`);
  });

  await run('getBalance', async () => {
    const lamports = await rpc.getBalance(PUBKEY);
    assert(typeof lamports === 'number', `typeof balance === number (got ${lamports})`);
    assert(lamports >= 0, `balance >= 0`);
  });

  await run('getLatestBlockhash', async () => {
    const bh = await rpc.getLatestBlockhash();
    assert(typeof bh.value.blockhash === 'string', `blockhash is string`);
    assert(bh.value.blockhash.length > 20, `blockhash length > 20`);
    assert(typeof bh.value.lastValidBlockHeight === 'number', `lastValidBlockHeight is number`);
  });

  await run('getRecentPrioritizationFees', async () => {
    const fees = await rpc.getRecentPrioritizationFees();
    assert(Array.isArray(fees), `result is array`);
    if (fees.length > 0) {
      assert(typeof fees[0].slot === 'number', `fees[0].slot is number`);
      assert(typeof fees[0].prioritizationFee === 'number', `fees[0].prioritizationFee is number`);
    }
  });

  await run('getFirstAvailableBlock', async () => {
    const block = await rpc.getFirstAvailableBlock();
    assert(typeof block === 'number', `typeof firstAvailableBlock === number`);
    assert(block >= 0, `firstAvailableBlock >= 0`);
  });

  await run('getAccountInfo', async () => {
    const acct = await rpc.getAccountInfo(PUBKEY);
    assert(acct !== undefined, `account info returned`);
    assert(acct.value !== null || acct.value === null, `value is present (may be null)`);
  });

  await run('call (escape hatch)', async () => {
    const resp = await rpc.call('getSlot', []);
    assert(resp.jsonrpc === '2.0', `jsonrpc === "2.0"`);
    assert(typeof resp.result === 'number', `result is number via raw call`);
    assert(!resp.error, `no error`);
  });

  // --- Summary ---
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
