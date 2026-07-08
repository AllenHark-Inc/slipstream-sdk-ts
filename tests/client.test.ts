/**
 * Bundle submission guard regression test.
 *
 * Task 6 (legacy-port fallback) does not touch bundle logic — this test
 * exists purely to pin down the existing `submitBundle` guard at
 * client.ts (2-5 transactions) so future changes don't silently break it.
 */

import { configBuilder } from '../src/config';
import { SlipstreamClient } from '../src/client';
import { SlipstreamError } from '../src/errors';

describe('SlipstreamClient.submitBundle guard', () => {
  let client: SlipstreamClient;

  beforeAll(async () => {
    // No real worker is reachable here — connect() falls through
    // QUIC (not provided) -> WebSocket (fails fast, unreachable) -> HTTP-only
    // polling mode. That's enough to exercise the client-side submitBundle
    // guard, which runs before any network call.
    const config = configBuilder()
      .apiKey('sk_test_00000000')
      .endpoint('http://127.0.0.1:1')
      .protocolTimeouts({ quic: 100, websocket: 200, http: 500 })
      .leaderHints(false)
      .build();

    client = await SlipstreamClient.connect(config);
  }, 10_000);

  afterAll(async () => {
    await client.disconnect();
  });

  const tx = new Uint8Array([1, 2, 3]);

  // NOTE: the existing guard constructs `new SlipstreamError(code, message)`
  // with its arguments swapped (code='Bundle must contain 2-5 transactions',
  // message='VALIDATION_ERROR'). That's pre-existing behavior, unrelated to
  // this task — asserted here as-is, not "fixed".
  test('throws when given fewer than 2 transactions', async () => {
    await expect(client.submitBundle([tx])).rejects.toMatchObject({
      code: expect.stringContaining('2-5 transactions'),
    });
  });

  test('throws when given more than 5 transactions', async () => {
    await expect(client.submitBundle([tx, tx, tx, tx, tx, tx])).rejects.toMatchObject({
      code: expect.stringContaining('2-5 transactions'),
    });
  });

  test('does not throw the guard error for a valid count (2-5)', async () => {
    // The guard itself must not fire; if the subsequent HTTP call fails
    // (there's no real worker here), that's a different, unrelated error.
    try {
      await client.submitBundle([tx, tx]);
    } catch (err) {
      const code = err instanceof SlipstreamError ? err.code : '';
      expect(code).not.toMatch(/2-5 transactions/);
    }
  });
});
