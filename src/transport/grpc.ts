/**
 * @allenhark/slipstream — gRPC Transport (Optional)
 *
 * Requires `@grpc/grpc-js` and `@grpc/proto-loader` as peer dependencies.
 * Install: npm install @grpc/grpc-js @grpc/proto-loader
 *
 * This transport connects to the worker's gRPC server (port 10000) and provides
 * streaming subscriptions and transaction submission via protobuf.
 *
 * Usage:
 *   import { GrpcTransport } from '@allenhark/slipstream/transport/grpc';
 *   const transport = new GrpcTransport('localhost:10000', 'sk_test_12345678');
 *   await transport.connect();
 */

export interface GrpcTransportOptions {
  /** gRPC server address (host:port) */
  address: string;
  /** API key for authentication */
  apiKey: string;
  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;
  /** Whether to use TLS (default: false for local, true for production) */
  useTls?: boolean;
}

/**
 * GrpcTransport provides an alternative transport layer using gRPC.
 *
 * This is an optional transport — the default SDK uses QUIC (server) or
 * WebSocket (browser). Use gRPC when you need protobuf-native streaming
 * in environments where QUIC is not available.
 *
 * Requires peer dependencies:
 * - @grpc/grpc-js
 * - @grpc/proto-loader
 */
export class GrpcTransport {
  private readonly address: string;
  private readonly apiKey: string;
  private readonly connectTimeout: number;
  private readonly useTls: boolean;
  private client: unknown | null = null;
  private connected = false;

  constructor(options: GrpcTransportOptions) {
    this.address = options.address;
    this.apiKey = options.apiKey;
    this.connectTimeout = options.connectTimeout ?? 5000;
    this.useTls = options.useTls ?? false;
  }

  /**
   * Connect to the gRPC server.
   * Dynamically imports @grpc/grpc-js and @grpc/proto-loader.
   */
  async connect(): Promise<{ sessionId: string; region: string }> {
    // Dynamic import to avoid requiring grpc as a hard dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let grpc: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let protoLoader: any;

    try {
      // Use require() to avoid TypeScript resolving these optional peer deps
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grpc = require('@grpc/grpc-js');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      protoLoader = require('@grpc/proto-loader');
    } catch {
      throw new Error(
        'gRPC transport requires @grpc/grpc-js and @grpc/proto-loader. ' +
        'Install them: npm install @grpc/grpc-js @grpc/proto-loader'
      );
    }

    // Load proto definition — resolve relative to this module
    const path = await import(/* webpackIgnore: true */ 'path');
    const protoPath = path.resolve(__dirname, '../../proto/slipstream.proto');
    const packageDefinition = await protoLoader.load(protoPath, {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const SlipstreamService = protoDescriptor.slipstream.SlipstreamService;

    // Create client with credentials
    const credentials = this.useTls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.client = new SlipstreamService(this.address, credentials);

    // Verify connection
    const status = await new Promise<any>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.connectTimeout);
      (this.client as any).getConnectionStatus(
        { apiKey: this.apiKey },
        { deadline },
        (err: Error | null, response: any) => {
          if (err) reject(err);
          else resolve(response);
        }
      );
    });

    this.connected = true;

    return {
      sessionId: status.sessionId || '',
      region: status.region || '',
    };
  }

  /** Disconnect from gRPC server */
  disconnect(): void {
    if (this.client) {
      (this.client as any).close();
      this.client = null;
    }
    this.connected = false;
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Submit a transaction via gRPC bidirectional streaming.
   * Returns the first response (transaction status).
   */
  async submitTransaction(
    transaction: Uint8Array,
    options?: { requestId?: string; dedupId?: string; broadcastMode?: boolean }
  ): Promise<{
    requestId: string;
    transactionId: string;
    status: string;
    signature?: string;
    error?: { code: string; message: string };
  }> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const call = (this.client as any).submitTransaction(
        { deadline: new Date(Date.now() + 30_000) }
      );

      call.on('data', (response: any) => {
        resolve({
          requestId: response.requestId || '',
          transactionId: response.transactionId || '',
          status: response.status || 'UNKNOWN',
          signature: response.confirmation?.signature,
          error: response.error ? {
            code: response.error.code || '',
            message: response.error.message || '',
          } : undefined,
        });
        call.end();
      });

      call.on('error', (err: Error) => reject(err));

      // Send the transaction request
      call.write({
        requestId: options?.requestId || crypto.randomUUID(),
        transaction: Buffer.from(transaction),
        dedupId: options?.dedupId || '',
        options: {
          broadcastMode: options?.broadcastMode || false,
          preferredSender: '',
          maxRetries: 2,
          timeoutMs: 30_000,
        },
      });
    });
  }

  /**
   * Subscribe to leader hints via server streaming.
   * Returns an async iterator.
   */
  subscribeLeaderHints(
    callback: (hint: {
      timestamp: number;
      slot: number;
      preferredRegion: string;
      confidence: number;
      leaderPubkey: string;
    }) => void
  ): { cancel: () => void } {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    const call = (this.client as any).subscribeLeaderHints({
      apiKey: this.apiKey,
      region: '',
    });

    call.on('data', (hint: any) => {
      callback({
        timestamp: hint.timestamp || 0,
        slot: hint.slot || 0,
        preferredRegion: hint.preferredRegion || '',
        confidence: hint.confidence || 0,
        leaderPubkey: hint.leaderPubkey || '',
      });
    });

    return {
      cancel: () => call.cancel(),
    };
  }

  /**
   * Subscribe to latest blockhash via server streaming.
   */
  subscribeLatestBlockhash(
    callback: (bh: { blockhash: string; lastValidBlockHeight: number; timestamp: number }) => void
  ): { cancel: () => void } {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    const call = (this.client as any).subscribeLatestBlockhash({
      apiKey: this.apiKey,
      region: '',
    });

    call.on('data', (bh: any) => {
      callback({
        blockhash: bh.blockhash || '',
        lastValidBlockHeight: bh.lastValidBlockHeight || 0,
        timestamp: bh.timestamp || 0,
      });
    });

    return {
      cancel: () => call.cancel(),
    };
  }

  /**
   * Subscribe to latest slot via server streaming.
   */
  subscribeLatestSlot(
    callback: (slot: { slot: number; timestamp: number }) => void
  ): { cancel: () => void } {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    const call = (this.client as any).subscribeLatestSlot({
      apiKey: this.apiKey,
      region: '',
    });

    call.on('data', (slot: any) => {
      callback({
        slot: slot.slot || 0,
        timestamp: slot.timestamp || 0,
      });
    });

    return {
      cancel: () => call.cancel(),
    };
  }

  /**
   * Get token balance via unary RPC.
   */
  async getBalance(): Promise<{
    balanceSol: number;
    balanceTokens: number;
    balanceLamports: number;
    graceRemainingTokens: number;
  }> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      (this.client as any).getBalance(
        { apiKey: this.apiKey },
        (err: Error | null, response: any) => {
          if (err) reject(err);
          else resolve({
            balanceSol: response.balanceSol || 0,
            balanceTokens: response.balanceTokens || 0,
            balanceLamports: response.balanceLamports || 0,
            graceRemainingTokens: response.graceRemainingTokens || 0,
          });
        }
      );
    });
  }

  /**
   * Get routing recommendation via unary RPC.
   */
  async getRoutingRecommendation(): Promise<{
    bestRegion: string;
    leaderPubkey: string;
    slot: number;
    confidence: number;
    expectedRttMs: number;
    fallbackRegions: string[];
  }> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      (this.client as any).getRoutingRecommendation(
        { apiKey: this.apiKey },
        (err: Error | null, response: any) => {
          if (err) reject(err);
          else resolve({
            bestRegion: response.bestRegion || '',
            leaderPubkey: response.leaderPubkey || '',
            slot: response.slot || 0,
            confidence: response.confidence || 0,
            expectedRttMs: response.expectedRttMs || 0,
            fallbackRegions: response.fallbackRegions || [],
          });
        }
      );
    });
  }
}
