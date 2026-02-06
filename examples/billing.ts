/**
 * Billing example: Check token balance, get deposit address,
 * and view usage and deposit history.
 *
 * Token economics:
 *   1 token = 1 query = 50,000 lamports = 0.00005 SOL
 *   Minimum deposit: $10 USD equivalent in SOL
 *   Initial balance per new key: 200 tokens (0.01 SOL)
 *
 * Usage:
 *   npx ts-node examples/billing.ts
 */

import { SlipstreamClient, configBuilder } from '@allenhark/slipstream';

async function main() {
  const client = await SlipstreamClient.connect(
    configBuilder().apiKey('sk_live_your_key_here').build()
  );

  // Check current token balance
  const balance = await client.getBalance();
  console.log('=== Token Balance ===');
  console.log(`Tokens:   ${balance.balanceTokens}`);
  console.log(`SOL:      ${balance.balanceSol}`);
  console.log(`Lamports: ${balance.balanceLamports}`);
  console.log(`Grace:    ${balance.graceRemainingTokens} tokens remaining`);

  // Get deposit wallet address for top-ups
  const deposit = await client.getDepositAddress();
  console.log('\n=== Deposit Wallet ===');
  console.log(`Address:     ${deposit.depositWallet}`);
  console.log(`Min deposit: ${deposit.minAmountSol} SOL`);
  console.log(`Min USD:     $${client.getMinimumDepositUsd()}`);

  // Check for pending (uncredited) deposits
  const pending = await client.getPendingDeposit();
  if (pending.pendingCount > 0) {
    console.log('\n=== Pending Deposits ===');
    console.log(`Count:    ${pending.pendingCount}`);
    console.log(`Amount:   ${pending.pendingSol} SOL`);
    console.log(`Need $${pending.minimumDepositUsd} USD total to credit`);
  }

  // View recent usage (debits)
  const usage = await client.getUsageHistory({ limit: 10, offset: 0 });
  console.log('\n=== Recent Usage ===');
  for (const entry of usage) {
    const date = new Date(entry.timestamp).toISOString();
    console.log(`${date} | ${entry.txType} | ${entry.amountLamports} lamports`);
  }

  // View deposit history
  const deposits = await client.getDepositHistory({ limit: 10 });
  console.log('\n=== Deposit History ===');
  for (const d of deposits) {
    const status = d.credited ? 'credited' : 'pending';
    console.log(`${d.detectedAt} | ${d.amountSol} SOL | ${status} | sig: ${d.signature.slice(0, 16)}...`);
  }

  await client.disconnect();
}

main().catch(console.error);
