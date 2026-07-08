// Mock the `ws` package so WebSocketTransport tests below can drive fake
// sockets without opening real connections. Exposes `__instances` (all
// created sockets, in creation order) on the mocked module so tests can
// inspect/emit on them directly.
jest.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWebSocket extends EventEmitter {
    url: string;
    closeCalled = false;
    listenerCountAtClose: number | null = null;

    constructor(url: string) {
      super();
      this.url = url;
      (MockWebSocket as unknown as { __instances: MockWebSocket[] }).__instances.push(this);
    }

    send(_data: string): void {
      // no-op — tests don't assert on outbound messages here
    }

    close(): void {
      this.closeCalled = true;
      this.listenerCountAtClose = this.eventNames().length;
    }
  }

  (MockWebSocket as unknown as { __instances: unknown[] }).__instances = [];

  return { __esModule: true, default: MockWebSocket };
});

import { connectTargets } from '../src/discovery';
import { SlipstreamError } from '../src/errors';
import { isConnectFailure, tryTargets } from '../src/transport/fallback';
import { WebSocketTransport } from '../src/transport/websocket';
import { WorkerEndpoint } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const wsModule = require('ws');

interface MockWebSocketInstance extends NodeJS.EventEmitter {
  url: string;
  closeCalled: boolean;
  listenerCountAtClose: number | null;
}

function mockWsInstances(): MockWebSocketInstance[] {
  return wsModule.default.__instances as MockWebSocketInstance[];
}

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

// ============================================================================
// WebSocketTransport — abandoned primary socket cleanup on legacy fallback
// ============================================================================

describe('WebSocketTransport legacy fallback socket cleanup', () => {
  beforeEach(() => {
    mockWsInstances().length = 0;
  });

  test('closes and detaches the failed primary socket before dialing the legacy URL', async () => {
    const transport = new WebSocketTransport(
      'ws://primary.invalid/ws',
      'sk_test_00000000',
      undefined,
      'pro',
      'ws://legacy.invalid/ws',
    );

    const connectPromise = transport.connect();

    // Let the primary socket get created.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockWsInstances()).toHaveLength(1);
    const primary = mockWsInstances()[0];
    expect(primary.url).toBe('ws://primary.invalid/ws');
    expect(primary.closeCalled).toBe(false);

    // Simulate the primary connect failing (e.g. connection refused).
    primary.emit('error', new Error('ECONNREFUSED'));

    // Give the fallback loop a couple of microtask ticks to catch the
    // rejection and dial the legacy target.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The legacy socket must exist, and the primary must have been closed
    // and detached (listeners removed) before it was created.
    expect(mockWsInstances()).toHaveLength(2);
    const legacy = mockWsInstances()[1];
    expect(legacy.url).toBe('ws://legacy.invalid/ws');

    expect(primary.closeCalled).toBe(true);
    expect(primary.listenerCountAtClose).toBe(0);
    expect(primary.eventNames()).toHaveLength(0);

    // Resolve the legacy attempt so the connect() promise settles cleanly
    // and doesn't leave a dangling handle in the test run.
    legacy.emit(
      'message',
      JSON.stringify({
        type: 'connected',
        session_id: 'sess-1',
        region: 'us-east',
        server_time: Date.now(),
        features: [],
        rate_limit: { rps: 100, burst: 200 },
      }),
    );

    const info = await connectPromise;
    expect(info.sessionId).toBe('sess-1');

    await transport.disconnect();
  });

  test('success path (no legacy) never touches a second socket', async () => {
    const transport = new WebSocketTransport(
      'ws://primary.invalid/ws',
      'sk_test_00000000',
      undefined,
      'pro',
    );

    const connectPromise = transport.connect();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockWsInstances()).toHaveLength(1);
    const primary = mockWsInstances()[0];

    primary.emit(
      'message',
      JSON.stringify({
        type: 'connected',
        session_id: 'sess-solo',
        region: 'us-east',
        server_time: Date.now(),
        features: [],
        rate_limit: { rps: 100, burst: 200 },
      }),
    );

    const info = await connectPromise;
    expect(info.sessionId).toBe('sess-solo');
    expect(mockWsInstances()).toHaveLength(1);
    expect(primary.closeCalled).toBe(false);

    await transport.disconnect();
    expect(primary.closeCalled).toBe(true);
  });
});
