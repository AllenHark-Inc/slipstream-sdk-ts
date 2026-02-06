/**
 * @allenhark/slipstream — Worker Selector
 *
 * Pings available workers and selects the lowest-latency endpoint.
 */

import { SlipstreamError } from './errors';
import { WorkerEndpoint } from './types';

interface LatencyMeasurement {
  rttMs: number;
  measuredAt: number;
  reachable: boolean;
}

export class WorkerSelector {
  private readonly workers: WorkerEndpoint[];
  private readonly latencies = new Map<string, LatencyMeasurement>();
  private readonly cacheTtlMs: number;
  private readonly pingTimeoutMs: number;

  constructor(
    workers: WorkerEndpoint[],
    cacheTtlMs = 30_000,
    pingTimeoutMs = 5_000,
  ) {
    this.workers = workers;
    this.cacheTtlMs = cacheTtlMs;
    this.pingTimeoutMs = pingTimeoutMs;
  }

  workerCount(): number {
    return this.workers.length;
  }

  getWorkers(): ReadonlyArray<WorkerEndpoint> {
    return this.workers;
  }

  async selectBest(): Promise<WorkerEndpoint> {
    if (this.workers.length === 0) {
      throw SlipstreamError.config('No workers available');
    }

    if (this.workers.length === 1) {
      return this.workers[0];
    }

    await this.ensureMeasurements();

    let best: WorkerEndpoint | null = null;
    let bestRtt = Infinity;

    for (const worker of this.workers) {
      const latency = this.latencies.get(worker.id);
      if (latency && latency.reachable && latency.rttMs < bestRtt) {
        bestRtt = latency.rttMs;
        best = worker;
      }
    }

    // Fallback to first worker if none are reachable
    return best ?? this.workers[0];
  }

  async selectBestInRegion(region: string): Promise<WorkerEndpoint> {
    const regionWorkers = this.workers.filter((w) => w.region === region);

    if (regionWorkers.length === 0) {
      throw SlipstreamError.config(`No workers available in region: ${region}`);
    }

    if (regionWorkers.length === 1) {
      return regionWorkers[0];
    }

    await this.ensureMeasurements();

    let best: WorkerEndpoint | null = null;
    let bestRtt = Infinity;

    for (const worker of regionWorkers) {
      const latency = this.latencies.get(worker.id);
      if (latency && latency.reachable && latency.rttMs < bestRtt) {
        bestRtt = latency.rttMs;
        best = worker;
      }
    }

    return best ?? regionWorkers[0];
  }

  async measureAll(): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    const measurements = await Promise.allSettled(
      this.workers.map(async (worker) => {
        const measurement = await this.pingWorker(worker);
        this.latencies.set(worker.id, measurement);
        if (measurement.reachable) {
          results.set(worker.id, measurement.rttMs);
        }
      }),
    );

    // Ensure all measurements are handled (suppress unhandled rejections)
    void measurements;

    return results;
  }

  getLatency(workerId: string): number | undefined {
    const m = this.latencies.get(workerId);
    return m?.reachable ? m.rttMs : undefined;
  }

  private async ensureMeasurements(): Promise<void> {
    const now = Date.now();
    const needsMeasurement = this.workers.some((w) => {
      const m = this.latencies.get(w.id);
      return !m || now - m.measuredAt > this.cacheTtlMs;
    });

    if (needsMeasurement) {
      await this.measureAll();
    }
  }

  private async pingWorker(worker: WorkerEndpoint): Promise<LatencyMeasurement> {
    const endpoint = worker.http;
    if (!endpoint) {
      return { rttMs: Infinity, measuredAt: Date.now(), reachable: false };
    }

    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pingTimeoutMs);

    try {
      await fetch(`${endpoint}/management/health`, {
        method: 'HEAD',
        signal: controller.signal,
      });

      return {
        rttMs: Date.now() - start,
        measuredAt: Date.now(),
        reachable: true,
      };
    } catch {
      return {
        rttMs: Infinity,
        measuredAt: Date.now(),
        reachable: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
