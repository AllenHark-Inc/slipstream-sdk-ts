/**
 * @allenhark/slipstream — Legacy-port connect fallback
 *
 * Shared "prefer-primary / single-legacy-fallback" connect semantics used by
 * every transport that dials a worker endpoint (QUIC, WebSocket, gRPC).
 * Mirrors the Rust SDK's `client-sdk/rust/src/connection/mod.rs` behavior:
 *
 * - The PRIMARY target is tried first. On success, no other target is ever
 *   attempted.
 * - If (and only if) the primary attempt fails with a *connect/transport*
 *   error — connection refused, DNS failure, transport-establishment error,
 *   or a connect timeout — the LEGACY target (if one exists) is tried
 *   exactly once.
 * - Application errors (auth rejection, protocol/validation errors, etc.)
 *   are surfaced immediately and never trigger a fallback, since they would
 *   fail identically against the legacy port.
 * - No legacy target present ⇒ single attempt, error surfaced unchanged
 *   (today's behavior, byte-for-byte).
 */

import { SlipstreamError } from '../errors';

/**
 * Classify whether an error is a connect/transport-establishment failure
 * (worth retrying against a different endpoint) versus an application
 * error, which must NOT trigger a legacy-port fallback.
 */
export function isConnectFailure(err: unknown): boolean {
  return err instanceof SlipstreamError && (err.code === 'CONNECTION' || err.code === 'TIMEOUT');
}

/**
 * Attempt `attemptFn` against each target in order, returning the first
 * success. Only proceeds to the next target when the previous attempt
 * failed with a connect/transport error (see {@link isConnectFailure}); any
 * other error — or a failure on the final target — is thrown immediately.
 *
 * A successful attempt on an earlier target means `attemptFn` is never
 * invoked for any subsequent target.
 */
export async function tryTargets<T>(
  targets: string[],
  attemptFn: (target: string) => Promise<T>,
): Promise<T> {
  if (targets.length === 0) {
    throw SlipstreamError.connection('No connect targets available');
  }

  let lastError: unknown;
  for (let i = 0; i < targets.length; i++) {
    try {
      return await attemptFn(targets[i]);
    } catch (err) {
      lastError = err;
      const isLastTarget = i === targets.length - 1;
      if (isLastTarget || !isConnectFailure(err)) {
        throw err;
      }
      // Connect/transport failure with more targets remaining — fall
      // through to the next (legacy) target.
    }
  }

  // Unreachable — the loop above always returns or throws — but keeps
  // the type checker happy and guards against future refactors.
  throw lastError;
}
