/**
 * @allenhark/slipstream — Binary Protocol Codec
 *
 * Encodes/decodes the binary wire format used by the QUIC transport.
 * Must match the Rust SDK (client-sdk/rust/src/connection/quic.rs) and
 * worker QUIC server (slipstream-worker/src/quic/streams.rs) exactly.
 */

import {
  LatestBlockhash,
  LatestSlot,
  LeaderHint,
  PriorityFee,
  TipInstruction,
  TransactionResult,
  TransactionStatus,
} from '../types';

// ============================================================================
// Stream Type Constants
// ============================================================================

export const STREAM_TYPE = {
  TransactionSubmit: 0x01,
  LeaderHints: 0x02,
  TipInstructions: 0x03,
  PriorityFees: 0x04,
  Metrics: 0x05,
  LatestBlockhash: 0x06,
  LatestSlot: 0x07,
  Ping: 0x08,
} as const;

export type StreamType = (typeof STREAM_TYPE)[keyof typeof STREAM_TYPE];

// ============================================================================
// Response Status Codes
// ============================================================================

export const RESPONSE_STATUS = {
  Accepted: 0x01,
  Duplicate: 0x02,
  RateLimited: 0x03,
  ServerError: 0x04,
} as const;

const STATUS_MAP: Record<number, TransactionStatus> = {
  [RESPONSE_STATUS.Accepted]: TransactionStatus.Sent,
  [RESPONSE_STATUS.Duplicate]: TransactionStatus.Duplicate,
  [RESPONSE_STATUS.RateLimited]: TransactionStatus.RateLimited,
  [RESPONSE_STATUS.ServerError]: TransactionStatus.Failed,
};

// ============================================================================
// SDK Version
// ============================================================================

const SDK_VERSION = 'ts-sdk-v0.1';

// ============================================================================
// Encoding
// ============================================================================

/**
 * Build authentication frame for the first bi-directional QUIC stream.
 *
 * Wire format: [8-byte API key prefix][version string\0][tier string\0]
 * The tier is optional — if omitted, worker uses the key's stored tier.
 */
export function buildAuthFrame(apiKey: string, tier?: string): Buffer {
  const prefix = Buffer.alloc(8);
  const keyBytes = Buffer.from(apiKey, 'utf-8');
  keyBytes.copy(prefix, 0, 0, Math.min(keyBytes.length, 8));

  const version = Buffer.from(SDK_VERSION, 'utf-8');
  const nullByte = Buffer.from([0]);

  if (tier) {
    const tierBuf = Buffer.from(tier, 'utf-8');
    return Buffer.concat([prefix, version, nullByte, tierBuf, nullByte]);
  }

  return Buffer.concat([prefix, version]);
}

/**
 * Build transaction submission frame.
 *
 * Wire format: [0x01 stream type][transaction bytes]
 */
export function buildTransactionFrame(transaction: Uint8Array): Buffer {
  const frame = Buffer.alloc(1 + transaction.length);
  frame[0] = STREAM_TYPE.TransactionSubmit;
  Buffer.from(transaction).copy(frame, 1);
  return frame;
}

/**
 * Build subscription request frame (sent on a uni-directional stream).
 *
 * Wire format: [1-byte stream type]
 */
export function buildSubscriptionFrame(streamType: StreamType): Buffer {
  return Buffer.from([streamType]);
}

// ============================================================================
// Decoding — Auth Response
// ============================================================================

export interface AuthResponse {
  success: boolean;
  message: string;
}

/**
 * Parse authentication response.
 *
 * Wire format: [1-byte status (0x01 = success)][message string]
 */
export function parseAuthResponse(buf: Buffer): AuthResponse {
  if (buf.length < 1) {
    return { success: false, message: 'Empty auth response' };
  }
  const status = buf[0];
  const message = buf.subarray(1).toString('utf-8');
  return { success: status === 0x01, message };
}

// ============================================================================
// Decoding — Transaction Response
// ============================================================================

/**
 * Parse transaction submission response.
 *
 * Wire format:
 *   [4 bytes request_id (u32 BE)]
 *   [1 byte status]
 *   [1 byte has_signature flag]
 *   [64 bytes signature (if has_signature)]
 *   [2 bytes error_len (u16 BE)]
 *   [N bytes error message]
 */
export function parseTransactionResponse(buf: Buffer): TransactionResult {
  let offset = 0;

  const requestId = buf.readUInt32BE(offset);
  offset += 4;

  const statusByte = buf[offset];
  offset += 1;

  const hasSig = buf[offset];
  offset += 1;

  let signature: string | undefined;
  if (hasSig) {
    const sigBytes = buf.subarray(offset, offset + 64);
    signature = encodeBase58(sigBytes);
    offset += 64;
  }

  const errLen = buf.readUInt16BE(offset);
  offset += 2;

  let error: { code: string; message: string } | undefined;
  if (errLen > 0) {
    const errMsg = buf.subarray(offset, offset + errLen).toString('utf-8');
    error = { code: 'SENDER_ERROR', message: errMsg };
  }

  const status = STATUS_MAP[statusByte] ?? TransactionStatus.Failed;

  return {
    requestId: `req_${requestId}`,
    transactionId: signature ?? `tx_${requestId}`,
    signature,
    status,
    timestamp: Date.now(),
    error,
  };
}

// ============================================================================
// Decoding — Stream Messages
// ============================================================================

/**
 * Parse a LeaderHint from binary wire format.
 *
 * Wire format:
 *   [1 byte stream type (0x02)]
 *   [1 byte region_len]
 *   [N bytes region]
 *   [2 bytes confidence (u16 BE, scaled 0-10000)]
 *   [4 bytes slots_remaining (u32 BE)]
 *   [8 bytes timestamp (u64 BE)]
 */
export function parseLeaderHint(buf: Buffer): LeaderHint | null {
  if (buf.length < 1) return null;

  let offset = 0;

  // Skip stream type byte if present
  if (buf[0] === STREAM_TYPE.LeaderHints) {
    offset += 1;
  }

  if (buf.length < offset + 1) return null;
  const regionLen = buf[offset];
  offset += 1;

  const region = buf.subarray(offset, offset + regionLen).toString('utf-8');
  offset += regionLen;

  const confidenceRaw = buf.readUInt16BE(offset);
  offset += 2;

  const slotsRemaining = buf.readUInt32BE(offset);
  offset += 4;

  // Leader pubkey (length-prefixed)
  let leaderPubkey = 'unknown';
  if (buf.length > offset) {
    const pubkeyLen = buf[offset];
    offset += 1;
    if (pubkeyLen > 0 && buf.length >= offset + pubkeyLen) {
      leaderPubkey = buf.subarray(offset, offset + pubkeyLen).toString('utf-8');
      offset += pubkeyLen;
    }
  }

  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  const confidence = confidenceRaw / 100; // 0-10000 → 0-100

  return {
    timestamp,
    slot: 0, // Not in binary format — populated from context
    expiresAtSlot: slotsRemaining,
    preferredRegion: region,
    backupRegions: [],
    confidence,
    leaderPubkey,
    metadata: {
      tpuRttMs: 0,
      regionScore: confidence,
    },
  };
}

/**
 * Parse a TipInstruction from binary wire format.
 *
 * Wire format:
 *   [1 byte stream type (0x03)]
 *   [1 byte sender_len]
 *   [N bytes sender]
 *   [1 byte wallet_len]
 *   [N bytes wallet (base58)]
 *   [8 bytes tip_amount_lamports (u64 BE)]
 *   [1 byte tier_len]
 *   [N bytes tier]
 *   [4 bytes expected_latency_ms (u32 BE)]
 *   [8 bytes timestamp (u64 BE)]
 */
export function parseTipInstruction(buf: Buffer): TipInstruction | null {
  if (buf.length < 1) return null;

  let offset = 0;

  if (buf[0] === STREAM_TYPE.TipInstructions) {
    offset += 1;
  }

  const senderLen = buf[offset];
  offset += 1;
  const sender = buf.subarray(offset, offset + senderLen).toString('utf-8');
  offset += senderLen;

  const walletLen = buf[offset];
  offset += 1;
  const wallet = buf.subarray(offset, offset + walletLen).toString('utf-8');
  offset += walletLen;

  const amountLamports = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  const tierLen = buf[offset];
  offset += 1;
  const tier = buf.subarray(offset, offset + tierLen).toString('utf-8');
  offset += tierLen;

  const expectedLatencyMs = buf.readUInt32BE(offset);
  offset += 4;

  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  const tipAmountSol = amountLamports / 1_000_000_000;

  return {
    timestamp,
    sender,
    senderName: sender,
    tipWalletAddress: wallet,
    tipAmountSol,
    tipTier: tier,
    expectedLatencyMs,
    confidence: 100,
    validUntilSlot: 0,
    alternativeSenders: [],
  };
}

/**
 * Parse a PriorityFee from binary wire format.
 *
 * Wire format:
 *   [1 byte stream type (0x04)]
 *   [8 bytes micro_lamports_per_cu (u64 BE)]
 *   [1 byte percentile]
 *   [4 bytes sample_count (u32 BE)]
 *   [8 bytes timestamp (u64 BE)]
 */
export function parsePriorityFee(buf: Buffer): PriorityFee | null {
  if (buf.length < 1) return null;

  let offset = 0;

  if (buf[0] === STREAM_TYPE.PriorityFees) {
    offset += 1;
  }

  const microLamports = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  const percentile = buf[offset];
  offset += 1;

  const sampleCount = buf.readUInt32BE(offset);
  offset += 4;

  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  return {
    timestamp,
    speed: percentile >= 75 ? 'fast' : percentile >= 50 ? 'medium' : 'slow',
    computeUnitPrice: microLamports,
    computeUnitLimit: 200_000, // Default CU limit
    estimatedCostSol: (microLamports * 200_000) / 1_000_000_000_000,
    landingProbability: percentile / 100,
    networkCongestion: microLamports > 100_000 ? 'high' : microLamports > 10_000 ? 'medium' : 'low',
    recentSuccessRate: sampleCount > 0 ? 0.95 : 0,
  };
}

/**
 * Parse a LatestBlockhash from binary wire format.
 *
 * Wire format:
 *   [1 byte stream type (0x06)]
 *   [1 byte blockhash_len]
 *   [N bytes blockhash (base58)]
 *   [8 bytes last_valid_block_height (u64 BE)]
 *   [8 bytes timestamp (u64 BE)]
 */
export function parseLatestBlockhash(buf: Buffer): LatestBlockhash | null {
  if (buf.length < 1) return null;

  let offset = 0;

  if (buf[0] === STREAM_TYPE.LatestBlockhash) {
    offset += 1;
  }

  const hashLen = buf[offset];
  offset += 1;
  const blockhash = buf.subarray(offset, offset + hashLen).toString('utf-8');
  offset += hashLen;

  const lastValidBlockHeight = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  return { blockhash, lastValidBlockHeight, timestamp };
}

/**
 * Parse a LatestSlot from binary wire format.
 *
 * Wire format:
 *   [1 byte stream type (0x07)]
 *   [8 bytes slot (u64 BE)]
 *   [8 bytes timestamp (u64 BE)]
 */
export function parseLatestSlot(buf: Buffer): LatestSlot | null {
  if (buf.length < 1) return null;

  let offset = 0;

  if (buf[0] === STREAM_TYPE.LatestSlot) {
    offset += 1;
  }

  const slot = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;

  return { slot, timestamp };
}

// ============================================================================
// Ping / Pong Frames (Keep-Alive + Time Sync)
// ============================================================================

/**
 * Build ping frame for time sync.
 * Wire format: [0x08][4 bytes seq (u32 BE)][8 bytes client_time (u64 BE)]
 */
export function buildPingFrame(seq: number, clientTime: number): Buffer {
  const frame = Buffer.alloc(13);
  frame[0] = STREAM_TYPE.Ping;
  frame.writeUInt32BE(seq, 1);
  frame.writeBigUInt64BE(BigInt(clientTime), 5);
  return frame;
}

/**
 * Parse pong response from server.
 * Wire format: [0x08][4 bytes seq][8 bytes client_send_time][8 bytes server_time]
 */
export function parsePongFrame(buf: Buffer): { seq: number; clientSendTime: number; serverTime: number } | null {
  if (buf.length < 21) return null;
  const offset = buf[0] === STREAM_TYPE.Ping ? 1 : 0;
  if (buf.length < offset + 20) return null;
  const seq = buf.readUInt32BE(offset);
  const clientSendTime = Number(buf.readBigUInt64BE(offset + 4));
  const serverTime = Number(buf.readBigUInt64BE(offset + 12));
  return { seq, clientSendTime, serverTime };
}

// ============================================================================
// Base58 Encoding (minimal, for signatures only)
// ============================================================================

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Buffer | Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Leading zeros
  let output = '';
  for (const byte of bytes) {
    if (byte === 0) output += '1';
    else break;
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }

  return output;
}
