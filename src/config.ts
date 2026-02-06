/**
 * @allenhark/slipstream — Configuration builder
 */

import { SlipstreamError } from './errors';
import {
  BackoffStrategy,
  PriorityFeeConfig,
  PriorityFeeSpeed,
  ProtocolTimeouts,
  SlipstreamConfig,
} from './types';

const DEFAULT_CONFIG: Omit<SlipstreamConfig, 'apiKey'> = {
  connectionTimeout: 10_000,
  maxRetries: 3,
  leaderHints: true,
  streamTipInstructions: false,
  streamPriorityFees: false,
  protocolTimeouts: {
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

  region(region: string): this {
    this.config.region = region;
    return this;
  }

  endpoint(url: string): this {
    this.config.endpoint = url;
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
 * Uses explicit endpoint if set, otherwise derives from region.
 */
export function getHttpEndpoint(config: SlipstreamConfig): string {
  if (config.endpoint) {
    return config.endpoint.replace(/\/$/, '');
  }
  // Default control plane endpoint
  const region = config.region ?? 'us-east';
  return `https://${region}.slipstream.allenhark.com`;
}

/**
 * Get the WebSocket URL from config.
 */
export function getWsEndpoint(config: SlipstreamConfig): string {
  const httpUrl = getHttpEndpoint(config);
  return httpUrl.replace(/^http/, 'ws') + '/ws';
}
