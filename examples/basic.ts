/**
 * Basic example: Connect to Slipstream and submit a transaction.
 *
 * The SDK auto-discovers workers via the discovery service.
 * No manual endpoint configuration needed.
 *
 * Usage:
 *   npx ts-node examples/basic.ts
 */

import {
  SlipstreamClient,
  configBuilder,
  TransactionStatus,
} from '@allenhark/slipstream';
import { Keypair, Transaction, SystemProgram, Connection } from '@solana/web3.js';

async function main() {
  // 1. Connect -- discovery handles finding the best worker
  const client = await SlipstreamClient.connect(
    configBuilder().apiKey('sk_live_your_key_here').build()
  );

  console.log('Connected to Slipstream');
  console.log('Region:', client.connectionInfo().region);
  console.log('Protocol:', client.connectionInfo().protocol);

  // 2. Build a transaction (example: SOL transfer)
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const payer = Keypair.generate(); // Replace with your keypair

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey, // Replace with destination
      lamports: 1_000_000,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  // 3. Submit the signed transaction
  const serialized = tx.serialize();
  const result = await client.submitTransaction(serialized);

  console.log(`Transaction ID: ${result.transactionId}`);
  console.log(`Status: ${result.status}`);

  if (result.status === TransactionStatus.Confirmed) {
    console.log(`Confirmed in slot ${result.slot}`);
    console.log(`Signature: ${result.signature}`);
  }

  if (result.routing) {
    console.log(`Routed: ${result.routing.region} -> ${result.routing.sender}`);
    console.log(`Total latency: ${result.routing.totalLatencyMs}ms`);
  }

  // 4. Check performance metrics
  const metrics = client.metrics();
  console.log(`Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);

  // 5. Disconnect
  await client.disconnect();
}

main().catch(console.error);
