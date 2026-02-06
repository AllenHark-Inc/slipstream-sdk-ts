/**
 * @allenhark/slipstream — Error types
 */

export class SlipstreamError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'SlipstreamError';
    this.code = code;
    this.details = details;
  }

  static config(msg: string): SlipstreamError {
    return new SlipstreamError('CONFIG', msg);
  }

  static connection(msg: string): SlipstreamError {
    return new SlipstreamError('CONNECTION', msg);
  }

  static auth(msg: string): SlipstreamError {
    return new SlipstreamError('AUTH', msg);
  }

  static protocol(msg: string): SlipstreamError {
    return new SlipstreamError('PROTOCOL', msg);
  }

  static transaction(msg: string): SlipstreamError {
    return new SlipstreamError('TRANSACTION', msg);
  }

  static timeout(ms: number): SlipstreamError {
    return new SlipstreamError('TIMEOUT', `Operation timed out after ${ms}ms`);
  }

  static allProtocolsFailed(): SlipstreamError {
    return new SlipstreamError('ALL_PROTOCOLS_FAILED', 'All connection protocols failed');
  }

  static rateLimited(msg?: string): SlipstreamError {
    return new SlipstreamError('RATE_LIMITED', msg ?? 'Rate limited');
  }

  static notConnected(): SlipstreamError {
    return new SlipstreamError('NOT_CONNECTED', 'Client is not connected');
  }

  static streamClosed(): SlipstreamError {
    return new SlipstreamError('STREAM_CLOSED', 'Stream has been closed');
  }

  static insufficientTokens(): SlipstreamError {
    return new SlipstreamError('INSUFFICIENT_TOKENS', 'Insufficient token balance');
  }

  static internal(msg: string): SlipstreamError {
    return new SlipstreamError('INTERNAL', msg);
  }
}
