/**
 * Transaction submission example: Demonstrates submit options,
 * broadcast mode, preferred sender, and result handling.
 *
 * Transactions must include a tip to a registered sender tip wallet
 * and have skipPreflight=true (no simulation).
 *
 * Usage:
 *   npx ts-node examples/submit-transaction.ts
 */

import {
  SlipstreamClient,
  configBuilder,
  SlipstreamError,
  TransactionStatus,
} from '@allenhark/slipstream';

async function main() {
  const client = await SlipstreamClient.connect(
    configBuilder().apiKey('sk_live_your_key_here').build()
  );

  const signedTx = new Uint8Array(256); // Replace with real signed transaction bytes

  // Basic submission -- uses defaults
  const basic = await client.submitTransaction(signedTx);
  console.log(`Basic: ${basic.transactionId} -> ${basic.status}`);

  // Submission with all options
  const result = await client.submitTransactionWithOptions(signedTx, {
    broadcastMode: false,        // Single-region routing (default)
    preferredSender: 'nozomi',   // Prefer a specific sender
    maxRetries: 5,               // Override retry count
    timeoutMs: 15000,            // 15-second timeout
    dedupId: 'order-12345',      // Custom deduplication key
  });

  // Handle result based on status
  switch (result.status) {
    case TransactionStatus.Confirmed:
      console.log(`Confirmed in slot ${result.slot}`);
      console.log(`Signature: ${result.signature}`);
      break;
    case TransactionStatus.Sent:
      console.log(`Sent, awaiting confirmation (ID: ${result.transactionId})`);
      break;
    case TransactionStatus.Duplicate:
      console.log('Transaction already submitted (deduplicated)');
      break;
    case TransactionStatus.Failed:
      console.log(`Failed: ${result.error?.message}`);
      break;
    case TransactionStatus.RateLimited:
      console.log('Rate limited -- slow down');
      break;
    case TransactionStatus.InsufficientTokens:
      console.log('Insufficient tokens -- top up your balance');
      break;
  }

  // Routing details
  if (result.routing) {
    console.log('\n=== Routing ===');
    console.log(`Region:         ${result.routing.region}`);
    console.log(`Sender:         ${result.routing.sender}`);
    console.log(`Routing:        ${result.routing.routingLatencyMs}ms`);
    console.log(`Sender latency: ${result.routing.senderLatencyMs}ms`);
    console.log(`Total:          ${result.routing.totalLatencyMs}ms`);
  }

  // Listen for async status updates (WebSocket)
  client.on('transactionUpdate', (update) => {
    if (update.transactionId === result.transactionId) {
      console.log(`Update: ${update.status}`);
    }
  });

  await client.disconnect();
}

main().catch(console.error);
