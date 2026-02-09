/**
 * @allenhark/slipstream — SlipstreamClient
 *
 * Main SDK entry point. Connects via WebSocket for streaming and HTTP for REST calls.
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
 * // Subscribe to leader hints
 * client.on('leaderHint', (hint) => {
 *   console.log(`Leader in ${hint.preferredRegion}`);
 * });
 * await client.subscribeLeaderHints();
 *
 * // Submit a transaction
 * const result = await client.submitTransaction(txBytes);
 * console.log(`TX: ${result.transactionId}`);
 * ```
 */

import { EventEmitter } from 'events';
import { getHttpEndpoint, getWsEndpoint } from './config';
import { discover, bestRegion, workersForRegion } from './discovery';
import { SlipstreamError } from './errors';
import { HttpTransport } from './transport/http';
import { QuicTransport } from './transport/quic';
import { WebSocketTransport } from './transport/websocket';
import {
  Balance,
  ConnectionInfo,
  ConnectionState,
  ConnectionStatus,
  DepositEntry,
  FreeTierUsage,
  LatestBlockhash,
  LatestSlot,
  LeaderHint,
  PaginationOptions,
  PendingDeposit,
  PerformanceMetrics,
  PingResult,
  PriorityFee,
  RoutingRecommendation,
  SlipstreamConfig,
  SubmitOptions,
  TipInstruction,
  TopUpInfo,
  TransactionResult,
  UsageEntry,
} from './types';

class TimeSyncManager {
  private samples: PingResult[] = [];
  private readonly maxSamples: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(maxSamples = 10) {
    this.maxSamples = maxSamples;
  }

  record(result: PingResult): void {
    this.samples.push(result);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  medianRttMs(): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].map(s => s.rttMs).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  medianClockOffsetMs(): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].map(s => s.clockOffsetMs).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  start(pingFn: () => Promise<PingResult>, intervalMs: number, onResult?: (r: PingResult) => void): void {
    this.stop();
    this.timer = setInterval(async () => {
      try {
        const result = await pingFn();
        this.record(result);
        onResult?.(result);
      } catch {
        // Ping failed — continue trying
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export class SlipstreamClient extends EventEmitter {
  private readonly _config: SlipstreamConfig;
  private readonly http: HttpTransport;
  private readonly ws: WebSocketTransport;
  private quicTransport: QuicTransport | null = null;
  private _connectionInfo: ConnectionInfo | null = null;
  private _connected = false;
  private latestTip: TipInstruction | null = null;

  // Metrics
  private txSubmitted = 0;
  private txConfirmed = 0;
  private totalLatencyMs = 0;
  private lastLatencyMs = 0;

  private constructor(config: SlipstreamConfig) {
    super();
    this._config = config;

    const httpUrl = getHttpEndpoint(config);
    const wsUrl = getWsEndpoint(config);

    this.http = new HttpTransport(httpUrl, config.apiKey, config.protocolTimeouts.http);
    this.ws = new WebSocketTransport(wsUrl, config.apiKey, config.region, config.tier);

    // Forward WS events
    this.ws.on('leaderHint', (hint: LeaderHint) => this.emit('leaderHint', hint));
    this.ws.on('tipInstruction', (tip: TipInstruction) => {
      this.latestTip = tip;
      this.emit('tipInstruction', tip);
    });
    this.ws.on('priorityFee', (fee: PriorityFee) => this.emit('priorityFee', fee));
    this.ws.on('latestBlockhash', (data: LatestBlockhash) => this.emit('latestBlockhash', data));
    this.ws.on('latestSlot', (data: LatestSlot) => this.emit('latestSlot', data));
    this.ws.on('transactionUpdate', (result: TransactionResult) =>
      this.emit('transactionUpdate', result),
    );
    this.ws.on('connected', () => {
      this._connected = true;
      this.emit('connected');
    });
    this.ws.on('disconnected', () => {
      this._connected = false;
      this.emit('disconnected');
    });
    this.ws.on('error', (err: Error) => this.emit('error', err));
  }

  /**
   * Connect to Slipstream using the provided configuration.
   *
   * If no explicit endpoint is set, the SDK automatically discovers
   * available workers via the discovery service, selects the best
   * worker, and connects directly to its IP address.
   *
   * @param config - SDK configuration
   * @param quicTransport - Optional QUIC transport (provided by the /node entry point)
   */
  static async connect(
    config: SlipstreamConfig,
    quicTransport?: QuicTransport,
  ): Promise<SlipstreamClient> {
    // If no explicit endpoint, use discovery to find a worker
    if (!config.endpoint) {
      const response = await discover(config.discoveryUrl);

      const region = bestRegion(response, config.region) ?? undefined;
      if (!region) {
        throw SlipstreamError.connection('No healthy workers found via discovery');
      }

      const workers = workersForRegion(response, region);
      if (workers.length === 0) {
        throw SlipstreamError.connection(`No healthy workers in region '${region}'`);
      }

      // Select best worker (first healthy in region)
      const worker = workers[0];
      config = {
        ...config,
        region,
        endpoint: `http://${worker.ip}:${worker.ports.http}`,
      };
    }

    const client = new SlipstreamClient(config);

    // Try QUIC first if transport provided (server-side)
    if (quicTransport) {
      try {
        const connInfo = await Promise.race([
          quicTransport.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('QUIC timeout')),
              config.protocolTimeouts.quic ?? 2_000,
            ),
          ),
        ]);

        client.quicTransport = quicTransport;
        client._connectionInfo = connInfo;
        client._connected = true;

        // Forward QUIC events
        quicTransport.on('leaderHint', (hint: LeaderHint) => client.emit('leaderHint', hint));
        quicTransport.on('tipInstruction', (tip: TipInstruction) => {
          client.latestTip = tip;
          client.emit('tipInstruction', tip);
        });
        quicTransport.on('priorityFee', (fee: PriorityFee) => client.emit('priorityFee', fee));
        quicTransport.on('disconnected', () => {
          client.quicTransport = null;
          // Fall through to WS if available
        });

        // Auto-subscribe via QUIC
        if (config.leaderHints) quicTransport.subscribeLeaderHints();
        if (config.streamTipInstructions) quicTransport.subscribeTipInstructions();
        if (config.streamPriorityFees) quicTransport.subscribePriorityFees();
        if (config.streamLatestBlockhash) quicTransport.subscribeLatestBlockhash();
        if (config.streamLatestSlot) quicTransport.subscribeLatestSlot();

        return client;
      } catch {
        // QUIC failed — fall through to WS → HTTP chain
      }
    }

    try {
      const connInfo = await client.ws.connect();
      client._connectionInfo = connInfo;
      client._connected = true;

      // Auto-subscribe based on config
      if (config.leaderHints) {
        client.ws.subscribeLeaderHints();
      }
      if (config.streamTipInstructions) {
        client.ws.subscribeTipInstructions();
      }
      if (config.streamPriorityFees) {
        client.ws.subscribePriorityFees();
      }
      if (config.streamLatestBlockhash) {
        client.ws.subscribeLatestBlockhash();
      }
      if (config.streamLatestSlot) {
        client.ws.subscribeLatestSlot();
      }

      return client;
    } catch (err) {
      // WebSocket failed — fall back to HTTP-only mode
      client._connectionInfo = {
        sessionId: '',
        protocol: 'http',
        region: config.region,
        serverTime: Date.now(),
        features: [],
        rateLimit: { rps: 100, burst: 200 },
      };
      client._connected = true;
      return client;
    }
  }

  // ===========================================================================
  // Connection
  // ===========================================================================

  connectionInfo(): ConnectionInfo {
    if (!this._connectionInfo) {
      throw SlipstreamError.notConnected();
    }
    return this._connectionInfo;
  }

  config(): SlipstreamConfig {
    return this._config;
  }

  isConnected(): boolean {
    return this._connected;
  }

  async disconnect(): Promise<void> {
    if (this.quicTransport) {
      await this.quicTransport.disconnect();
      this.quicTransport = null;
    }
    await this.ws.disconnect();
    this._connected = false;
  }

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  /**
   * Submit a signed transaction.
   *
   * Prefers QUIC if connected, then WebSocket, then HTTP.
   */
  async submitTransaction(
    transaction: Uint8Array | Buffer,
  ): Promise<TransactionResult> {
    return this.submitTransactionWithOptions(transaction, {});
  }

  async submitTransactionWithOptions(
    transaction: Uint8Array | Buffer,
    options: SubmitOptions,
  ): Promise<TransactionResult> {
    const txBytes = transaction instanceof Uint8Array ? transaction : new Uint8Array(transaction);

    const start = Date.now();
    let result: TransactionResult;

    try {
      if (this.quicTransport?.isConnected()) {
        result = await this.quicTransport.submitTransaction(txBytes, options);
      } else if (this.ws.isConnected()) {
        result = await this.ws.submitTransaction(txBytes, options);
      } else {
        result = await this.http.submitTransaction(txBytes, options);
      }
    } catch (err) {
      this.txSubmitted++;
      throw err;
    }

    const elapsed = Date.now() - start;
    this.lastLatencyMs = elapsed;
    this.txSubmitted++;
    this.totalLatencyMs += elapsed;
    if (result.status === 'confirmed' || result.status === 'sent') {
      this.txConfirmed++;
    }

    return result;
  }

  // ===========================================================================
  // Streaming Subscriptions
  // ===========================================================================

  /**
   * Subscribe to leader hint updates.
   *
   * Listen for updates:
   * ```typescript
   * client.on('leaderHint', (hint: LeaderHint) => { ... });
   * ```
   */
  async subscribeLeaderHints(): Promise<void> {
    if (this.quicTransport?.isConnected()) {
      this.quicTransport.subscribeLeaderHints();
    } else {
      this.ws.subscribeLeaderHints();
    }
  }

  /**
   * Subscribe to tip instruction updates.
   *
   * Listen for updates:
   * ```typescript
   * client.on('tipInstruction', (tip: TipInstruction) => { ... });
   * ```
   */
  async subscribeTipInstructions(): Promise<void> {
    if (this.quicTransport?.isConnected()) {
      this.quicTransport.subscribeTipInstructions();
    } else {
      this.ws.subscribeTipInstructions();
    }
  }

  /**
   * Subscribe to priority fee updates.
   *
   * Listen for updates:
   * ```typescript
   * client.on('priorityFee', (fee: PriorityFee) => { ... });
   * ```
   */
  async subscribePriorityFees(): Promise<void> {
    if (this.quicTransport?.isConnected()) {
      this.quicTransport.subscribePriorityFees();
    } else {
      this.ws.subscribePriorityFees();
    }
  }

  /**
   * Subscribe to latest blockhash updates (every 2s).
   *
   * Listen for updates:
   * ```typescript
   * client.on('latestBlockhash', (data: LatestBlockhash) => { ... });
   * ```
   */
  async subscribeLatestBlockhash(): Promise<void> {
    if (this.quicTransport?.isConnected()) {
      this.quicTransport.subscribeLatestBlockhash();
    } else {
      this.ws.subscribeLatestBlockhash();
    }
  }

  /**
   * Subscribe to latest slot updates (~400ms on slot change).
   *
   * Listen for updates:
   * ```typescript
   * client.on('latestSlot', (data: LatestSlot) => { ... });
   * ```
   */
  async subscribeLatestSlot(): Promise<void> {
    if (this.quicTransport?.isConnected()) {
      this.quicTransport.subscribeLatestSlot();
    } else {
      this.ws.subscribeLatestSlot();
    }
  }

  // ===========================================================================
  // Tip Caching
  // ===========================================================================

  /**
   * Get the most recently received tip instruction (cached).
   */
  getLatestTip(): TipInstruction | null {
    return this.latestTip;
  }

  // ===========================================================================
  // Connection Status
  // ===========================================================================

  connectionStatus(): ConnectionStatus {
    return {
      state: this._connected ? ConnectionState.Connected : ConnectionState.Disconnected,
      protocol: this._connectionInfo?.protocol ?? 'http',
      latencyMs: this.lastLatencyMs,
      region: this._connectionInfo?.region,
    };
  }

  // ===========================================================================
  // Multi-Region Routing
  // ===========================================================================

  async getRoutingRecommendation(): Promise<RoutingRecommendation> {
    return this.http.getRoutingRecommendation();
  }

  // ===========================================================================
  // Token Billing
  // ===========================================================================

  async getBalance(): Promise<Balance> {
    return this.http.getBalance();
  }

  async getDepositAddress(): Promise<TopUpInfo> {
    return this.http.getDepositAddress();
  }

  async getUsageHistory(options: PaginationOptions = {}): Promise<UsageEntry[]> {
    return this.http.getUsageHistory(options);
  }

  async getDepositHistory(options: PaginationOptions = {}): Promise<DepositEntry[]> {
    return this.http.getDepositHistory(options);
  }

  async getPendingDeposit(): Promise<PendingDeposit> {
    return this.http.getPendingDeposit();
  }

  /**
   * Get free tier daily usage statistics.
   *
   * Returns the number of transactions used today, remaining quota,
   * and when the counter resets (UTC midnight).
   * Only meaningful for keys on the 'free' tier.
   */
  async getFreeTierUsage(): Promise<FreeTierUsage> {
    return this.http.getFreeTierUsage();
  }

  /**
   * Get the minimum deposit amount in USD.
   * Deposits below this threshold are held as pending until the cumulative total reaches $10.
   */
  getMinimumDepositUsd(): number {
    return 10.0;
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  metrics(): PerformanceMetrics {
    return {
      transactionsSubmitted: this.txSubmitted,
      transactionsConfirmed: this.txConfirmed,
      averageLatencyMs:
        this.txSubmitted > 0 ? this.totalLatencyMs / this.txSubmitted : 0,
      successRate: this.txSubmitted > 0 ? this.txConfirmed / this.txSubmitted : 0,
    };
  }
}
