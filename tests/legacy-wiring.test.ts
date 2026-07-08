/**
 * End-to-end wiring test: the client must forward a discovery-advertised
 * legacy WebSocket endpoint into the WebSocketTransport it constructs.
 *
 * This is the coverage the SDK review flagged as missing. Before the wiring
 * fix, the discovery connect path dropped `worker.legacyWebsocket`, so the
 * transport always received `undefined` for its legacy URL and the
 * connect-with-fallback was dead code end-to-end. This test asserts the
 * legacy URL now reaches the transport constructor — it FAILS against the
 * unwired code and passes once `wsLegacyEndpoint` is threaded through.
 */

// Mock the WebSocket transport so we can capture what the client constructs it
// with, without opening a real socket. The captured constructor args are
// exposed on the mocked module (avoids jest hoisting / TDZ on outer vars).
jest.mock('../src/transport/websocket', () => {
  const { EventEmitter } = require('events');
  const calls: unknown[][] = [];
  class MockWebSocketTransport extends EventEmitter {
    constructor(...args: unknown[]) {
      super();
      calls.push(args);
    }
    connect(): Promise<never> {
      return Promise.reject(new Error('mock ws unreachable'));
    }
    disconnect(): Promise<void> {
      return Promise.resolve();
    }
    isConnected(): boolean {
      return false;
    }
  }
  return { WebSocketTransport: MockWebSocketTransport, __wsCtorCalls: calls };
});

// Keep the real discovery helpers (bestRegion / workersForRegion /
// workersToEndpoints) but stub the network `discover` call.
jest.mock('../src/discovery', () => {
  const actual = jest.requireActual('../src/discovery');
  return { ...actual, discover: jest.fn() };
});

import { SlipstreamClient } from '../src/client';
import { configBuilder } from '../src/config';
import { discover } from '../src/discovery';
import * as wsModule from '../src/transport/websocket';
import { DiscoveryResponse } from '../src/types';

// The WebSocketTransport constructor is (url, apiKey, region, tier, legacyUrl).
const LEGACY_URL_ARG_INDEX = 4;

function wsCtorCalls(): unknown[][] {
  return (wsModule as unknown as { __wsCtorCalls: unknown[][] }).__wsCtorCalls;
}

// A discovery response with a single healthy worker. `withLegacy` toggles the
// optional legacy WS port (present during a port migration, absent otherwise).
function discoveryResponse(withLegacy: boolean): DiscoveryResponse {
  return {
    recommended_region: 'us-east',
    regions: [],
    workers: [
      {
        id: 'worker-1',
        region: 'us-east',
        // 127.0.0.1:1 refuses instantly so the health-ping / HTTP fallback
        // resolve fast without a real worker.
        ip: '127.0.0.1',
        ports: {
          quic: 1,
          grpc: 1,
          ws: 1,
          http: 1,
          ...(withLegacy ? { legacy_ws: 2 } : {}),
        },
        healthy: true,
      },
    ],
  } as unknown as DiscoveryResponse;
}

function baseConfig() {
  return configBuilder()
    .apiKey('sk_test_00000000')
    .region('us-east')
    .protocolTimeouts({ quic: 100, websocket: 100, http: 300 })
    .leaderHints(false)
    .build();
}

describe('client forwards legacy WebSocket endpoint into the transport', () => {
  beforeEach(() => {
    wsCtorCalls().length = 0;
    (discover as jest.Mock).mockReset();
  });

  test('discovery worker WITH legacy_ws → transport receives the legacy URL', async () => {
    (discover as jest.Mock).mockResolvedValue(discoveryResponse(true));

    const client = await SlipstreamClient.connect(baseConfig());
    await client.disconnect();

    // The client-constructed transport must have been handed the legacy URL.
    const legacyArgs = wsCtorCalls().map((args) => args[LEGACY_URL_ARG_INDEX]);
    expect(legacyArgs).toContain('ws://127.0.0.1:2/ws');
  }, 10_000);

  test('discovery worker WITHOUT legacy_ws → legacy arg is undefined (unchanged)', async () => {
    (discover as jest.Mock).mockResolvedValue(discoveryResponse(false));

    const client = await SlipstreamClient.connect(baseConfig());
    await client.disconnect();

    // No legacy port advertised ⇒ single-attempt behavior, byte-for-byte today.
    expect(wsCtorCalls().length).toBeGreaterThan(0);
    for (const args of wsCtorCalls()) {
      expect(args[LEGACY_URL_ARG_INDEX]).toBeUndefined();
    }
  }, 10_000);

  test('explicit endpoint (no discovery) → legacy arg is undefined (unchanged)', async () => {
    const config = configBuilder()
      .apiKey('sk_test_00000000')
      .endpoint('http://127.0.0.1:1')
      .protocolTimeouts({ quic: 100, websocket: 100, http: 300 })
      .leaderHints(false)
      .build();

    const client = await SlipstreamClient.connect(config);
    await client.disconnect();

    expect(discover as jest.Mock).not.toHaveBeenCalled();
    expect(wsCtorCalls().length).toBeGreaterThan(0);
    for (const args of wsCtorCalls()) {
      expect(args[LEGACY_URL_ARG_INDEX]).toBeUndefined();
    }
  }, 10_000);
});
