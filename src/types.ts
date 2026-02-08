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
  protocolTimeouts: ProtocolTimeouts;
  priorityFee: PriorityFeeConfig;
  retryBackoff: BackoffStrategy;
  minConfidence: number;
  idleTimeout?: number;
  quic?: QuicConfig;
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
  leaderPubkey?: string;
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

export interface SubmitOptions {
  broadcastMode?: boolean;
  preferredSender?: string;
  maxRetries?: number;
  timeoutMs?: number;
  dedupId?: string;
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
  leaderPubkey?: string;
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
