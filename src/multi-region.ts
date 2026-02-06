/**
 * @allenhark/slipstream — MultiRegionClient
 *
 * Manages connections to workers across multiple regions and auto-routes
 * transactions based on leader hints for optimal latency.
 *
 * @example
 * ```typescript
 * import { MultiRegionClient, configBuilder } from '@allenhark/slipstream';
 *
 * const config = configBuilder()
 *   .apiKey('sk_test_12345678')
 *   .leaderHints(true)
 *   .build();
 *
 * const workers = [
 *   { id: 'w1', region: 'us-east', http: 'https://us-east.example.com', websocket: 'wss://us-east.example.com/ws' },
 *   { id: 'w2', region: 'eu-central', http: 'https://eu-central.example.com', websocket: 'wss://eu-central.example.com/ws' },
 * ];
 *
 * const multi = await MultiRegionClient.create(config, workers, {
 *   autoFollowLeader: true,
 *   minSwitchConfidence: 70,
 *   switchCooldownMs: 5000,
 *   broadcastHighPriority: false,
 *   maxBroadcastRegions: 3,
 * });
 *
 * const result = await multi.submitTransaction(txBytes);
 * ```
 */

import { EventEmitter } from 'events';
import { SlipstreamError } from './errors';
import { SlipstreamClient } from './client';
import {
  FallbackStrategy,
  LeaderHint,
  MultiRegionConfig,
  RoutingRecommendation,
  SlipstreamConfig,
  SubmitOptions,
  TransactionResult,
  WorkerEndpoint,
} from './types';

export class MultiRegionClient extends EventEmitter {
  private readonly baseConfig: SlipstreamConfig;
  private readonly multiConfig: MultiRegionConfig;
  private readonly clients = new Map<string, SlipstreamClient>();
  private readonly workersByRegion = new Map<string, WorkerEndpoint[]>();
  private currentRouting: RoutingRecommendation | null = null;
  private lastSwitchTime = 0;

  private constructor(config: SlipstreamConfig, multiConfig: MultiRegionConfig) {
    super();
    this.baseConfig = config;
    this.multiConfig = multiConfig;
  }

  static async create(
    config: SlipstreamConfig,
    workers: WorkerEndpoint[],
    multiConfig: MultiRegionConfig,
  ): Promise<MultiRegionClient> {
    const multi = new MultiRegionClient(config, multiConfig);

    // Group workers by region
    for (const worker of workers) {
      const existing = multi.workersByRegion.get(worker.region) ?? [];
      existing.push(worker);
      multi.workersByRegion.set(worker.region, existing);
    }

    // Connect to the preferred region first (or first available)
    const primaryRegion = config.region ?? workers[0]?.region;
    if (primaryRegion) {
      await multi.ensureRegionConnected(primaryRegion);
    }

    // Start listening for leader hints to auto-route
    if (multiConfig.autoFollowLeader) {
      const primaryClient = multi.clients.get(primaryRegion ?? '');
      if (primaryClient) {
        primaryClient.on('leaderHint', (hint: LeaderHint) => {
          multi.updateRoutingFromHint(hint);
        });
      }
    }

    return multi;
  }

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  async submitTransaction(transaction: Uint8Array): Promise<TransactionResult> {
    return this.submitTransactionWithOptions(transaction, {});
  }

  async submitTransactionWithOptions(
    transaction: Uint8Array,
    options: SubmitOptions,
  ): Promise<TransactionResult> {
    // Broadcast mode: send to multiple regions simultaneously
    if (options.broadcastMode || this.isHighPriority(options)) {
      return this.broadcastTransaction(transaction, options);
    }

    // Use routing recommendation to pick best region
    const region = this.currentRouting?.bestRegion ?? this.getDefaultRegion();

    try {
      return await this.submitToRegion(region, transaction, options);
    } catch (err) {
      // Try fallback regions
      const fallbackRegions = this.currentRouting?.fallbackRegions ?? [];
      for (const fallback of fallbackRegions) {
        try {
          return await this.submitToRegion(fallback, transaction, options);
        } catch {
          continue;
        }
      }
      throw err;
    }
  }

  // ===========================================================================
  // Routing
  // ===========================================================================

  getCurrentRouting(): RoutingRecommendation | null {
    return this.currentRouting;
  }

  connectedRegions(): string[] {
    return Array.from(this.clients.keys());
  }

  async disconnectAll(): Promise<void> {
    const disconnects = Array.from(this.clients.values()).map((c) => c.disconnect());
    await Promise.allSettled(disconnects);
    this.clients.clear();
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private async submitToRegion(
    region: string,
    transaction: Uint8Array,
    options: SubmitOptions,
  ): Promise<TransactionResult> {
    await this.ensureRegionConnected(region);
    const client = this.clients.get(region);
    if (!client) {
      throw SlipstreamError.connection(`No client for region: ${region}`);
    }
    return client.submitTransactionWithOptions(transaction, options);
  }

  private async broadcastTransaction(
    transaction: Uint8Array,
    options: SubmitOptions,
  ): Promise<TransactionResult> {
    const regions = this.getBroadcastRegions();

    const results = await Promise.allSettled(
      regions.map((region) => this.submitToRegion(region, transaction, options)),
    );

    // Return first successful result
    for (const result of results) {
      if (result.status === 'fulfilled') {
        return result.value;
      }
    }

    // All failed — throw first error
    const firstError = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    throw firstError?.reason ?? SlipstreamError.transaction('All broadcast regions failed');
  }

  private async ensureRegionConnected(region: string): Promise<void> {
    if (this.clients.has(region)) return;

    const workers = this.workersByRegion.get(region);
    if (!workers || workers.length === 0) {
      throw SlipstreamError.config(`No workers in region: ${region}`);
    }

    // Pick first worker's endpoint for connection
    const worker = workers[0];
    const regionConfig: SlipstreamConfig = {
      ...this.baseConfig,
      region,
      endpoint: worker.http,
    };

    const client = await SlipstreamClient.connect(regionConfig);
    this.clients.set(region, client);

    // Forward events
    client.on('leaderHint', (hint: LeaderHint) => {
      this.emit('leaderHint', hint);
      if (this.multiConfig.autoFollowLeader) {
        this.updateRoutingFromHint(hint);
      }
    });
  }

  private updateRoutingFromHint(hint: LeaderHint): void {
    const now = Date.now();
    if (now - this.lastSwitchTime < this.multiConfig.switchCooldownMs) {
      return;
    }

    if (hint.confidence < this.multiConfig.minSwitchConfidence) {
      return;
    }

    this.currentRouting = {
      bestRegion: hint.preferredRegion,
      leaderPubkey: hint.leaderPubkey,
      slot: hint.slot,
      confidence: hint.confidence,
      expectedRttMs: hint.metadata.tpuRttMs,
      fallbackRegions: hint.backupRegions,
      fallbackStrategy: FallbackStrategy.Sequential,
      validForMs: 1000,
    };

    this.lastSwitchTime = now;
    this.emit('routingUpdate', this.currentRouting);
  }

  private getDefaultRegion(): string {
    return this.baseConfig.region ?? this.connectedRegions()[0] ?? 'us-east';
  }

  private getBroadcastRegions(): string[] {
    const all = Array.from(this.workersByRegion.keys());
    return all.slice(0, this.multiConfig.maxBroadcastRegions);
  }

  private isHighPriority(options: SubmitOptions): boolean {
    return (
      this.multiConfig.broadcastHighPriority &&
      options.broadcastMode === true
    );
  }
}
