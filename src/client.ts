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
import { discover, bestRegion, workersForRegion, workersToEndpoints } from './discovery';
import { SlipstreamError } from './errors';
import { WorkerSelector } from './worker-selector';
import { SolanaRpc } from './rpc';
import { HttpTransport } from './transport/http';
import { QuicTransport } from './transport/quic';
import { WebSocketTransport } from './transport/websocket';
import {
  Balance,
  BundleResult,
  ConnectionInfo,
  ConnectionState,
  ConnectionStatus,
  DepositEntry,
  FreeTierUsage,
  LandingRateOptions,
  LandingRateStats,
  LatestBlockhash,
  LatestSlot,
  LeaderHint,
  PaginationOptions,
  PendingDeposit,
  PerformanceMetrics,
  PingResult,
  PriorityFee,
  RegionInfo,
  RegisterWebhookRequest,
  SenderInfo,
  RoutingRecommendation,
  SimulationResult,
  SlipstreamConfig,
  SubmitOptions,
  TipInstruction,
  TopUpInfo,
  TransactionResult,
  UsageEntry,
  WebhookConfig,
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

  /** Typed Solana RPC interface. Use `client.rpc.getSlot()`, `client.rpc.getBalance(pubkey)`, etc. */
  readonly rpc: SolanaRpc;
  private quicTransport: QuicTransport | null = null;
  private _connectionInfo: ConnectionInfo | null = null;
  private _connected = false;
  private latestTip: TipInstruction | null = null;
  private pollingTimers: ReturnType<typeof setInterval>[] = [];

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
    this.rpc = new SolanaRpc((method, params) => this.http.rpc(method, params));

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

      // Convert to endpoints and rank by latency
      const endpoints = workersToEndpoints(workers);
      const selector = new WorkerSelector(endpoints);
      const rtts = await selector.measureAll();

      // Sort by RTT (lowest first), unreachable at end
      const ranked = [...endpoints].sort((a, b) => {
        const rttA = rtts.get(a.id) ?? Infinity;
        const rttB = rtts.get(b.id) ?? Infinity;
        return rttA - rttB;
      });

      // Try workers in latency order — fall to next on complete failure
      let lastError: Error | null = null;
      for (let i = 0; i < ranked.length; i++) {
        const worker = ranked[i];
        const workerConfig: SlipstreamConfig = {
          ...config,
          region,
          endpoint: worker.http,
          wsEndpoint: worker.websocket,
        };

        try {
          const client = await SlipstreamClient.tryConnect(workerConfig, quicTransport);
          return client;
        } catch (err) {
          lastError = err as Error;
          // Try next worker
        }
      }

      throw lastError ?? SlipstreamError.connection(
        `All workers in region '${region}' rejected connection`,
      );
    }

    // Explicit endpoint set — connect directly
    return SlipstreamClient.tryConnect(config, quicTransport);
  }

  /**
   * Attempt connection to a single worker endpoint using the full protocol
   * fallback chain: QUIC → WebSocket → HTTP.
   * @internal
   */
  private static async tryConnect(
    config: SlipstreamConfig,
    quicTransport?: QuicTransport,
  ): Promise<SlipstreamClient> {
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

        await Promise.all([client.autoRegisterWebhook(), client.fetchInitialTip()]);
        return client;
      } catch {
        // QUIC failed — fall through to WS → HTTP chain
      }
    }

    try {
      const wsTimeout = config.protocolTimeouts.websocket ?? 3_000;
      const connInfo = await Promise.race([
        client.ws.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('WebSocket timeout')),
            wsTimeout,
          ),
        ),
      ]);
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

      await Promise.all([client.autoRegisterWebhook(), client.fetchInitialTip()]);
      return client;
    } catch (err) {
      // WebSocket failed — fall back to HTTP-only mode with polling
      const wsErr = err instanceof Error ? err.message : String(err);
      console.warn(`[slipstream] WebSocket connection failed (${wsErr}), falling back to HTTP polling`);

      // Clean up the WS transport so it doesn't keep reconnecting in background
      client.ws.disconnect().catch(() => {});

      client._connectionInfo = {
        sessionId: '',
        protocol: 'http',
        region: config.region,
        serverTime: Date.now(),
        features: [],
        rateLimit: { rps: 100, burst: 200 },
      };
      client._connected = true;

      // Start HTTP polling for any configured stream subscriptions
      if (config.leaderHints) client.startPolling('leaderHint');
      if (config.streamTipInstructions) client.startPolling('tipInstruction');
      if (config.streamPriorityFees) client.startPolling('priorityFee');
      if (config.streamLatestBlockhash) client.startPolling('latestBlockhash');
      if (config.streamLatestSlot) client.startPolling('latestSlot');

      await Promise.all([client.autoRegisterWebhook(), client.fetchInitialTip()]);
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
    // Stop all HTTP polling timers
    this.pollingTimers.forEach((t) => clearInterval(t));
    this.pollingTimers = [];

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
    } else if (this.ws.isConnected()) {
      this.ws.subscribeLeaderHints();
    } else {
      this.startPolling('leaderHint');
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
    } else if (this.ws.isConnected()) {
      this.ws.subscribeTipInstructions();
    } else {
      this.startPolling('tipInstruction');
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
    } else if (this.ws.isConnected()) {
      this.ws.subscribePriorityFees();
    } else {
      this.startPolling('priorityFee');
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
    } else if (this.ws.isConnected()) {
      this.ws.subscribeLatestBlockhash();
    } else {
      this.startPolling('latestBlockhash');
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
    } else if (this.ws.isConnected()) {
      this.ws.subscribeLatestSlot();
    } else {
      this.startPolling('latestSlot');
    }
  }

  // ===========================================================================
  // HTTP Polling (fallback when QUIC and WebSocket are unavailable)
  // ===========================================================================

  private isHttpOnly(): boolean {
    return this._connectionInfo?.protocol === 'http';
  }

  private startPolling(type: string): void {
    const intervals: Record<string, number> = {
      leaderHint: 2000,
      tipInstruction: 5000,
      priorityFee: 5000,
      latestBlockhash: 2000,
      latestSlot: 2000,
    };
    const ms = intervals[type] ?? 5000;

    const poll = async () => {
      try {
        switch (type) {
          case 'leaderHint': {
            const hint = await this.http.getLeaderHint();
            if (hint) this.emit('leaderHint', hint);
            break;
          }
          case 'tipInstruction': {
            const tips = await this.http.getTipInstructions();
            for (const tip of tips) {
              this.latestTip = tip;
              this.emit('tipInstruction', tip);
            }
            break;
          }
          case 'priorityFee': {
            const fees = await this.http.getPriorityFees();
            for (const fee of fees) this.emit('priorityFee', fee);
            break;
          }
          case 'latestBlockhash': {
            const bh = await this.http.getLatestBlockhashData();
            if (bh) this.emit('latestBlockhash', bh);
            break;
          }
          case 'latestSlot': {
            const slot = await this.http.getLatestSlotData();
            if (slot) this.emit('latestSlot', slot);
            break;
          }
        }
      } catch {
        // Polling errors are non-fatal — continue
      }
    };

    // Initial fetch so first value is available immediately
    poll();
    const timer = setInterval(poll, ms);
    this.pollingTimers.push(timer);
  }

  // ===========================================================================
  // Tip Caching
  // ===========================================================================

  /**
   * Eagerly fetch tip instructions from the HTTP endpoint so
   * getLatestTip() is populated immediately after connect().
   */
  private async fetchInitialTip(): Promise<void> {
    try {
      const tips = await this.http.getTipInstructions();
      if (tips.length > 0) {
        this.latestTip = tips[tips.length - 1];
      }
    } catch {
      // Non-fatal — tip will be populated by streaming later
    }
  }

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

  /**
   * Get all configured regions.
   *
   * Returns a list of regions with their IDs, display names, endpoints,
   * and geolocation coordinates. This endpoint does not require authentication.
   */
  async getRegions(): Promise<RegionInfo[]> {
    return this.http.getRegions();
  }

  /**
   * Get all configured senders with their tip wallets and pricing tiers.
   *
   * Essential for building transactions in both broadcast and streaming modes.
   * Returns sender IDs, display names, tip wallet addresses, and tip tiers
   * with pricing and expected latency.
   */
  async getSenders(): Promise<SenderInfo[]> {
    return this.http.getSenders();
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

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  /**
   * Register or update a webhook for this API key.
   *
   * Returns the webhook configuration including the secret (only visible on register/update).
   */
  async registerWebhook(
    url: string,
    events?: string[],
    notificationLevel?: string,
  ): Promise<WebhookConfig> {
    const body: RegisterWebhookRequest = { url };
    if (events) body.events = events;
    if (notificationLevel) body.notificationLevel = notificationLevel;

    return this.http.registerWebhook(body);
  }

  /**
   * Get current webhook configuration for this API key.
   *
   * Returns the webhook config with the secret masked, or null if none is configured.
   */
  async getWebhook(): Promise<WebhookConfig | null> {
    return this.http.getWebhook();
  }

  /**
   * Delete (disable) the webhook for this API key.
   */
  async deleteWebhook(): Promise<void> {
    return this.http.deleteWebhook();
  }

  // ===========================================================================
  // Landing Rates
  // ===========================================================================

  /**
   * Get transaction landing rate statistics for this API key.
   *
   * Returns overall landing rate plus per-sender and per-region breakdowns.
   * Defaults to the last 24 hours if no time range is specified.
   */
  async getLandingRates(options?: LandingRateOptions): Promise<LandingRateStats> {
    return this.http.getLandingRates(options);
  }

  // ===========================================================================
  // Bundle Submission
  // ===========================================================================

  /**
   * Submit a bundle of transactions for atomic execution.
   *
   * Bundles contain 2-5 transactions that are executed atomically — either
   * all succeed or none. The sender must support bundle submission.
   *
   * @param transactions - 2 to 5 signed transactions (Uint8Array or Buffer)
   * @param tipLamports - Optional tip amount in lamports
   * @returns Bundle result with bundle ID, acceptance status, and signatures
   *
   * Billing: 5 tokens (0.00025 SOL) per bundle regardless of transaction count.
   */
  async submitBundle(
    transactions: Array<Uint8Array | Buffer>,
    tipLamports?: number,
  ): Promise<BundleResult> {
    if (transactions.length < 2 || transactions.length > 5) {
      throw new SlipstreamError('Bundle must contain 2-5 transactions', 'VALIDATION_ERROR');
    }
    return this.http.submitBundle(transactions, tipLamports);
  }

  // === Solana RPC Proxy ===

  /**
   * Simulate a transaction without submitting it to the network.
   *
   * Costs 1 token. Returns simulation result with logs and compute units.
   */
  async simulateTransaction(transaction: Uint8Array | Buffer): Promise<SimulationResult> {
    const txB64 = Buffer.from(transaction).toString('base64');
    return this.rpc.simulateTransaction(txB64, {
      encoding: 'base64',
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
    });
  }

  /**
   * Simulate each transaction in a bundle sequentially.
   *
   * Costs 1 token per transaction simulated. Stops on first failure.
   * Returns an array of SimulationResult (one per transaction attempted).
   */
  async simulateBundle(
    transactions: Array<Uint8Array | Buffer>,
  ): Promise<SimulationResult[]> {
    const results: SimulationResult[] = [];
    for (const tx of transactions) {
      const sim = await this.simulateTransaction(tx);
      results.push(sim);
      if (sim.err) break;
    }
    return results;
  }

  /** @internal Auto-register webhook from config if webhookUrl is set */
  private async autoRegisterWebhook(): Promise<void> {
    if (!this._config.webhookUrl) return;
    try {
      await this.registerWebhook(
        this._config.webhookUrl,
        this._config.webhookEvents ?? ['transaction.confirmed'],
        this._config.webhookNotificationLevel ?? 'final',
      );
    } catch {
      // Non-fatal — webhook registration can be retried
    }
  }
}
