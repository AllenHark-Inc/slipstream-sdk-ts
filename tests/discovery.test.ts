import { connectTargets, workersToEndpoints } from '../src/discovery';
import { DiscoveryWorker } from '../src/types';

// ============================================================================
// workersToEndpoints — legacy port mirroring
// ============================================================================

describe('workersToEndpoints legacy ports', () => {
  test('discovery response WITH legacy_* ports sets legacy endpoint fields', () => {
    const workers: DiscoveryWorker[] = [
      {
        id: 'worker-1',
        region: 'us-east',
        ip: '203.0.113.10',
        ports: {
          quic: 4435,
          grpc: 10001,
          ws: 9002,
          http: 9092,
          legacy_quic: 4433,
          legacy_grpc: 10000,
          legacy_ws: 9000,
        },
        healthy: true,
      },
    ];

    const endpoints = workersToEndpoints(workers);
    expect(endpoints).toHaveLength(1);

    const w = endpoints[0];
    expect(w.quic).toBe('quic://203.0.113.10:4435');
    expect(w.websocket).toBe('ws://203.0.113.10:9002/ws');
    expect(w.http).toBe('http://203.0.113.10:9092');

    expect(w.legacyQuic).toBe('quic://203.0.113.10:4433');
    expect(w.legacyGrpc).toBe('http://203.0.113.10:10000');
    expect(w.legacyWebsocket).toBe('ws://203.0.113.10:9000/ws');
  });

  test('discovery response WITHOUT legacy_* ports (old control plane) leaves legacy fields undefined', () => {
    const workers: DiscoveryWorker[] = [
      {
        id: 'worker-2',
        region: 'us-west',
        ip: '203.0.113.20',
        ports: { quic: 4433, grpc: 10000, ws: 9000, http: 9091 },
        healthy: true,
      },
    ];

    const endpoints = workersToEndpoints(workers);
    expect(endpoints).toHaveLength(1);

    const w = endpoints[0];
    // Still produces a valid, fully-formed endpoint.
    expect(w.quic).toBe('quic://203.0.113.20:4433');
    expect(w.websocket).toBe('ws://203.0.113.20:9000/ws');
    expect(w.http).toBe('http://203.0.113.20:9091');

    // But no legacy endpoints — old CP never sent them.
    expect(w.legacyQuic).toBeUndefined();
    expect(w.legacyGrpc).toBeUndefined();
    expect(w.legacyWebsocket).toBeUndefined();
  });
});

// ============================================================================
// connectTargets
// ============================================================================

describe('connectTargets', () => {
  test('returns [primary, legacy] in order when a legacy endpoint is present', () => {
    const endpoint = workersToEndpoints([
      {
        id: 'worker-1',
        region: 'us-east',
        ip: '203.0.113.10',
        ports: { quic: 4435, grpc: 10001, ws: 9002, legacy_quic: 4433, legacy_ws: 9000 },
        healthy: true,
      },
    ])[0];

    expect(connectTargets(endpoint, 'quic')).toEqual([
      'quic://203.0.113.10:4435',
      'quic://203.0.113.10:4433',
    ]);
    expect(connectTargets(endpoint, 'websocket')).toEqual([
      'ws://203.0.113.10:9002/ws',
      'ws://203.0.113.10:9000/ws',
    ]);
  });

  test('returns [primary] when there is no legacy endpoint', () => {
    const endpoint = workersToEndpoints([
      {
        id: 'worker-2',
        region: 'us-west',
        ip: '203.0.113.20',
        ports: { quic: 4433, grpc: 10000, ws: 9000 },
        healthy: true,
      },
    ])[0];

    expect(connectTargets(endpoint, 'quic')).toEqual(['quic://203.0.113.20:4433']);
    expect(connectTargets(endpoint, 'websocket')).toEqual(['ws://203.0.113.20:9000/ws']);
  });

  test('dedupes when legacy happens to equal primary', () => {
    const endpoint = {
      id: 'worker-3',
      region: 'us-east',
      quic: 'quic://203.0.113.30:4433',
      legacyQuic: 'quic://203.0.113.30:4433',
    };

    expect(connectTargets(endpoint, 'quic')).toEqual(['quic://203.0.113.30:4433']);
  });
});
