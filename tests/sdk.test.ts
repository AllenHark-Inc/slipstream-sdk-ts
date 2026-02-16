import { ConfigBuilder, configBuilder, getHttpEndpoint, getWsEndpoint, getQuicEndpoint } from '../src/config';
import { SlipstreamError } from '../src/errors';
import {
  BackoffStrategy,
  BillingTier,
  BundleResult,
  ConnectionState,
  FallbackStrategy,
  LandingRateStats,
  LatestBlockhash,
  LatestSlot,
  LeaderHint,
  MultiRegionConfig,
  PriorityFee,
  PriorityFeeSpeed,
  RpcResponse,
  SlipstreamConfig,
  SubmitOptions,
  TransactionResult,
  TransactionStatus,
  WebhookEvent,
  WebhookNotificationLevel,
} from '../src/types';

// ============================================================================
// ConfigBuilder Tests
// ============================================================================

describe('ConfigBuilder', () => {
  test('builds config with required api key', () => {
    const config = configBuilder().apiKey('sk_test_123').build();
    expect(config.apiKey).toBe('sk_test_123');
    expect(config.tier).toBe('pro');
    expect(config.connectionTimeout).toBe(10_000);
    expect(config.maxRetries).toBe(3);
    expect(config.leaderHints).toBe(true);
    expect(config.keepAlive).toBe(true);
    expect(config.minConfidence).toBe(70);
  });

  test('throws on missing api key', () => {
    expect(() => configBuilder().build()).toThrow(SlipstreamError);
    expect(() => configBuilder().build()).toThrow('apiKey is required');
  });

  test('builds with all options', () => {
    const config = configBuilder()
      .apiKey('sk_live_abc')
      .region('us-west')
      .endpoint('https://worker.example.com')
      .tier('enterprise' as BillingTier)
      .connectionTimeout(5_000)
      .maxRetries(5)
      .leaderHints(false)
      .streamTipInstructions(true)
      .streamPriorityFees(true)
      .streamLatestBlockhash(true)
      .streamLatestSlot(true)
      .minConfidence(90)
      .keepAlive(false)
      .keepAliveInterval(10_000)
      .idleTimeout(30_000)
      .retryBackoff(BackoffStrategy.Linear)
      .webhookUrl('https://example.com/webhook')
      .webhookEvents(['transaction.confirmed', 'transaction.failed'])
      .webhookNotificationLevel('all')
      .build();

    expect(config.region).toBe('us-west');
    expect(config.endpoint).toBe('https://worker.example.com');
    expect(config.tier).toBe('enterprise');
    expect(config.connectionTimeout).toBe(5_000);
    expect(config.maxRetries).toBe(5);
    expect(config.leaderHints).toBe(false);
    expect(config.streamTipInstructions).toBe(true);
    expect(config.streamPriorityFees).toBe(true);
    expect(config.streamLatestBlockhash).toBe(true);
    expect(config.streamLatestSlot).toBe(true);
    expect(config.minConfidence).toBe(90);
    expect(config.keepAlive).toBe(false);
    expect(config.keepAliveIntervalMs).toBe(10_000);
    expect(config.idleTimeout).toBe(30_000);
    expect(config.retryBackoff).toBe(BackoffStrategy.Linear);
    expect(config.webhookUrl).toBe('https://example.com/webhook');
    expect(config.webhookEvents).toEqual(['transaction.confirmed', 'transaction.failed']);
    expect(config.webhookNotificationLevel).toBe('all');
  });

  test('rejects invalid minConfidence', () => {
    expect(() => configBuilder().apiKey('sk_test_123').minConfidence(-1).build()).toThrow('minConfidence');
    expect(() => configBuilder().apiKey('sk_test_123').minConfidence(101).build()).toThrow('minConfidence');
  });

  test('protocol timeouts have correct defaults', () => {
    const config = configBuilder().apiKey('sk_test_123').build();
    expect(config.protocolTimeouts.quic).toBe(2_000);
    expect(config.protocolTimeouts.websocket).toBe(3_000);
    expect(config.protocolTimeouts.http).toBe(5_000);
  });

  test('custom protocol timeouts', () => {
    const config = configBuilder()
      .apiKey('sk_test_123')
      .protocolTimeouts({ quic: 1_000, websocket: 2_000, http: 3_000 })
      .build();
    expect(config.protocolTimeouts.quic).toBe(1_000);
    expect(config.protocolTimeouts.websocket).toBe(2_000);
    expect(config.protocolTimeouts.http).toBe(3_000);
  });

  test('priority fee config', () => {
    const config = configBuilder()
      .apiKey('sk_test_123')
      .priorityFee({ enabled: true, speed: PriorityFeeSpeed.UltraFast, maxTip: 0.01 })
      .build();
    expect(config.priorityFee.enabled).toBe(true);
    expect(config.priorityFee.speed).toBe(PriorityFeeSpeed.UltraFast);
    expect(config.priorityFee.maxTip).toBe(0.01);
  });

  test('configBuilder factory returns new instance', () => {
    const b1 = configBuilder();
    const b2 = configBuilder();
    expect(b1).not.toBe(b2);
  });
});

// ============================================================================
// Endpoint Helper Tests
// ============================================================================

describe('Endpoint Helpers', () => {
  const baseConfig = configBuilder().apiKey('sk_test_123').build();

  test('getHttpEndpoint uses discovery URL when no endpoint', () => {
    const url = getHttpEndpoint(baseConfig);
    expect(url).not.toBe('');
    expect(url).not.toMatch(/\/$/);
  });

  test('getHttpEndpoint uses explicit endpoint', () => {
    const config = configBuilder().apiKey('sk_test_123').endpoint('https://worker.example.com/').build();
    expect(getHttpEndpoint(config)).toBe('https://worker.example.com');
  });

  test('getWsEndpoint replaces http with ws', () => {
    const config = configBuilder().apiKey('sk_test_123').endpoint('https://worker.example.com').build();
    expect(getWsEndpoint(config)).toBe('wss://worker.example.com/ws');
  });

  test('getWsEndpoint returns empty when no endpoint', () => {
    expect(getWsEndpoint(baseConfig)).toBe('');
  });

  test('getQuicEndpoint extracts hostname', () => {
    const config = configBuilder().apiKey('sk_test_123').endpoint('https://worker.example.com').build();
    expect(getQuicEndpoint(config)).toBe('quic://worker.example.com:4433');
  });

  test('getQuicEndpoint returns empty when no endpoint', () => {
    expect(getQuicEndpoint(baseConfig)).toBe('');
  });
});

// ============================================================================
// SlipstreamError Tests
// ============================================================================

describe('SlipstreamError', () => {
  test('config error', () => {
    const err = SlipstreamError.config('bad config');
    expect(err).toBeInstanceOf(SlipstreamError);
    expect(err.code).toBe('CONFIG');
    expect(err.message).toBe('bad config');
  });

  test('connection error', () => {
    const err = SlipstreamError.connection('conn failed');
    expect(err.code).toBe('CONNECTION');
  });

  test('auth error', () => {
    const err = SlipstreamError.auth('unauthorized');
    expect(err.code).toBe('AUTH');
  });

  test('protocol error', () => {
    const err = SlipstreamError.protocol('unsupported');
    expect(err.code).toBe('PROTOCOL');
  });

  test('transaction error', () => {
    const err = SlipstreamError.transaction('tx failed');
    expect(err.code).toBe('TRANSACTION');
  });

  test('timeout error includes ms', () => {
    const err = SlipstreamError.timeout(5000);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toContain('5000');
  });

  test('allProtocolsFailed', () => {
    const err = SlipstreamError.allProtocolsFailed();
    expect(err.code).toBe('ALL_PROTOCOLS_FAILED');
  });

  test('rateLimited with default message', () => {
    const err = SlipstreamError.rateLimited();
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.message).toBe('Rate limited');
  });

  test('notConnected', () => {
    const err = SlipstreamError.notConnected();
    expect(err.code).toBe('NOT_CONNECTED');
  });

  test('streamClosed', () => {
    const err = SlipstreamError.streamClosed();
    expect(err.code).toBe('STREAM_CLOSED');
  });

  test('insufficientTokens', () => {
    const err = SlipstreamError.insufficientTokens();
    expect(err.code).toBe('INSUFFICIENT_TOKENS');
  });

  test('internal error', () => {
    const err = SlipstreamError.internal('oops');
    expect(err.code).toBe('INTERNAL');
    expect(err.message).toBe('oops');
  });

  test('error has details', () => {
    const err = new SlipstreamError('CUSTOM', 'msg', { foo: 'bar' });
    expect(err.details).toEqual({ foo: 'bar' });
  });

  test('is instance of Error', () => {
    const err = SlipstreamError.config('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SlipstreamError');
  });
});

// ============================================================================
// Type Enum Tests
// ============================================================================

describe('Enums', () => {
  test('TransactionStatus values', () => {
    expect(TransactionStatus.Pending).toBe('pending');
    expect(TransactionStatus.Processing).toBe('processing');
    expect(TransactionStatus.Sent).toBe('sent');
    expect(TransactionStatus.Confirmed).toBe('confirmed');
    expect(TransactionStatus.Failed).toBe('failed');
    expect(TransactionStatus.Duplicate).toBe('duplicate');
    expect(TransactionStatus.RateLimited).toBe('rate_limited');
    expect(TransactionStatus.InsufficientTokens).toBe('insufficient_tokens');
  });

  test('ConnectionState values', () => {
    expect(ConnectionState.Disconnected).toBe('disconnected');
    expect(ConnectionState.Connecting).toBe('connecting');
    expect(ConnectionState.Connected).toBe('connected');
    expect(ConnectionState.Error).toBe('error');
  });

  test('FallbackStrategy values', () => {
    expect(FallbackStrategy.Sequential).toBe('sequential');
    expect(FallbackStrategy.Broadcast).toBe('broadcast');
    expect(FallbackStrategy.Retry).toBe('retry');
    expect(FallbackStrategy.None).toBe('none');
  });

  test('PriorityFeeSpeed values', () => {
    expect(PriorityFeeSpeed.Slow).toBe('slow');
    expect(PriorityFeeSpeed.Fast).toBe('fast');
    expect(PriorityFeeSpeed.UltraFast).toBe('ultra_fast');
  });

  test('BackoffStrategy values', () => {
    expect(BackoffStrategy.Linear).toBe('linear');
    expect(BackoffStrategy.Exponential).toBe('exponential');
  });

  test('WebhookEvent values', () => {
    expect(WebhookEvent.TransactionSent).toBe('transaction.sent');
    expect(WebhookEvent.TransactionConfirmed).toBe('transaction.confirmed');
    expect(WebhookEvent.TransactionFailed).toBe('transaction.failed');
    expect(WebhookEvent.BundleSent).toBe('bundle.sent');
    expect(WebhookEvent.BundleConfirmed).toBe('bundle.confirmed');
    expect(WebhookEvent.BundleFailed).toBe('bundle.failed');
    expect(WebhookEvent.BillingLowBalance).toBe('billing.low_balance');
    expect(WebhookEvent.BillingDepleted).toBe('billing.depleted');
    expect(WebhookEvent.BillingDepositReceived).toBe('billing.deposit_received');
  });

  test('WebhookNotificationLevel values', () => {
    expect(WebhookNotificationLevel.All).toBe('all');
    expect(WebhookNotificationLevel.Final).toBe('final');
    expect(WebhookNotificationLevel.Confirmed).toBe('confirmed');
  });
});

// ============================================================================
// Type Interface Tests (structural)
// ============================================================================

describe('Type Structures', () => {
  test('TransactionResult shape', () => {
    const result: TransactionResult = {
      requestId: 'req-1',
      transactionId: 'tx-1',
      signature: 'abc123',
      status: TransactionStatus.Confirmed,
      slot: 12345,
      timestamp: Date.now(),
      routing: {
        region: 'us-west',
        sender: '0slot',
        routingLatencyMs: 1,
        senderLatencyMs: 5,
        totalLatencyMs: 6,
      },
    };
    expect(result.requestId).toBe('req-1');
    expect(result.status).toBe(TransactionStatus.Confirmed);
    expect(result.routing!.region).toBe('us-west');
    expect(result.routing!.totalLatencyMs).toBe(6);
  });

  test('TransactionResult with error', () => {
    const result: TransactionResult = {
      requestId: 'req-2',
      transactionId: 'tx-2',
      status: TransactionStatus.Failed,
      timestamp: Date.now(),
      error: { code: 'SENDER_ERROR', message: 'Sender unavailable' },
    };
    expect(result.error!.code).toBe('SENDER_ERROR');
  });

  test('LeaderHint shape', () => {
    const hint: LeaderHint = {
      timestamp: Date.now(),
      slot: 100,
      expiresAtSlot: 104,
      preferredRegion: 'eu-west',
      backupRegions: ['us-east', 'asia'],
      confidence: 85,
      leaderPubkey: 'Validator1...',
      metadata: {
        tpuRttMs: 15,
        regionScore: 92,
        leaderTpuAddress: '1.2.3.4:8001',
        regionRttMs: { 'eu-west': 15, 'us-east': 80 },
      },
    };
    expect(hint.confidence).toBe(85);
    expect(hint.metadata.regionRttMs!['eu-west']).toBe(15);
  });

  test('PriorityFee shape', () => {
    const fee: PriorityFee = {
      timestamp: Date.now(),
      speed: 'fast',
      computeUnitPrice: 1500,
      computeUnitLimit: 200_000,
      estimatedCostSol: 0.0003,
      landingProbability: 0.95,
      networkCongestion: 'medium',
      recentSuccessRate: 0.92,
    };
    expect(fee.computeUnitPrice).toBe(1500);
    expect(fee.landingProbability).toBe(0.95);
  });

  test('LatestBlockhash shape', () => {
    const bh: LatestBlockhash = {
      blockhash: 'GHtXQBsoZE8Z...',
      lastValidBlockHeight: 180_000_000,
      timestamp: Date.now(),
    };
    expect(bh.blockhash).toBeTruthy();
  });

  test('LatestSlot shape', () => {
    const slot: LatestSlot = {
      slot: 250_000_000,
      timestamp: Date.now(),
    };
    expect(slot.slot).toBe(250_000_000);
  });

  test('SubmitOptions defaults', () => {
    const opts: SubmitOptions = {};
    expect(opts.broadcastMode).toBeUndefined();
    expect(opts.preferredSender).toBeUndefined();
    expect(opts.maxRetries).toBeUndefined();
    expect(opts.timeoutMs).toBeUndefined();
    expect(opts.dedupId).toBeUndefined();
  });

  test('SubmitOptions with all fields', () => {
    const opts: SubmitOptions = {
      broadcastMode: true,
      preferredSender: '0slot',
      maxRetries: 5,
      timeoutMs: 60_000,
      dedupId: 'dedup-123',
      retry: {
        maxRetries: 3,
        backoffBaseMs: 200,
        crossSenderRetry: true,
      },
    };
    expect(opts.broadcastMode).toBe(true);
    expect(opts.retry!.crossSenderRetry).toBe(true);
  });

  test('BundleResult shape', () => {
    const result: BundleResult = {
      bundleId: 'bundle-1',
      accepted: true,
      signatures: ['sig1', 'sig2'],
      senderId: '0slot',
    };
    expect(result.accepted).toBe(true);
    expect(result.signatures).toHaveLength(2);
  });

  test('MultiRegionConfig shape', () => {
    const config: MultiRegionConfig = {
      autoFollowLeader: true,
      minSwitchConfidence: 70,
      switchCooldownMs: 5_000,
      broadcastHighPriority: false,
      maxBroadcastRegions: 3,
    };
    expect(config.autoFollowLeader).toBe(true);
    expect(config.maxBroadcastRegions).toBe(3);
  });

  test('LandingRateStats shape', () => {
    const stats: LandingRateStats = {
      period: { start: '2026-02-15T00:00:00Z', end: '2026-02-16T00:00:00Z' },
      totalSent: 1000,
      totalLanded: 920,
      landingRate: 0.92,
      bySender: [{ sender: '0slot', totalSent: 500, totalLanded: 475, landingRate: 0.95 }],
      byRegion: [{ region: 'us-west', totalSent: 600, totalLanded: 558, landingRate: 0.93 }],
    };
    expect(stats.landingRate).toBe(0.92);
    expect(stats.bySender).toHaveLength(1);
    expect(stats.byRegion[0].region).toBe('us-west');
  });

  test('RpcResponse success', () => {
    const resp: RpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { blockhash: 'abc123', lastValidBlockHeight: 100 },
    };
    expect(resp.result).toBeDefined();
    expect(resp.error).toBeUndefined();
  });

  test('RpcResponse error', () => {
    const resp: RpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request' },
    };
    expect(resp.error!.code).toBe(-32600);
  });
});

// ============================================================================
// BillingTier Tests
// ============================================================================

describe('BillingTier', () => {
  test('all tier values are valid strings', () => {
    const tiers: BillingTier[] = ['free', 'standard', 'pro', 'enterprise'];
    for (const tier of tiers) {
      const config = configBuilder().apiKey('sk_test_123').tier(tier).build();
      expect(config.tier).toBe(tier);
    }
  });
});
