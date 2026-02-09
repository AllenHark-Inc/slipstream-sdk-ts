/**
 * @allenhark/slipstream — WebSocket Streaming Transport
 *
 * Handles real-time streaming subscriptions with auto-reconnect.
 * Uses `ws` package for Node.js, native WebSocket for browsers.
 */

import { EventEmitter } from 'events';
import WebSocketModule from 'ws';
import { SlipstreamError } from '../errors';
import {
  BillingTier,
  ConnectionInfo,
  LatestBlockhash,
  LatestSlot,
  LeaderHint,
  PingResult,
  PriorityFee,
  SubmitOptions,
  TipInstruction,
  TransactionResult,
  WsClientMessage,
  WsServerMessage,
} from '../types';

const VERSION = '0.1.0';

interface PendingRequest {
  resolve: (value: TransactionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WebSocketTransport extends EventEmitter {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly region?: string;
  private readonly tier: BillingTier;
  private ws: WebSocketModule | null = null;
  private connected = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private subscribedStreams = new Set<string>();
  private shouldReconnect = true;
  private pingSeq = 0;
  private pendingPing: { resolve: (result: PingResult) => void; reject: (err: Error) => void; clientSendTime: number } | null = null;

  constructor(url: string, apiKey: string, region?: string, tier: BillingTier = 'pro') {
    super();
    this.url = url;
    this.apiKey = apiKey;
    this.region = region;
    this.tier = tier;
  }

  async connect(): Promise<ConnectionInfo> {
    return new Promise((resolve, reject) => {
      try {
        // Use ws package (Node.js)
        this.ws = new WebSocketModule(this.url);

        let connectionResolved = false;

        const onOpen = () => {
          this.sendMessage({
            type: 'connect',
            version: VERSION,
            apiKey: this.apiKey,
            features: ['leader_hints', 'tip_instructions', 'priority_fees'],
            region: this.region,
            tier: this.tier,
          });
        };

        const onMessage = (data: { data?: unknown; toString(): string }) => {
          const raw = typeof data === 'string'
            ? data
            : (data.data ? String(data.data) : data.toString());

          let msg: WsServerMessage;
          try {
            msg = JSON.parse(raw) as WsServerMessage;
          } catch {
            return;
          }

          if (!connectionResolved && msg.type === 'connected') {
            connectionResolved = true;
            this.connected = true;
            this.reconnectAttempts = 0;
            this.startHeartbeat();

            // Re-subscribe to streams on reconnect
            for (const stream of this.subscribedStreams) {
              this.sendMessage({ type: 'subscribe', stream });
            }

            const info: ConnectionInfo = {
              sessionId: (msg.session_id as string) ?? '',
              protocol: 'websocket',
              region: msg.region as string | undefined,
              serverTime: (msg.server_time as number) ?? Date.now(),
              features: (msg.features as string[]) ?? [],
              rateLimit: {
                rps: (msg.rate_limit as Record<string, number>)?.rps ?? 100,
                burst: (msg.rate_limit as Record<string, number>)?.burst ?? 200,
              },
            };
            this.emit('connected', info);
            resolve(info);
            return;
          }

          this.handleMessage(msg);
        };

        const onError = (err: Event | Error) => {
          const errMsg = err instanceof Error ? err.message : 'WebSocket error';
          if (!connectionResolved) {
            connectionResolved = true;
            reject(SlipstreamError.connection(errMsg));
          }
          this.emit('error', SlipstreamError.connection(errMsg));
        };

        const onClose = () => {
          this.connected = false;
          this.stopHeartbeat();
          this.emit('disconnected');

          if (!connectionResolved) {
            connectionResolved = true;
            reject(SlipstreamError.connection('WebSocket closed before connection'));
          }

          // Reject pending requests
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(SlipstreamError.connection('WebSocket closed'));
            this.pendingRequests.delete(id);
          }

          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.on('open', onOpen);
        this.ws.on('message', onMessage);
        this.ws.on('error', onError);
        this.ws.on('close', onClose);
      } catch (err) {
        reject(
          SlipstreamError.connection(
            `Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  subscribeLeaderHints(): void {
    this.subscribedStreams.add('leader_hints');
    if (this.connected) {
      this.sendMessage({ type: 'subscribe', stream: 'leader_hints' });
    }
  }

  subscribeTipInstructions(): void {
    this.subscribedStreams.add('tip_instructions');
    if (this.connected) {
      this.sendMessage({ type: 'subscribe', stream: 'tip_instructions' });
    }
  }

  subscribePriorityFees(): void {
    this.subscribedStreams.add('priority_fees');
    if (this.connected) {
      this.sendMessage({ type: 'subscribe', stream: 'priority_fees' });
    }
  }

  subscribeLatestBlockhash(): void {
    this.subscribedStreams.add('latest_blockhash');
    if (this.connected) {
      this.sendMessage({ type: 'subscribe', stream: 'latest_blockhash' });
    }
  }

  subscribeLatestSlot(): void {
    this.subscribedStreams.add('latest_slot');
    if (this.connected) {
      this.sendMessage({ type: 'subscribe', stream: 'latest_slot' });
    }
  }

  unsubscribe(stream: string): void {
    this.subscribedStreams.delete(stream);
    if (this.connected) {
      this.sendMessage({ type: 'unsubscribe', stream });
    }
  }

  // ===========================================================================
  // Keep-Alive / Time Sync
  // ===========================================================================

  /**
   * Send a ping and measure RTT + clock offset.
   */
  async ping(): Promise<PingResult> {
    if (!this.connected) {
      throw SlipstreamError.notConnected();
    }

    const seq = this.pingSeq++;
    const clientSendTime = Date.now();

    return new Promise<PingResult>((resolve, reject) => {
      this.pendingPing = { resolve, reject, clientSendTime };
      this.sendMessage({ type: 'ping', seq, client_time: clientSendTime } as unknown as WsClientMessage);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingPing) {
          this.pendingPing.reject(SlipstreamError.timeout(5000));
          this.pendingPing = null;
        }
      }, 5000);
    });
  }

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  async submitTransaction(
    transaction: Uint8Array,
    options: SubmitOptions = {},
  ): Promise<TransactionResult> {
    if (!this.connected) {
      throw SlipstreamError.notConnected();
    }

    const requestId = `req_${++this.requestIdCounter}_${Date.now()}`;
    const base64Tx = Buffer.from(transaction).toString('base64');

    return new Promise<TransactionResult>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 30_000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(SlipstreamError.timeout(timeoutMs));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      this.sendMessage({
        type: 'submit_transaction',
        requestId,
        transaction: base64Tx,
        dedupId: options.dedupId,
        options: {
          broadcastMode: options.broadcastMode,
          preferredSender: options.preferredSender,
          maxRetries: options.maxRetries,
          timeoutMs: options.timeoutMs,
        },
      });
    });
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private handleMessage(msg: WsServerMessage): void {
    switch (msg.type) {
      case 'leader_hint':
        this.emit('leaderHint', this.parseLeaderHint(msg));
        break;

      case 'tip_instruction':
        this.emit('tipInstruction', this.parseTipInstruction(msg));
        break;

      case 'priority_fee':
        this.emit('priorityFee', this.parsePriorityFee(msg));
        break;

      case 'latest_blockhash':
        this.emit('latestBlockhash', this.parseLatestBlockhash(msg));
        break;

      case 'latest_slot':
        this.emit('latestSlot', this.parseLatestSlot(msg));
        break;

      case 'transaction_accepted':
      case 'transaction_update':
      case 'transaction_confirmed':
      case 'transaction_failed': {
        const requestId = msg.request_id as string;
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(requestId);

          if (msg.type === 'transaction_failed') {
            pending.reject(
              SlipstreamError.transaction(
                (msg.error as Record<string, string>)?.message ?? 'Transaction failed',
              ),
            );
          } else {
            pending.resolve(this.parseTransactionResult(msg));
          }
        }
        this.emit('transactionUpdate', this.parseTransactionResult(msg));
        break;
      }

      case 'pong': {
        if (this.pendingPing) {
          const now = Date.now();
          const serverTime = (msg.server_time as number) ?? now;
          const rttMs = now - this.pendingPing.clientSendTime;
          const clockOffsetMs = serverTime - (this.pendingPing.clientSendTime + Math.floor(rttMs / 2));
          this.pendingPing.resolve({
            seq: (msg.seq as number) ?? 0,
            rttMs,
            clockOffsetMs,
            serverTime,
          });
          this.pendingPing = null;
        }
        break;
      }

      case 'heartbeat':
        this.sendMessage({ type: 'pong', timestamp: Date.now() });
        break;

      case 'error':
        this.emit('error', SlipstreamError.protocol(msg.message as string));
        break;

      default:
        break;
    }
  }

  private parseLeaderHint(msg: WsServerMessage): LeaderHint {
    const metadata = msg.metadata as Record<string, unknown> | undefined;
    return {
      timestamp: msg.timestamp as number,
      slot: msg.slot as number,
      expiresAtSlot: msg.expires_at_slot as number,
      preferredRegion: msg.preferred_region as string,
      backupRegions: (msg.backup_regions as string[]) ?? [],
      confidence: msg.confidence as number,
      leaderPubkey: (msg.leader_pubkey as string) ?? 'unknown',
      metadata: {
        tpuRttMs: (metadata?.tpu_rtt_ms as number) ?? 0,
        regionScore: (metadata?.region_score as number) ?? 0,
        leaderTpuAddress: metadata?.leader_tpu_address as string | undefined,
        regionRttMs: metadata?.region_rtt_ms as Record<string, number> | undefined,
      },
    };
  }

  private parseTipInstruction(msg: WsServerMessage): TipInstruction {
    const alts = (msg.alternative_senders as Array<Record<string, unknown>>) ?? [];
    return {
      timestamp: msg.timestamp as number,
      sender: msg.sender as string,
      senderName: msg.sender_name as string,
      tipWalletAddress: msg.tip_wallet_address as string,
      tipAmountSol: msg.tip_amount_sol as number,
      tipTier: msg.tip_tier as string,
      expectedLatencyMs: msg.expected_latency_ms as number,
      confidence: msg.confidence as number,
      validUntilSlot: msg.valid_until_slot as number,
      alternativeSenders: alts.map((a) => ({
        sender: a.sender as string,
        tipAmountSol: a.tip_amount_sol as number,
        confidence: a.confidence as number,
      })),
    };
  }

  private parsePriorityFee(msg: WsServerMessage): PriorityFee {
    return {
      timestamp: msg.timestamp as number,
      speed: msg.speed as string,
      computeUnitPrice: msg.compute_unit_price as number,
      computeUnitLimit: msg.compute_unit_limit as number,
      estimatedCostSol: msg.estimated_cost_sol as number,
      landingProbability: msg.landing_probability as number,
      networkCongestion: msg.network_congestion as string,
      recentSuccessRate: msg.recent_success_rate as number,
    };
  }

  private parseLatestBlockhash(msg: WsServerMessage): LatestBlockhash {
    return {
      blockhash: msg.blockhash as string,
      lastValidBlockHeight: msg.last_valid_block_height as number,
      timestamp: (msg.timestamp as number) ?? Date.now(),
    };
  }

  private parseLatestSlot(msg: WsServerMessage): LatestSlot {
    return {
      slot: msg.slot as number,
      timestamp: (msg.timestamp as number) ?? Date.now(),
    };
  }

  private parseTransactionResult(msg: WsServerMessage): TransactionResult {
    const routing = msg.routing as Record<string, unknown> | undefined;
    const error = msg.error as Record<string, unknown> | undefined;
    return {
      requestId: (msg.request_id as string) ?? '',
      transactionId: (msg.transaction_id as string) ?? '',
      signature: msg.signature as string | undefined,
      status: (msg.status as TransactionResult['status']) ?? 'pending',
      slot: msg.slot as number | undefined,
      timestamp: (msg.timestamp as number) ?? Date.now(),
      routing: routing
        ? {
            region: routing.region as string,
            sender: routing.sender as string,
            routingLatencyMs: routing.routing_latency_ms as number,
            senderLatencyMs: routing.sender_latency_ms as number,
            totalLatencyMs: routing.total_latency_ms as number,
          }
        : undefined,
      error: error
        ? {
            code: error.code as string,
            message: error.message as string,
            details: error.details,
          }
        : undefined,
    };
  }

  private sendMessage(msg: WsClientMessage): void {
    if (!this.ws) return;

    const data = JSON.stringify(msg);
    if ('send' in this.ws) {
      this.ws.send(data);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.ping().catch(() => {});
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnecting = true;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.connect();
      } catch {
        // Will trigger another reconnect via onClose
      }
    }, delay);
  }
}
