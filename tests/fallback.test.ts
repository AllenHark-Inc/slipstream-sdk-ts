import { connectTargets } from '../src/discovery';
import { SlipstreamError } from '../src/errors';
import { isConnectFailure, tryTargets } from '../src/transport/fallback';
import { WorkerEndpoint } from '../src/types';

// ============================================================================
// connectTargets ordering
// ============================================================================

describe('connectTargets', () => {
  const withLegacy: WorkerEndpoint = {
    id: 'w1',
    region: 'us-east',
    quic: 'quic://10.0.0.1:4435',
    legacyQuic: 'quic://10.0.0.1:4433',
    websocket: 'ws://10.0.0.1:9002/ws',
    legacyWebsocket: 'ws://10.0.0.1:9000/ws',
  };

  const withoutLegacy: WorkerEndpoint = {
    id: 'w2',
    region: 'us-east',
    quic: 'quic://10.0.0.2:4433',
    websocket: 'ws://10.0.0.2:9000/ws',
  };

  test('returns [primary, legacy] in order when legacy is present', () => {
    expect(connectTargets(withLegacy, 'quic')).toEqual([
      'quic://10.0.0.1:4435',
      'quic://10.0.0.1:4433',
    ]);
    expect(connectTargets(withLegacy, 'websocket')).toEqual([
      'ws://10.0.0.1:9002/ws',
      'ws://10.0.0.1:9000/ws',
    ]);
  });

  test('returns [primary] when there is no legacy endpoint', () => {
    expect(connectTargets(withoutLegacy, 'quic')).toEqual(['quic://10.0.0.2:4433']);
    expect(connectTargets(withoutLegacy, 'websocket')).toEqual(['ws://10.0.0.2:9000/ws']);
  });
});

// ============================================================================
// isConnectFailure classification
// ============================================================================

describe('isConnectFailure', () => {
  test('CONNECTION and TIMEOUT errors are connect failures', () => {
    expect(isConnectFailure(SlipstreamError.connection('refused'))).toBe(true);
    expect(isConnectFailure(SlipstreamError.timeout(2000))).toBe(true);
  });

  test('application errors (auth, protocol, validation) are NOT connect failures', () => {
    expect(isConnectFailure(SlipstreamError.auth('bad key'))).toBe(false);
    expect(isConnectFailure(SlipstreamError.protocol('bad frame'))).toBe(false);
    expect(isConnectFailure(new Error('some other error'))).toBe(false);
  });
});

// ============================================================================
// tryTargets — the core fallback loop
// ============================================================================

describe('tryTargets', () => {
  test('does not attempt the legacy target when the primary resolves', async () => {
    const attemptFn = jest.fn(async (target: string) => `ok:${target}`);

    const result = await tryTargets(['primary', 'legacy'], attemptFn);

    expect(result).toBe('ok:primary');
    expect(attemptFn).toHaveBeenCalledTimes(1);
    expect(attemptFn).toHaveBeenCalledWith('primary');
  });

  test('attempts the legacy target only after the primary rejects with a connect failure', async () => {
    const attemptFn = jest.fn(async (target: string) => {
      if (target === 'primary') throw SlipstreamError.connection('connection refused');
      return `ok:${target}`;
    });

    const result = await tryTargets(['primary', 'legacy'], attemptFn);

    expect(result).toBe('ok:legacy');
    expect(attemptFn).toHaveBeenCalledTimes(2);
    expect(attemptFn.mock.calls).toEqual([['primary'], ['legacy']]);
  });

  test('does NOT fall back to legacy on an application error (e.g. auth)', async () => {
    const attemptFn = jest.fn(async (target: string) => {
      if (target === 'primary') throw SlipstreamError.auth('invalid api key');
      return `ok:${target}`;
    });

    await expect(tryTargets(['primary', 'legacy'], attemptFn)).rejects.toThrow('invalid api key');
    expect(attemptFn).toHaveBeenCalledTimes(1);
    expect(attemptFn).toHaveBeenCalledWith('primary');
  });

  test('single target (no legacy) surfaces the error unchanged — today\'s behavior', async () => {
    const err = SlipstreamError.connection('connection refused');
    const attemptFn = jest.fn(async () => {
      throw err;
    });

    await expect(tryTargets(['primary'], attemptFn)).rejects.toBe(err);
    expect(attemptFn).toHaveBeenCalledTimes(1);
  });

  test('surfaces the legacy attempt error when both targets fail', async () => {
    const attemptFn = jest.fn(async (target: string) => {
      throw SlipstreamError.connection(`refused:${target}`);
    });

    await expect(tryTargets(['primary', 'legacy'], attemptFn)).rejects.toThrow('refused:legacy');
    expect(attemptFn).toHaveBeenCalledTimes(2);
  });
});
