/**
 * @allenhark/slipstream - TypeScript SDK for Slipstream
 *
 * @example
 * ```typescript
 * import { SlipstreamClient } from '@allenhark/slipstream';
 *
 * const client = new SlipstreamClient({ apiKey: 'sk_live_...' });
 * await client.connect();
 * ```
 */

// TODO: Implement SDK components
// - SlipstreamClient
// - ConnectionManager
// - WorkerSelector
// - StreamSubscriber

export interface SlipstreamConfig {
  apiKey: string;
  region?: string;
}

export class SlipstreamClient {
  constructor(config: SlipstreamConfig) {
    // TODO: Implement
  }

  async connect(): Promise<void> {
    // TODO: Implement
  }

  async submitTransaction(tx: unknown): Promise<string> {
    // TODO: Implement
    return '';
  }
}
