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
import { WebSocketTransport } from './transport/websocket';
import {
  Balance,
  ConnectionInfo,
  ConnectionState,
  ConnectionStatus,
  DepositEntry,
  LeaderHint,
  PaginationOptions,
  PendingDeposit,
  PerformanceMetrics,
  PriorityFee,
  RoutingRecommendation,
  SlipstreamConfig,
  SubmitOptions,
  TipInstruction,
  TopUpInfo,
  TransactionResult,
  UsageEntry,
} from './types';

export class SlipstreamClient extends EventEmitter {
  private readonly _config: SlipstreamConfig;
  private readonly http: HttpTransport;
  private readonly ws: WebSocketTransport;
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
    this.ws = new WebSocketTransport(wsUrl, config.apiKey, config.region);

    // Forward WS events
    this.ws.on('leaderHint', (hint: LeaderHint) => this.emit('leaderHint', hint));
    this.ws.on('tipInstruction', (tip: TipInstruction) => {
      this.latestTip = tip;
      this.emit('tipInstruction', tip);
    });
    this.ws.on('priorityFee', (fee: PriorityFee) => this.emit('priorityFee', fee));
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
   */
  static async connect(config: SlipstreamConfig): Promise<SlipstreamClient> {
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
    await this.ws.disconnect();
    this._connected = false;
  }

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  /**
   * Submit a signed transaction.
   *
   * Prefers WebSocket if connected, falls back to HTTP.
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
      if (this.ws.isConnected()) {
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
    this.ws.subscribeLeaderHints();
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
    this.ws.subscribeTipInstructions();
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
    this.ws.subscribePriorityFees();
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
