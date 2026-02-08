/**
 * @allenhark/slipstream — HTTP REST Transport
 *
 * Uses native fetch (Node 18+) for all REST API calls.
 */

import { SlipstreamError } from '../errors';
import {
  Balance,
  DepositEntry,
  FreeTierUsage,
  PaginationOptions,
  PendingDeposit,
  RegionInfo,
  RoutingRecommendation,
  SenderInfo,
  SubmitOptions,
  TopUpInfo,
  TransactionResult,
  UsageEntry,
  FallbackStrategy,
} from '../types';

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(baseUrl: string, apiKey: string, timeout = 10_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, value);
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw SlipstreamError.auth('Invalid API key');
      }

      if (response.status === 429) {
        throw SlipstreamError.rateLimited();
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw SlipstreamError.internal(
          `HTTP ${response.status}: ${errorText || response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof SlipstreamError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw SlipstreamError.timeout(this.timeout);
      }
      throw SlipstreamError.connection(
        `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ===========================================================================
  // Transaction
  // ===========================================================================

  async submitTransaction(
    transaction: Uint8Array,
    options: SubmitOptions = {},
  ): Promise<TransactionResult> {
    const base64Tx = Buffer.from(transaction).toString('base64');

    return this.request<TransactionResult>('POST', '/v1/transactions/submit', {
      transaction: base64Tx,
      dedup_id: options.dedupId,
      options: {
        broadcast_mode: options.broadcastMode ?? false,
        preferred_sender: options.preferredSender,
        max_retries: options.maxRetries ?? 2,
        timeout_ms: options.timeoutMs ?? 30_000,
      },
    });
  }

  async getTransactionStatus(transactionId: string): Promise<TransactionResult> {
    return this.request<TransactionResult>(
      'GET',
      `/v1/transactions/${encodeURIComponent(transactionId)}/status`,
    );
  }

  // ===========================================================================
  // Token Billing
  // ===========================================================================

  async getBalance(): Promise<Balance> {
    const body = await this.request<Record<string, unknown>>('GET', '/v1/balance');

    const balanceLamports = (body.balance_lamports as number) ?? 0;
    const costPerQuery = 50_000;
    const graceLimit = 1_000_000;

    return {
      balanceSol: balanceLamports / 1_000_000_000,
      balanceTokens: Math.floor(balanceLamports / costPerQuery),
      balanceLamports,
      graceRemainingTokens: Math.floor((balanceLamports + graceLimit) / costPerQuery),
    };
  }

  async getDepositAddress(): Promise<TopUpInfo> {
    const body = await this.request<Record<string, unknown>>('GET', '/v1/deposit-address');
    return {
      depositWallet: body.deposit_wallet as string,
      minAmountSol: body.min_amount_sol as number,
      minAmountLamports: body.min_amount_lamports as number,
    };
  }

  async getUsageHistory(opts: PaginationOptions = {}): Promise<UsageEntry[]> {
    const params: Record<string, string> = {};
    if (opts.limit !== undefined) params.limit = String(opts.limit);
    if (opts.offset !== undefined) params.offset = String(opts.offset);

    const body = await this.request<Record<string, unknown>>(
      'GET',
      '/v1/usage-history',
      undefined,
      params,
    );

    const entries = body.entries as Array<Record<string, unknown>> | undefined;
    if (!entries) return [];

    return entries.map((e) => ({
      timestamp: e.created_at
        ? new Date(e.created_at as string).getTime()
        : Date.now(),
      txType: e.tx_type as string,
      amountLamports: e.amount_lamports as number,
      balanceAfterLamports: e.balance_after_lamports as number,
      description: e.description as string | undefined,
    }));
  }

  async getDepositHistory(opts: PaginationOptions = {}): Promise<DepositEntry[]> {
    const params: Record<string, string> = {};
    if (opts.limit !== undefined) params.limit = String(opts.limit);
    if (opts.offset !== undefined) params.offset = String(opts.offset);

    const body = await this.request<Record<string, unknown>>(
      'GET',
      '/v1/deposit-history',
      undefined,
      params,
    );

    const deposits = body.deposits as Array<Record<string, unknown>> | undefined;
    if (!deposits) return [];

    return deposits.map((d) => ({
      signature: d.signature as string,
      amountLamports: d.amount_lamports as number,
      amountSol: (d.amount_lamports as number) / 1_000_000_000,
      usdValue: d.usd_value as number | undefined,
      solUsdPrice: d.sol_usd_price as number | undefined,
      credited: d.credited as boolean,
      creditedAt: d.credited_at as string | undefined,
      slot: d.slot as number,
      detectedAt: d.detected_at as string,
      blockTime: d.block_time as string | undefined,
    }));
  }

  async getPendingDeposit(): Promise<PendingDeposit> {
    const body = await this.request<Record<string, unknown>>('GET', '/v1/deposit-pending');
    return {
      pendingLamports: body.pending_lamports as number,
      pendingSol: body.pending_sol as number,
      pendingCount: body.pending_count as number,
      minimumDepositUsd: body.minimum_deposit_usd as number,
    };
  }

  async getFreeTierUsage(): Promise<FreeTierUsage> {
    const body = await this.request<Record<string, unknown>>('GET', '/v1/free-tier-usage');
    return {
      used: (body.used as number) ?? 0,
      remaining: (body.remaining as number) ?? 0,
      limit: (body.limit as number) ?? 100,
      resetsAt: (body.resets_at as string) ?? '',
    };
  }

  // ===========================================================================
  // Routing
  // ===========================================================================

  async getRoutingRecommendation(): Promise<RoutingRecommendation> {
    try {
      const body = await this.request<Record<string, unknown>>(
        'GET',
        '/v1/routing/recommendation',
      );
      return {
        bestRegion: body.best_region as string,
        leaderPubkey: body.leader_pubkey as string | undefined,
        slot: body.slot as number,
        confidence: body.confidence as number,
        expectedRttMs: body.expected_rtt_ms as number | undefined,
        fallbackRegions: (body.fallback_regions as string[]) ?? [],
        fallbackStrategy: (body.fallback_strategy as FallbackStrategy) ?? FallbackStrategy.Retry,
        validForMs: (body.valid_for_ms as number) ?? 1000,
      };
    } catch (err) {
      // Fallback for when endpoint isn't available
      if (
        err instanceof SlipstreamError &&
        err.message.includes('404')
      ) {
        return {
          bestRegion: 'unknown',
          slot: 0,
          confidence: 50,
          fallbackRegions: [],
          fallbackStrategy: FallbackStrategy.Retry,
          validForMs: 1000,
        };
      }
      throw err;
    }
  }

  // ===========================================================================
  // Config
  // ===========================================================================

  async getRegions(): Promise<RegionInfo[]> {
    const body = await this.request<Record<string, unknown>>('GET', '/v1/config/regions');
    const regions = body.regions as Array<Record<string, unknown>> | undefined;
    if (!regions) return [];

    return regions.map((r) => ({
      regionId: r.region_id as string,
      displayName: r.display_name as string,
      endpoint: r.endpoint as string,
      geolocation: r.geolocation as { lat: number; lon: number } | undefined,
    }));
  }

  async getSenders(): Promise<SenderInfo[]> {
    const body = await this.request<Record<string, unknown>>('GET', '/v1/config/senders');
    const senders = body.senders as Array<Record<string, unknown>> | undefined;
    if (!senders) return [];

    return senders.map((s) => ({
      senderId: s.sender_id as string,
      displayName: s.display_name as string,
      tipWallets: (s.tip_wallets as string[]) ?? [],
      tipTiers: ((s.tip_tiers as Array<Record<string, unknown>>) ?? []).map((t) => ({
        name: t.name as string,
        amountSol: t.amount_sol as number,
        expectedLatencyMs: t.expected_latency_ms as number,
      })),
    }));
  }
}
