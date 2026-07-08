/**
 * @allenhark/slipstream — Service Discovery
 *
 * Automatically discovers available workers and regions from the
 * Slipstream discovery endpoint. SDKs call this before connecting
 * so no manual endpoint configuration is needed.
 */

import { SlipstreamError } from './errors';
import { DiscoveryResponse, DiscoveryWorker, WorkerEndpoint } from './types';

export const DEFAULT_DISCOVERY_URL = 'https://discovery.allenhark.network';

/**
 * Fetch available workers and regions from the discovery service.
 *
 * @param discoveryUrl - Base URL of the discovery service
 * @returns Discovery response with regions and workers
 */
export async function discover(discoveryUrl: string): Promise<DiscoveryResponse> {
  const url = `${discoveryUrl}/v1/discovery`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    throw SlipstreamError.connection(`Discovery request failed: ${err.message}`);
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw SlipstreamError.connection(
      `Discovery failed (HTTP ${response.status}): ${body}`,
    );
  }

  return response.json() as Promise<DiscoveryResponse>;
}

/**
 * Convert discovery workers to SDK WorkerEndpoints.
 * Only includes healthy workers.
 */
export function workersToEndpoints(workers: DiscoveryWorker[]): WorkerEndpoint[] {
  return workers
    .filter((w) => w.healthy)
    .map((w) => {
      const httpPort = w.ports.http ?? 9091;
      const wsPort = w.ports.ws ?? httpPort;

      // Legacy fallback endpoints — only present during a port migration.
      // Built with the same URL shape as their primary counterparts so the
      // connect path can dial them transparently.
      const legacyQuic =
        w.ports.legacy_quic !== undefined
          ? `quic://${w.ip}:${w.ports.legacy_quic}`
          : undefined;
      const legacyGrpc =
        w.ports.legacy_grpc !== undefined
          ? `http://${w.ip}:${w.ports.legacy_grpc}`
          : undefined;
      const legacyWebsocket =
        w.ports.legacy_ws !== undefined
          ? `ws://${w.ip}:${w.ports.legacy_ws}/ws`
          : undefined;

      return {
        id: w.id,
        region: w.region,
        quic: `quic://${w.ip}:${w.ports.quic}`,
        websocket: `ws://${w.ip}:${wsPort}/ws`,
        http: `http://${w.ip}:${httpPort}`,
        legacyQuic,
        legacyGrpc,
        legacyWebsocket,
      };
    });
}

/** Protocols whose worker endpoint carries both a primary and a legacy variant. */
export type LegacyCapableProtocol = 'quic' | 'websocket';

/**
 * Build the ordered list of connect targets for a worker endpoint and
 * protocol: the primary endpoint first, followed by the legacy endpoint
 * (if the worker advertises one and it differs from the primary).
 *
 * Returns `[primary]` when there is no legacy endpoint (today's
 * single-attempt behavior, unchanged for old control planes / workers
 * that never had a port migration), or `[]` when the worker has no
 * primary endpoint for the protocol at all.
 */
export function connectTargets(
  endpoint: WorkerEndpoint,
  protocol: LegacyCapableProtocol,
): string[] {
  const primary = protocol === 'quic' ? endpoint.quic : endpoint.websocket;
  if (!primary) return [];

  const legacy = protocol === 'quic' ? endpoint.legacyQuic : endpoint.legacyWebsocket;

  if (!legacy || legacy === primary) return [primary];
  return [primary, legacy];
}

/**
 * Pick the best region from a discovery response.
 *
 * @param response - Discovery response
 * @param preferred - User's preferred region (optional)
 * @returns Best region ID, or null if no healthy workers
 */
export function bestRegion(
  response: DiscoveryResponse,
  preferred?: string,
): string | null {
  if (preferred) {
    const hasWorkers = response.workers.some(
      (w) => w.region === preferred && w.healthy,
    );
    if (hasWorkers) return preferred;
  }
  return response.recommended_region ?? null;
}

/**
 * Filter discovery workers by region.
 */
export function workersForRegion(
  response: DiscoveryResponse,
  region: string,
): DiscoveryWorker[] {
  return response.workers.filter((w) => w.region === region && w.healthy);
}
