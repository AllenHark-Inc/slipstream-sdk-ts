/**
 * @allenhark/slipstream — TypeScript SDK for Slipstream
 *
 * High-performance Solana transaction relay with leader-proximity-aware routing.
 *
 * @example
 * ```typescript
 * import { SlipstreamClient, configBuilder } from '@allenhark/slipstream';
 *
 * const config = configBuilder()
 *   .apiKey('sk_test_12345678')
 *   .region('us-east')
 *   .build();
 *
 * const client = await SlipstreamClient.connect(config);
 *
 * // Submit a transaction
 * const result = await client.submitTransaction(txBytes);
 * console.log(`TX: ${result.transactionId}`);
 *
 * // Subscribe to leader hints
 * client.on('leaderHint', (hint) => {
 *   console.log(`Leader in ${hint.preferredRegion} (confidence: ${hint.confidence}%)`);
 * });
 * await client.subscribeLeaderHints();
 *
 * // Check token balance
 * const balance = await client.getBalance();
 * console.log(`Balance: ${balance.balanceSol} SOL (${balance.balanceTokens} tokens)`);
 * ```
 */

// Client classes
export { SlipstreamClient } from './client';
export { MultiRegionClient } from './multi-region';

// Configuration
export { ConfigBuilder, configBuilder } from './config';

// Discovery
export { discover, DEFAULT_DISCOVERY_URL } from './discovery';

// Error types
export { SlipstreamError } from './errors';

// All types
export {
  // Config types
  SlipstreamConfig,
  BillingTier,
  ProtocolTimeouts,
  QuicConfig,
  PriorityFeeConfig,
  PriorityFeeSpeed,
  BackoffStrategy,

  // Connection types
  ConnectionInfo,
  ConnectionStatus,
  ConnectionState,
  WorkerEndpoint,
  RateLimitInfo,

  // Streaming message types
  LeaderHint,
  LeaderHintMetadata,
  TipInstruction,
  AlternativeSender,
  PriorityFee,
  LatestBlockhash,
  LatestSlot,

  // Transaction types
  TransactionResult,
  TransactionStatus,
  SubmitOptions,
  RetryOptions,
  RoutingInfo,
  TransactionError,
  BundleResult,

  // Token billing types
  Balance,
  TopUpInfo,
  UsageEntry,
  DepositEntry,
  PendingDeposit,
  PaginationOptions,
  FreeTierUsage,

  // Multi-region types
  RoutingRecommendation,
  FallbackStrategy,
  MultiRegionConfig,
  RegionStatus,

  // Metrics
  PerformanceMetrics,

  // Discovery types
  DiscoveryResponse,
  DiscoveryRegion,
  DiscoveryWorker,

  // Config endpoint responses
  RegionInfo,
  SenderInfo,
  TipTier,

  // Webhook types
  WebhookEvent,
  WebhookNotificationLevel,
  WebhookConfig,
  RegisterWebhookRequest,

  // Landing rate types
  LandingRateStats,
  LandingRatePeriod,
  SenderLandingRate,
  RegionLandingRate,
  LandingRateOptions,

  // RPC proxy types
  RpcResponse,
  RpcError,
  SimulationResult,
} from './types';

// Worker selector (advanced usage)
export { WorkerSelector } from './worker-selector';

export const VERSION = '0.1.0';
