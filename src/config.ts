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

  idleTimeout(ms: number): this {
    this.config.idleTimeout = ms;
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
 * If an explicit endpoint is set, uses that.
 * Otherwise, discovery must be called first to resolve a worker endpoint.
 * Falls back to discovery URL as a last resort for control plane API calls.
 */
export function getHttpEndpoint(config: SlipstreamConfig): string {
  if (config.endpoint) {
    return config.endpoint.replace(/\/$/, '');
  }
  // When no endpoint is set, use the discovery URL for control plane API calls.
  // Worker connections are resolved via discovery in client.connect().
  return config.discoveryUrl.replace(/\/$/, '');
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
 */
export function getWsEndpoint(config: SlipstreamConfig): string {
  if (config.endpoint) {
    return config.endpoint.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  }
  // Placeholder — real WS endpoint is resolved via discovery
  return '';
}
