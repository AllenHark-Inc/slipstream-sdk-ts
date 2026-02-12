/**
 * @allenhark/slipstream — TypeScript SDK Types
 *
 * All interfaces and enums matching the Rust SDK API surface.
 */

// ============================================================================
// Configuration
// ============================================================================

export type BillingTier = 'free' | 'standard' | 'pro' | 'enterprise';

export interface SlipstreamConfig {
  apiKey: string;
  region?: string;
  endpoint?: string;
  discoveryUrl: string;
  /** Billing tier — determines cost per transaction and rate limits.
   * Default: 'pro'. Free/Standard=0.00005 SOL, Pro=0.0001 SOL, Enterprise=0.001 SOL per tx. */
  tier: BillingTier;
  connectionTimeout: number;
  maxRetries: number;
  leaderHints: boolean;
  streamTipInstructions: boolean;
  streamPriorityFees: boolean;
  streamLatestBlockhash: boolean;
  streamLatestSlot: boolean;
  protocolTimeouts: ProtocolTimeouts;
  priorityFee: PriorityFeeConfig;
  retryBackoff: BackoffStrategy;
  minConfidence: number;
  keepAlive: boolean;
  keepAliveIntervalMs: number;
  idleTimeout?: number;
  quic?: QuicConfig;
  /** Webhook URL (HTTPS). If set, SDK auto-registers webhook on connect. */
  webhookUrl?: string;
  /** Webhook event types to subscribe to. Default: ['transaction.confirmed'] */
  webhookEvents?: string[];
  /** Notification level for transaction events. Default: 'final' */
  webhookNotificationLevel?: string;
}

export interface ProtocolTimeouts {
  quic: number;
  websocket: number;
  http: number;
}

export interface QuicConfig {
  /** QUIC connection timeout in milliseconds */
  timeout: number;
  /** Keep-alive interval in milliseconds */
  keepAliveIntervalMs: number;
  /** Max idle timeout before disconnection in milliseconds */
  maxIdleTimeoutMs: number;
  /** Skip TLS certificate verification (development only) */
  insecure: boolean;
}

export interface PriorityFeeConfig {
  enabled: boolean;
  speed: PriorityFeeSpeed;
  maxTip?: number;
}

export enum PriorityFeeSpeed {
  Slow = 'slow',
  Fast = 'fast',
  UltraFast = 'ultra_fast',
}

export enum BackoffStrategy {
  Linear = 'linear',
  Exponential = 'exponential',
}

// ============================================================================
// Connection
// ============================================================================

export interface ConnectionInfo {
  sessionId: string;
  protocol: string;
  region?: string;
  serverTime: number;
  features: string[];
  rateLimit: RateLimitInfo;
}

export interface ConnectionStatus {
  state: ConnectionState;
  protocol: string;
  latencyMs: number;
  region?: string;
}

export interface PingResult {
  seq: number;
  rttMs: number;
  clockOffsetMs: number;
  serverTime: number;
}

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

export interface WorkerEndpoint {
  id: string;
  region: string;
  quic?: string;
  websocket?: string;
  http?: string;
}

export interface RateLimitInfo {
  rps: number;
  burst: number;
}

// ============================================================================
// Streaming Messages
// ============================================================================

export interface LeaderHint {
  timestamp: number;
  slot: number;
  expiresAtSlot: number;
  preferredRegion: string;
  backupRegions: string[];
  confidence: number;
  leaderPubkey: string;
  metadata: LeaderHintMetadata;
}

export interface LeaderHintMetadata {
  tpuRttMs: number;
  regionScore: number;
  leaderTpuAddress?: string;
  regionRttMs?: Record<string, number>;
}

export interface TipInstruction {
  timestamp: number;
  sender: string;
  senderName: string;
  tipWalletAddress: string;
  tipAmountSol: number;
  tipTier: string;
  expectedLatencyMs: number;
  confidence: number;
  validUntilSlot: number;
  alternativeSenders: AlternativeSender[];
}

export interface AlternativeSender {
  sender: string;
  tipAmountSol: number;
  confidence: number;
}

export interface PriorityFee {
  timestamp: number;
  speed: string;
  computeUnitPrice: number;
  computeUnitLimit: number;
  estimatedCostSol: number;
  landingProbability: number;
  networkCongestion: string;
  recentSuccessRate: number;
}

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
  timestamp: number;
}

export interface LatestSlot {
  slot: number;
  timestamp: number;
}

// ============================================================================
// Transaction
// ============================================================================

export interface TransactionResult {
  requestId: string;
  transactionId: string;
  signature?: string;
  status: TransactionStatus;
  slot?: number;
  timestamp: number;
  routing?: RoutingInfo;
  error?: TransactionError;
}

export enum TransactionStatus {
  Pending = 'pending',
  Processing = 'processing',
  Sent = 'sent',
  Confirmed = 'confirmed',
  Failed = 'failed',
  Duplicate = 'duplicate',
  RateLimited = 'rate_limited',
  InsufficientTokens = 'insufficient_tokens',
}

/** Retry policy options for intelligent retry behavior */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Base backoff delay in milliseconds (default: 100ms, exponential with jitter) */
  backoffBaseMs?: number;
  /** Whether to retry with a different sender on failure (default: false) */
  crossSenderRetry?: boolean;
}

export interface SubmitOptions {
  broadcastMode?: boolean;
  preferredSender?: string;
  maxRetries?: number;
  timeoutMs?: number;
  dedupId?: string;
  /** Retry policy (overrides maxRetries with more control) */
  retry?: RetryOptions;
}

export interface RoutingInfo {
  region: string;
  sender: string;
  routingLatencyMs: number;
  senderLatencyMs: number;
  totalLatencyMs: number;
}

export interface TransactionError {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================================
// Bundle
// ============================================================================

export interface BundleResult {
  bundleId: string;
  accepted: boolean;
  signatures: string[];
  senderId?: string;
  error?: string;
}

// ============================================================================
// Token Billing
// ============================================================================

export interface Balance {
  balanceSol: number;
  balanceTokens: number;
  balanceLamports: number;
  graceRemainingTokens: number;
}

export interface TopUpInfo {
  depositWallet: string;
  minAmountSol: number;
  minAmountLamports: number;
}

export interface UsageEntry {
  timestamp: number;
  txType: string;
  amountLamports: number;
  balanceAfterLamports: number;
  description?: string;
}

export interface DepositEntry {
  signature: string;
  amountLamports: number;
  amountSol: number;
  usdValue?: number;
  solUsdPrice?: number;
  credited: boolean;
  creditedAt?: string;
  slot: number;
  detectedAt: string;
  blockTime?: string;
}

export interface PendingDeposit {
  pendingLamports: number;
  pendingSol: number;
  pendingCount: number;
  minimumDepositUsd: number;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface FreeTierUsage {
  used: number;
  remaining: number;
  limit: number;
  resetsAt: string;
}

// ============================================================================
// Multi-Region Routing
// ============================================================================

export interface RoutingRecommendation {
  bestRegion: string;
  leaderPubkey: string;
  slot: number;
  confidence: number;
  expectedRttMs?: number;
  fallbackRegions: string[];
  fallbackStrategy: FallbackStrategy;
  validForMs: number;
}

export enum FallbackStrategy {
  Sequential = 'sequential',
  Broadcast = 'broadcast',
  Retry = 'retry',
  None = 'none',
}

export interface MultiRegionConfig {
  autoFollowLeader: boolean;
  minSwitchConfidence: number;
  switchCooldownMs: number;
  broadcastHighPriority: boolean;
  maxBroadcastRegions: number;
}

export interface RegionStatus {
  regionId: string;
  available: boolean;
  latencyMs?: number;
  leaderRttMs?: number;
  score?: number;
  workerCount: number;
}

// ============================================================================
// Metrics
// ============================================================================

export interface PerformanceMetrics {
  transactionsSubmitted: number;
  transactionsConfirmed: number;
  averageLatencyMs: number;
  successRate: number;
}

// ============================================================================
// Config Endpoint Responses
// ============================================================================

export interface RegionInfo {
  regionId: string;
  displayName: string;
  endpoint: string;
  geolocation?: { lat: number; lon: number };
}

export interface SenderInfo {
  senderId: string;
  displayName: string;
  tipWallets: string[];
  tipTiers: TipTier[];
}

export interface TipTier {
  name: string;
  amountSol: number;
  expectedLatencyMs: number;
}

// ============================================================================
// Discovery
// ============================================================================

export interface DiscoveryResponse {
  regions: DiscoveryRegion[];
  workers: DiscoveryWorker[];
  recommended_region: string | null;
}

export interface DiscoveryRegion {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
}

export interface DiscoveryWorker {
  id: string;
  region: string;
  ip: string;
  ports: { quic: number; ws: number; http: number };
  healthy: boolean;
  version?: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WsClientMessage =
  | WsConnectMessage
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsSubmitTransactionMessage
  | WsPongMessage;

export interface WsConnectMessage {
  type: 'connect';
  version: string;
  apiKey: string;
  features: string[];
  region?: string;
  tier?: BillingTier;
}

export interface WsSubscribeMessage {
  type: 'subscribe';
  stream: string;
}

export interface WsUnsubscribeMessage {
  type: 'unsubscribe';
  stream: string;
}

export interface WsSubmitTransactionMessage {
  type: 'submit_transaction';
  requestId: string;
  transaction: string;
  dedupId?: string;
  options?: {
    broadcastMode?: boolean;
    preferredSender?: string;
    maxRetries?: number;
    timeoutMs?: number;
  };
}

export interface WsPongMessage {
  type: 'pong';
  timestamp: number;
}

export interface WsServerMessage {
  type: string;
  [key: string]: unknown;
}

// ============================================================================
// Webhook Types
// ============================================================================

export enum WebhookEvent {
  TransactionSent = 'transaction.sent',
  TransactionConfirmed = 'transaction.confirmed',
  TransactionFailed = 'transaction.failed',
  BundleSent = 'bundle.sent',
  BundleConfirmed = 'bundle.confirmed',
  BundleFailed = 'bundle.failed',
  BillingLowBalance = 'billing.low_balance',
  BillingDepleted = 'billing.depleted',
  BillingDepositReceived = 'billing.deposit_received',
}

export enum WebhookNotificationLevel {
  /** Receive all transaction events (sent + confirmed + failed) */
  All = 'all',
  /** Receive only terminal events (confirmed + failed) */
  Final = 'final',
  /** Receive only confirmed events */
  Confirmed = 'confirmed',
}

export interface WebhookConfig {
  id: string;
  url: string;
  /** Only visible on register/update; masked on GET */
  secret?: string;
  events: string[];
  notificationLevel: string;
  isActive: boolean;
  createdAt?: string;
}

export interface RegisterWebhookRequest {
  url: string;
  events?: string[];
  notificationLevel?: string;
}

// ============================================================================
// Landing Rate Types
// ============================================================================

export interface LandingRateStats {
  period: LandingRatePeriod;
  totalSent: number;
  totalLanded: number;
  landingRate: number;
  bySender: SenderLandingRate[];
  byRegion: RegionLandingRate[];
}

export interface LandingRatePeriod {
  start: string;
  end: string;
}

export interface SenderLandingRate {
  sender: string;
  totalSent: number;
  totalLanded: number;
  landingRate: number;
}

export interface RegionLandingRate {
  region: string;
  totalSent: number;
  totalLanded: number;
  landingRate: number;
}

export interface LandingRateOptions {
  start?: string;
  end?: string;
}

/** Raw JSON-RPC 2.0 response from the Solana RPC proxy */
export interface RpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: RpcError | null;
}

/** JSON-RPC error object */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Result of simulating a transaction via the RPC proxy */
export interface SimulationResult {
  /** Error if simulation failed, null on success */
  err: unknown | null;
  /** Program log messages */
  logs: string[];
  /** Compute units consumed */
  unitsConsumed: number;
  /** Program return data (if any) */
  returnData?: unknown | null;
}
