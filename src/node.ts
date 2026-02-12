/**
 * @allenhark/slipstream/node — Node.js entry point with QUIC support
 *
 * Use this import for server-side applications (bots, validators, etc.)
 * that benefit from QUIC transport's lower latency.
 *
 * Fallback chain: QUIC (2s) → WebSocket (3s) → HTTP (5s)
 *
 * @example
 * ```typescript
 * import { SlipstreamClient, configBuilder } from '@allenhark/slipstream/node';
 *
 * const client = await SlipstreamClient.connect(
 *   configBuilder().apiKey('sk_live_xxx').build()
 * );
 * ```
 *
 * If no QUIC library is available, falls back to WebSocket + HTTP
 * (same as the browser entry point).
 */

// Re-export everything from the base SDK
export * from './index';

// QUIC transport (server-side only)
export { QuicTransport, parseQuicEndpoint } from './transport/quic';

// Binary protocol utilities (advanced usage)
export {
  STREAM_TYPE,
  RESPONSE_STATUS,
  buildAuthFrame,
  buildTransactionFrame,
  buildSubscriptionFrame,
  parseAuthResponse,
  parseTransactionResponse,
  parseLeaderHint,
  parseTipInstruction,
  parsePriorityFee,
} from './transport/binary';

// QUIC config type
export type { QuicConfig } from './types';
