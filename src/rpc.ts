/**
 * @allenhark/slipstream — Typed Solana RPC interface
 *
 * Wraps the raw JSON-RPC proxy with typed methods for every supported Solana RPC call.
 *
 * @example
 * ```typescript
 * const slot = await client.rpc.getSlot();
 * const balance = await client.rpc.getBalance('So11111111111111111111111111111111');
 * const bh = await client.rpc.getLatestBlockhash();
 * ```
 */

import { SlipstreamError } from './errors';
import {
  RpcResponse,
  SimulationResult,
  SolanaAccountInfo,
  SolanaBlockCommitment,
  SolanaEpochInfo,
  SolanaLatestBlockhash,
  SolanaPrioritizationFee,
  SolanaSignatureStatus,
  SolanaSupply,
  SolanaTokenBalance,
  SolanaTokenLargestAccount,
} from './types';

type RpcFn = (method: string, params: unknown[]) => Promise<RpcResponse>;

export class SolanaRpc {
  private readonly httpRpc: RpcFn;

  constructor(httpRpc: RpcFn) {
    this.httpRpc = httpRpc;
  }

  // ---------------------------------------------------------------------------
  // Generic escape hatch
  // ---------------------------------------------------------------------------

  /** Execute any Solana JSON-RPC method (raw). */
  async call(method: string, params: unknown[] = []): Promise<RpcResponse> {
    return this.httpRpc(method, params);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async invoke(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await this.httpRpc(method, params);
    if (response.error) {
      throw new SlipstreamError(
        'RPC_ERROR',
        `RPC error ${response.error.code}: ${response.error.message}`,
        response.error,
      );
    }
    return response.result;
  }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  /** Check node health. Returns "ok" on success. */
  async getHealth(): Promise<string> {
    return (await this.invoke('getHealth')) as string;
  }

  // ---------------------------------------------------------------------------
  // Cluster
  // ---------------------------------------------------------------------------

  /** Get the current slot. */
  async getSlot(commitment?: string): Promise<number> {
    const params: unknown[] = commitment ? [{ commitment }] : [];
    return (await this.invoke('getSlot', params)) as number;
  }

  /** Get the current block height. */
  async getBlockHeight(commitment?: string): Promise<number> {
    const params: unknown[] = commitment ? [{ commitment }] : [];
    return (await this.invoke('getBlockHeight', params)) as number;
  }

  /** Get epoch info. */
  async getEpochInfo(commitment?: string): Promise<SolanaEpochInfo> {
    const params: unknown[] = commitment ? [{ commitment }] : [];
    return (await this.invoke('getEpochInfo', params)) as SolanaEpochInfo;
  }

  /** Get scheduled slot leaders. */
  async getSlotLeaders(startSlot: number, limit: number): Promise<string[]> {
    return (await this.invoke('getSlotLeaders', [startSlot, limit])) as string[];
  }

  // ---------------------------------------------------------------------------
  // Fees
  // ---------------------------------------------------------------------------

  /** Get the latest blockhash and last valid block height. */
  async getLatestBlockhash(commitment?: string): Promise<SolanaLatestBlockhash> {
    const params: unknown[] = commitment ? [{ commitment }] : [];
    return (await this.invoke('getLatestBlockhash', params)) as SolanaLatestBlockhash;
  }

  /** Get fee for a serialised message. Returns lamports or null if invalid. */
  async getFeeForMessage(message: string, commitment?: string): Promise<number | null> {
    const params: unknown[] = [message];
    if (commitment) params.push({ commitment });
    const result = (await this.invoke('getFeeForMessage', params)) as { value: number | null };
    return result.value;
  }

  /** Get recent prioritization fees. */
  async getRecentPrioritizationFees(accounts?: string[]): Promise<SolanaPrioritizationFee[]> {
    const params: unknown[] = accounts ? [accounts] : [];
    return (await this.invoke('getRecentPrioritizationFees', params)) as SolanaPrioritizationFee[];
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  /** Get account info for a public key. */
  async getAccountInfo(
    pubkey: string,
    opts?: { encoding?: string; commitment?: string },
  ): Promise<SolanaAccountInfo> {
    const params: unknown[] = [pubkey];
    if (opts) params.push(opts);
    return (await this.invoke('getAccountInfo', params)) as SolanaAccountInfo;
  }

  /** Get account info for multiple public keys in one call. */
  async getMultipleAccounts(
    pubkeys: string[],
    opts?: { encoding?: string; commitment?: string },
  ): Promise<{ value: (SolanaAccountInfo['value'])[] }> {
    const params: unknown[] = [pubkeys];
    if (opts) params.push(opts);
    return (await this.invoke('getMultipleAccounts', params)) as { value: (SolanaAccountInfo['value'])[] };
  }

  /** Get lamport balance for a public key. Returns the balance in lamports. */
  async getBalance(pubkey: string, commitment?: string): Promise<number> {
    const params: unknown[] = [pubkey];
    if (commitment) params.push({ commitment });
    const result = (await this.invoke('getBalance', params)) as { value: number };
    return result.value;
  }

  /** Get minimum balance for rent exemption given data size in bytes. */
  async getMinimumBalanceForRentExemption(dataSize: number, commitment?: string): Promise<number> {
    const params: unknown[] = [dataSize];
    if (commitment) params.push({ commitment });
    return (await this.invoke('getMinimumBalanceForRentExemption', params)) as number;
  }

  // ---------------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------------

  /** Get token account balance. */
  async getTokenAccountBalance(pubkey: string, commitment?: string): Promise<SolanaTokenBalance> {
    const params: unknown[] = [pubkey];
    if (commitment) params.push({ commitment });
    return (await this.invoke('getTokenAccountBalance', params)) as SolanaTokenBalance;
  }

  /** Get total supply of an SPL token mint. */
  async getTokenSupply(mint: string, commitment?: string): Promise<SolanaTokenBalance> {
    const params: unknown[] = [mint];
    if (commitment) params.push({ commitment });
    return (await this.invoke('getTokenSupply', params)) as SolanaTokenBalance;
  }

  /** Get SOL supply breakdown. */
  async getSupply(commitment?: string): Promise<SolanaSupply> {
    const params: unknown[] = commitment ? [{ commitment }] : [];
    return (await this.invoke('getSupply', params)) as SolanaSupply;
  }

  /** Get 20 largest token accounts for a mint. */
  async getTokenLargestAccounts(mint: string, commitment?: string): Promise<SolanaTokenLargestAccount[]> {
    const params: unknown[] = [mint];
    if (commitment) params.push({ commitment });
    const result = (await this.invoke('getTokenLargestAccounts', params)) as { value: SolanaTokenLargestAccount[] };
    return result.value;
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /** Send a signed transaction. Returns the transaction signature. */
  async sendTransaction(
    transaction: string,
    opts?: { encoding?: string; skipPreflight?: boolean; preflightCommitment?: string; maxRetries?: number },
  ): Promise<string> {
    const params: unknown[] = [transaction];
    if (opts) params.push(opts);
    return (await this.invoke('sendTransaction', params)) as string;
  }

  /** Simulate a transaction. Returns simulation result with logs and compute units. */
  async simulateTransaction(
    transaction: string,
    opts?: { encoding?: string; commitment?: string; replaceRecentBlockhash?: boolean; sigVerify?: boolean },
  ): Promise<SimulationResult> {
    const params: unknown[] = [transaction];
    if (opts) params.push(opts);
    const result = (await this.invoke('simulateTransaction', params)) as { value?: unknown } | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (result as any)?.value ?? result;
    return {
      err: value?.err ?? null,
      logs: value?.logs ?? [],
      unitsConsumed: value?.unitsConsumed ?? 0,
      returnData: value?.returnData ?? null,
    };
  }

  /** Get statuses for a list of transaction signatures. */
  async getSignatureStatuses(
    signatures: string[],
    opts?: { searchTransactionHistory?: boolean },
  ): Promise<{ value: (SolanaSignatureStatus | null)[] }> {
    const params: unknown[] = [signatures];
    if (opts) params.push(opts);
    return (await this.invoke('getSignatureStatuses', params)) as { value: (SolanaSignatureStatus | null)[] };
  }

  /** Get a confirmed transaction by signature. */
  async getTransaction(
    signature: string,
    opts?: { encoding?: string; commitment?: string; maxSupportedTransactionVersion?: number },
  ): Promise<unknown> {
    const params: unknown[] = [signature];
    if (opts) params.push(opts);
    return this.invoke('getTransaction', params);
  }

  // ---------------------------------------------------------------------------
  // Blocks
  // ---------------------------------------------------------------------------

  /** Get block commitment for a slot. */
  async getBlockCommitment(slot: number): Promise<SolanaBlockCommitment> {
    return (await this.invoke('getBlockCommitment', [slot])) as SolanaBlockCommitment;
  }

  /** Get the first available block slot. */
  async getFirstAvailableBlock(): Promise<number> {
    return (await this.invoke('getFirstAvailableBlock')) as number;
  }
}
