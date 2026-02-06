/**
 * Deduplication example: Prevent duplicate transaction submissions
 * using custom dedup IDs.
 *
 * Slipstream uses vector clocks and logical timestamps for deduplication.
 * The first arrival wins, unless a later submission comes from a region
 * with 20%+ better score within a 5ms window.
 *
 * You can provide your own dedupId for idempotent retries -- the same
 * dedupId always returns the original result instead of resubmitting.
 *
 * Usage:
 *   npx ts-node examples/deduplication.ts
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

  const signedTx = new Uint8Array(256); // Replace with real signed transaction

  // Pattern 1: Idempotent submission with a unique business ID
  // Safe to retry -- Slipstream deduplicates on the dedupId
  const orderId = 'order-abc-123';

  async function submitWithRetry(tx: Uint8Array, dedupId: string): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await client.submitTransactionWithOptions(tx, {
          dedupId,
          maxRetries: 1,
          timeoutMs: 10000,
        });

        if (result.status === TransactionStatus.Duplicate) {
          console.log(`Attempt ${attempt}: Deduplicated (already submitted)`);
          return; // Already processed, safe to stop
        }

        console.log(`Attempt ${attempt}: ${result.status} (${result.transactionId})`);
        return;
      } catch (err) {
        if (err instanceof SlipstreamError && err.code === 'TIMEOUT') {
          console.log(`Attempt ${attempt}: Timed out, retrying...`);
          continue; // Safe to retry with same dedupId
        }
        throw err;
      }
    }
    console.error('All attempts failed');
  }

  await submitWithRetry(signedTx, orderId);

  // Pattern 2: Automatic deduplication without explicit ID
  // Slipstream hashes the transaction bytes for dedup
  const result1 = await client.submitTransaction(signedTx);
  console.log(`First submit:  ${result1.status}`);

  const result2 = await client.submitTransaction(signedTx);
  console.log(`Second submit: ${result2.status}`); // Likely 'duplicate'

  // Pattern 3: Time-scoped dedup for recurring operations
  // Include a timestamp component to allow resubmission after a window
  const timeWindow = Math.floor(Date.now() / 60000); // 1-minute windows
  const scopedId = `liquidation-${timeWindow}-position-xyz`;

  const result3 = await client.submitTransactionWithOptions(signedTx, {
    dedupId: scopedId,
  });
  console.log(`Scoped submit: ${result3.status} (window: ${timeWindow})`);

  await client.disconnect();
}

main().catch(console.error);
