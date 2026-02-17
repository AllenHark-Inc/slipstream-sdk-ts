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
    .map((w) => ({
      id: w.id,
      region: w.region,
      quic: `quic://${w.ip}:${w.ports.quic}`,
      websocket: `ws://${w.ip}:${w.ports.ws}/ws`,
      http: `http://${w.ip}:${w.ports.http}`,
    }));
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
