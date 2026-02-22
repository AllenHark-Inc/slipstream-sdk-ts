/**
 * @allenhark/slipstream — Configuration builder
 */

import { DEFAULT_DISCOVERY_URL } from './discovery';
import { SlipstreamError } from './errors';
import {
  BackoffStrategy,
  BillingTier,
  PriorityFeeConfig,
  PriorityFeeSpeed,
  ProtocolTimeouts,
  QuicConfig,
  SlipstreamConfig,
} from './types';

const DEFAULT_CONFIG: Omit<SlipstreamConfig, 'apiKey'> = {
  discoveryUrl: DEFAULT_DISCOVERY_URL,
  tier: 'pro',
  connectionTimeout: 10_000,
  maxRetries: 3,
  leaderHints: true,
  streamTipInstructions: false,
  streamPriorityFees: false,
  streamLatestBlockhash: false,
  streamLatestSlot: false,
  protocolTimeouts: {
    quic: 2_000,
    websocket: 3_000,
    http: 5_000,
  },
  priorityFee: {
    enabled: false,
    speed: PriorityFeeSpeed.Fast,
  },
  retryBackoff: BackoffStrategy.Exponential,
  minConfidence: 70,
  keepAlive: true,
  keepAliveIntervalMs: 5_000,
};

export class ConfigBuilder {
  private config: Partial<SlipstreamConfig> = {};

  apiKey(key: string): this {
    this.config.apiKey = key;
    return this;
  }

  /** Set the billing tier. Default is 'pro'.
   * Free/Standard: 0.00005 SOL per tx (5 tps limit).
   * Pro: 0.0001 SOL per tx (20 tps limit).
   * Enterprise: 0.001 SOL per tx (100 tps limit). */
  tier(tier: BillingTier): this {
    this.config.tier = tier;
    return this;
  }

  region(region: string): this {
    this.config.region = region;
    return this;
  }

  endpoint(url: string): this {
    this.config.endpoint = url;
    return this;
  }

  /** Set the WebSocket endpoint URL explicitly (e.g., ws://ip:9000/ws).
   * If not set, derived from endpoint or discovery. */
  wsEndpoint(url: string): this {
    this.config.wsEndpoint = url;
    return this;
  }

  discoveryUrl(url: string): this {
    this.config.discoveryUrl = url;
    return this;
  }

  connectionTimeout(ms: number): this {
    this.config.connectionTimeout = ms;
    return this;
  }

  maxRetries(n: number): this {
    this.config.maxRetries = n;
    return this;
  }

  leaderHints(enabled: boolean): this {
    this.config.leaderHints = enabled;
    return this;
  }

  streamTipInstructions(enabled: boolean): this {
    this.config.streamTipInstructions = enabled;
    return this;
  }

  streamPriorityFees(enabled: boolean): this {
    this.config.streamPriorityFees = enabled;
    return this;
  }

  streamLatestBlockhash(enabled: boolean): this {
    this.config.streamLatestBlockhash = enabled;
    return this;
  }

  streamLatestSlot(enabled: boolean): this {
    this.config.streamLatestSlot = enabled;
    return this;
  }

  protocolTimeouts(timeouts: ProtocolTimeouts): this {
    this.config.protocolTimeouts = timeouts;
    return this;
  }

  priorityFee(config: PriorityFeeConfig): this {
    this.config.priorityFee = config;
    return this;
  }

  retryBackoff(strategy: BackoffStrategy): this {
    this.config.retryBackoff = strategy;
    return this;
  }

  minConfidence(confidence: number): this {
    this.config.minConfidence = confidence;
    return this;
  }

  keepAlive(enabled: boolean): this {
    this.config.keepAlive = enabled;
    return this;
  }

  keepAliveInterval(ms: number): this {
    this.config.keepAliveIntervalMs = ms;
    return this;
  }

  idleTimeout(ms: number): this {
    this.config.idleTimeout = ms;
    return this;
  }

  /** Set webhook URL (HTTPS). If set, SDK auto-registers the webhook on connect. */
  webhookUrl(url: string): this {
    this.config.webhookUrl = url;
    return this;
  }

  /** Set webhook event types to subscribe to (default: ['transaction.confirmed']) */
  webhookEvents(events: string[]): this {
    this.config.webhookEvents = events;
    return this;
  }

  /** Set webhook notification level for transaction events (default: 'final') */
  webhookNotificationLevel(level: string): this {
    this.config.webhookNotificationLevel = level;
    return this;
  }

  quicConfig(config: QuicConfig): this {
    this.config.quic = config;
    return this;
  }

  build(): SlipstreamConfig {
    if (!this.config.apiKey) {
      throw SlipstreamError.config('apiKey is required');
    }

    if (this.config.minConfidence !== undefined) {
      if (this.config.minConfidence < 0 || this.config.minConfidence > 100) {
        throw SlipstreamError.config('minConfidence must be between 0 and 100');
      }
    }

    return {
      ...DEFAULT_CONFIG,
      ...this.config,
    } as SlipstreamConfig;
  }
}

export function configBuilder(): ConfigBuilder {
  return new ConfigBuilder();
}

/**
 * Get the HTTP base URL from config.
 *
 * After discovery, this returns the worker's HTTP management endpoint
 * which serves billing proxy routes (/v1/balance, etc.) and REST API.
 * Falls back to localhost:9091 for local development.
 */
export function getHttpEndpoint(config: SlipstreamConfig): string {
  if (config.endpoint) {
    return config.endpoint.replace(/\/$/, '');
  }
  // Fallback for local development (worker management port)
  return 'http://localhost:9091';
}

/**
 * Get the QUIC endpoint URL from config.
 */
export function getQuicEndpoint(config: SlipstreamConfig): string {
  if (config.endpoint) {
    const url = new URL(config.endpoint);
    return `quic://${url.hostname}:4433`;
  }
  return '';
}

/**
 * Get the WebSocket URL from config.
 *
 * Uses explicit wsEndpoint if set (from discovery with separate WS port),
 * otherwise derives from the HTTP endpoint.
 */
export function getWsEndpoint(config: SlipstreamConfig): string {
  if (config.wsEndpoint) {
    return config.wsEndpoint;
  }
  if (config.endpoint) {
    return config.endpoint.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  }
  return '';
}
