/**
 * @allenhark/slipstream — QUIC Transport
 *
 * High-performance binary transport over QUIC for server-side Node.js.
 * Follows the same EventEmitter pattern as WebSocketTransport.
 *
 * Requires the `@aspect-build/quic` optional dependency.
 * If not installed, the transport will throw on connect().
 *
 * Protocol matches the Rust SDK and worker QUIC server exactly:
 * - Authentication via first bi-directional stream
 * - Transaction submission via bi-directional streams
 * - Streaming subscriptions via uni-directional streams
 */

import { EventEmitter } from 'events';
import { SlipstreamError } from '../errors';
import {
  BillingTier,
  ConnectionInfo,
  LeaderHint,
  PriorityFee,
  QuicConfig,
  SubmitOptions,
  TipInstruction,
  TransactionResult,
} from '../types';
import {
  buildAuthFrame,
  buildSubscriptionFrame,
  buildTransactionFrame,
  parseAuthResponse,
  parseLeaderHint,
  parsePriorityFee,
  parseTipInstruction,
  parseTransactionResponse,
  STREAM_TYPE,
  StreamType,
} from './binary';

// Lazy-load the QUIC library to avoid hard dependency
let quicLib: QuicLibrary | null = null;

interface QuicLibrary {
  Endpoint: new (options: Record<string, unknown>) => QuicEndpoint;
}

interface QuicEndpoint {
  connect(host: string, port: number, options?: Record<string, unknown>): Promise<QuicConnection>;
  close(): void;
}

interface QuicConnection {
  openBidirectionalStream(): Promise<QuicBidiStream>;
  openUnidirectionalStream(): Promise<QuicSendStream>;
  acceptUnidirectionalStream(): Promise<QuicRecvStream | null>;
  close(code?: number, reason?: string): void;
  closed: Promise<void>;
}

interface QuicBidiStream {
  writable: QuicSendStream;
  readable: QuicRecvStream;
}

interface QuicSendStream {
  write(data: Buffer | Uint8Array): Promise<void>;
  finish(): Promise<void>;
}

interface QuicRecvStream {
  read(): Promise<Buffer | null>;
  readAll(): Promise<Buffer>;
}

function loadQuicLib(): QuicLibrary {
  if (quicLib) return quicLib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    quicLib = require('@aspect-build/quic') as QuicLibrary;
    return quicLib;
  } catch {
    throw SlipstreamError.config(
      'QUIC transport requires the @aspect-build/quic package. ' +
      'Install it with: npm install @aspect-build/quic',
    );
  }
}

export class QuicTransport extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly apiKey: string;
  private readonly region?: string;
  private readonly tier: BillingTier;
  private readonly quicConfig: QuicConfig;

  private endpoint: QuicEndpoint | null = null;
  private connection: QuicConnection | null = null;
  private _connected = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptionLoopRunning = false;
  private activeSubscriptions = new Set<StreamType>();
  private requestCounter = 0;

  constructor(host: string, port: number, apiKey: string, region?: string, tier: BillingTier = 'pro', config?: Partial<QuicConfig>) {
    super();
    this.host = host;
    this.port = port;
    this.apiKey = apiKey;
    this.region = region;
    this.tier = tier;
    this.quicConfig = {
      timeout: config?.timeout ?? 2_000,
      keepAliveIntervalMs: config?.keepAliveIntervalMs ?? 5_000,
      maxIdleTimeoutMs: config?.maxIdleTimeoutMs ?? 30_000,
      insecure: config?.insecure ?? false,
    };
  }

  /**
   * Connect to the worker's QUIC endpoint and authenticate.
   */
  async connect(): Promise<ConnectionInfo> {
    const lib = loadQuicLib();

    // Create endpoint
    this.endpoint = new lib.Endpoint({
      keepAliveIntervalMs: this.quicConfig.keepAliveIntervalMs,
      maxIdleTimeoutMs: this.quicConfig.maxIdleTimeoutMs,
    });

    // Connect with timeout
    const connectPromise = this.endpoint.connect(this.host, this.port, {
      insecure: this.quicConfig.insecure,
      serverName: this.host,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(SlipstreamError.timeout(this.quicConfig.timeout)), this.quicConfig.timeout),
    );

    this.connection = await Promise.race([connectPromise, timeoutPromise]);

    // Authenticate via first bi-directional stream (sends tier for billing)
    const authStream = await this.connection.openBidirectionalStream();
    const authFrame = buildAuthFrame(this.apiKey, this.tier);

    await authStream.writable.write(authFrame);
    await authStream.writable.finish();

    const responseData = await authStream.readable.readAll();
    const authResponse = parseAuthResponse(responseData);

    if (!authResponse.success) {
      this.connection.close(1, 'Authentication failed');
      throw SlipstreamError.auth(`QUIC authentication failed: ${authResponse.message}`);
    }

    this._connected = true;
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;

    // Start background subscription listener
    this.startSubscriptionListener();

    // Monitor connection close for reconnection
    this.monitorConnection();

    const connInfo: ConnectionInfo = {
      sessionId: authResponse.message || '',
      protocol: 'quic',
      region: this.region,
      serverTime: Date.now(),
      features: ['quic', 'binary_protocol', 'leader_hints', 'tip_instructions', 'priority_fees'],
      rateLimit: { rps: 100, burst: 200 },
    };

    this.emit('connected', connInfo);
    return connInfo;
  }

  /**
   * Disconnect from the QUIC endpoint.
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.subscriptionLoopRunning = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      this.connection.close(0, 'client_disconnect');
      this.connection = null;
    }

    if (this.endpoint) {
      this.endpoint.close();
      this.endpoint = null;
    }

    this._connected = false;
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to leader hint updates via uni-directional stream.
   */
  subscribeLeaderHints(): void {
    this.subscribe(STREAM_TYPE.LeaderHints);
  }

  /**
   * Subscribe to tip instruction updates via uni-directional stream.
   */
  subscribeTipInstructions(): void {
    this.subscribe(STREAM_TYPE.TipInstructions);
  }

  /**
   * Subscribe to priority fee updates via uni-directional stream.
   */
  subscribePriorityFees(): void {
    this.subscribe(STREAM_TYPE.PriorityFees);
  }

  private subscribe(streamType: StreamType): void {
    this.activeSubscriptions.add(streamType);

    if (!this._connected || !this.connection) return;

    // Open uni-directional stream and send subscription request
    this.connection
      .openUnidirectionalStream()
      .then(async (stream) => {
        const frame = buildSubscriptionFrame(streamType);
        await stream.write(frame);
        await stream.finish();
      })
      .catch((err) => {
        this.emit('error', SlipstreamError.connection(`Failed to subscribe: ${err}`));
      });
  }

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  /**
   * Submit a signed transaction over a bi-directional QUIC stream.
   */
  async submitTransaction(
    transaction: Uint8Array,
    options: SubmitOptions = {},
  ): Promise<TransactionResult> {
    if (!this._connected || !this.connection) {
      throw SlipstreamError.notConnected();
    }

    const stream = await this.connection.openBidirectionalStream();
    const frame = buildTransactionFrame(transaction);

    await stream.writable.write(frame);
    await stream.writable.finish();

    // Read response with timeout
    const timeoutMs = options.timeoutMs ?? 30_000;
    const readPromise = stream.readable.readAll();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(SlipstreamError.timeout(timeoutMs)), timeoutMs),
    );

    const responseData = await Promise.race([readPromise, timeoutPromise]);
    return parseTransactionResponse(responseData);
  }

  // ===========================================================================
  // Background Subscription Listener
  // ===========================================================================

  private startSubscriptionListener(): void {
    if (this.subscriptionLoopRunning) return;
    this.subscriptionLoopRunning = true;

    const listen = async () => {
      while (this.subscriptionLoopRunning && this.connection) {
        try {
          const stream = await this.connection.acceptUnidirectionalStream();
          if (!stream) {
            // Connection closed
            break;
          }

          // Process each incoming uni-stream in the background
          this.processIncomingStream(stream).catch((err) => {
            this.emit('error', SlipstreamError.connection(`Stream processing error: ${err}`));
          });
        } catch {
          // Connection closed or error
          break;
        }
      }
      this.subscriptionLoopRunning = false;
    };

    listen().catch(() => {
      this.subscriptionLoopRunning = false;
    });
  }

  private async processIncomingStream(stream: QuicRecvStream): Promise<void> {
    const data = await stream.readAll();
    if (data.length < 1) return;

    const streamType = data[0];

    switch (streamType) {
      case STREAM_TYPE.LeaderHints: {
        const hint = parseLeaderHint(data);
        if (hint) this.emit('leaderHint', hint);
        break;
      }
      case STREAM_TYPE.TipInstructions: {
        const tip = parseTipInstruction(data);
        if (tip) this.emit('tipInstruction', tip);
        break;
      }
      case STREAM_TYPE.PriorityFees: {
        const fee = parsePriorityFee(data);
        if (fee) this.emit('priorityFee', fee);
        break;
      }
      default:
        // Unknown stream type — ignore
        break;
    }
  }

  // ===========================================================================
  // Reconnection
  // ===========================================================================

  private monitorConnection(): void {
    if (!this.connection) return;

    this.connection.closed
      .then(() => {
        this._connected = false;
        this.subscriptionLoopRunning = false;
        this.emit('disconnected');

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      })
      .catch(() => {
        this._connected = false;
        this.subscriptionLoopRunning = false;
        this.emit('disconnected');

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', SlipstreamError.connection('QUIC max reconnect attempts reached'));
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();

        // Re-subscribe to active streams
        for (const streamType of this.activeSubscriptions) {
          this.subscribe(streamType);
        }
      } catch {
        // Will trigger another reconnect via monitorConnection
      }
    }, delay);
  }
}

/**
 * Parse a QUIC endpoint URL into host and port.
 *
 * Supports: `quic://host:port`, `host:port`, or just `host` (default port 4433).
 */
export function parseQuicEndpoint(url: string): { host: string; port: number } {
  const cleaned = url.replace(/^quic:\/\//, '');
  const parts = cleaned.split(':');
  const host = parts[0];
  const port = parts.length > 1 ? parseInt(parts[1], 10) : 4433;
  return { host, port };
}
