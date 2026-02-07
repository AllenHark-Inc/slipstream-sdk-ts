[![allenhark.com](https://allenhark.com/allenhark-logo.png)](https://allenhark.com)

# Slipstream TypeScript SDK

The official TypeScript/JavaScript client for **AllenHark Slipstream**, the high-performance Solana transaction relay and intelligence network.

[![npm](https://img.shields.io/npm/v/@allenhark/slipstream.svg)](https://www.npmjs.com/package/@allenhark/slipstream)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Features

- **Discovery-based connection** -- auto-discovers workers, no manual endpoint configuration
- **Leader-proximity routing** -- real-time leader hints route transactions to the lowest-latency region
- **Multi-region support** -- connect to workers across regions, auto-route based on leader schedule
- **Streaming subscriptions** -- leader hints, tip instructions, priority fees via WebSocket
- **Token billing** -- check balance, deposit SOL, view usage history
- **Protocol fallback** -- WebSocket with automatic HTTP fallback
- **Full TypeScript types** -- complete type safety for all API surfaces

## Installation

```bash
npm install @allenhark/slipstream
```

Requires Node.js 23+. Also works in modern browsers via WebSocket.

## Quick Start

```typescript
import { SlipstreamClient, configBuilder } from '@allenhark/slipstream';

// Connect with just an API key -- discovery handles the rest
const client = await SlipstreamClient.connect(
  configBuilder().apiKey('sk_live_your_key_here').build()
);

// Submit a signed transaction
const result = await client.submitTransaction(signedTxBytes);
console.log(`Submitted: ${result.transactionId} (status: ${result.status})`);

// Check your token balance
const balance = await client.getBalance();
console.log(`Balance: ${balance.balanceTokens} tokens (${balance.balanceSol} SOL)`);

// Clean up
await client.disconnect();
```

## Configuration

Use `configBuilder()` to construct a `SlipstreamConfig` object. Only `apiKey` is required.

```typescript
import { configBuilder, BackoffStrategy, PriorityFeeSpeed } from '@allenhark/slipstream';

const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .region('us-east')
  .minConfidence(60)
  .build();
```

### Configuration Reference

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey(key)` | `string` | *required* | API key (must start with `sk_`) |
| `region(region)` | `string` | auto | Preferred region (e.g., `'us-east'`, `'eu-central'`) |
| `endpoint(url)` | `string` | auto | Override discovery with explicit worker endpoint |
| `discoveryUrl(url)` | `string` | `https://discovery.slipstream.allenhark.com` | Custom discovery service URL |
| `connectionTimeout(ms)` | `number` | `10000` | Connection timeout in milliseconds |
| `maxRetries(n)` | `number` | `3` | Maximum retry attempts for failed requests |
| `leaderHints(bool)` | `boolean` | `true` | Auto-subscribe to leader hint stream |
| `streamTipInstructions(bool)` | `boolean` | `false` | Auto-subscribe to tip instruction stream |
| `streamPriorityFees(bool)` | `boolean` | `false` | Auto-subscribe to priority fee stream |
| `protocolTimeouts(obj)` | `ProtocolTimeouts` | `{ websocket: 3000, http: 5000 }` | Per-protocol timeouts |
| `priorityFee(obj)` | `PriorityFeeConfig` | `{ enabled: false, speed: 'fast' }` | Priority fee configuration |
| `retryBackoff(strategy)` | `BackoffStrategy` | `Exponential` | Retry backoff strategy (`Linear` or `Exponential`) |
| `minConfidence(n)` | `number` | `70` | Minimum confidence (0-100) for leader hint routing |
| `idleTimeout(ms)` | `number` | none | Disconnect after idle period |

## Transaction Submission

### Basic Submit

```typescript
const result = await client.submitTransaction(signedTxBytes);

if (result.status === 'confirmed') {
  console.log(`Confirmed in slot ${result.slot}`);
  console.log(`Signature: ${result.signature}`);
}
```

### Submit with Options

```typescript
import { SubmitOptions } from '@allenhark/slipstream';

const result = await client.submitTransactionWithOptions(signedTxBytes, {
  broadcastMode: true,       // Send to multiple regions simultaneously
  preferredSender: 'nozomi', // Prefer a specific sender
  maxRetries: 5,             // Override default retry count
  timeoutMs: 10000,          // Custom timeout
  dedupId: 'my-unique-id',   // Custom deduplication ID
});
```

### Transaction Statuses

| Status | Description |
|--------|-------------|
| `pending` | Received, not yet processed |
| `processing` | Being validated and routed |
| `sent` | Forwarded to sender |
| `confirmed` | Confirmed on Solana |
| `failed` | Failed permanently |
| `duplicate` | Deduplicated (already submitted) |
| `rate_limited` | Rate limit exceeded |
| `insufficient_tokens` | Not enough token balance |

## Streaming

The SDK streams real-time data over WebSocket. Subscribe to events using the `on()` method.

### Leader Hints

Leader hints tell you which region is closest to the current Solana leader validator. Emitted every 250ms when confidence is above the configured threshold.

```typescript
client.on('leaderHint', (hint) => {
  console.log(`Slot ${hint.slot}: best region = ${hint.preferredRegion}`);
  console.log(`Confidence: ${hint.confidence}%, TPU RTT: ${hint.metadata.tpuRttMs}ms`);
  console.log(`Backups: ${hint.backupRegions.join(', ')}`);
});

await client.subscribeLeaderHints();
```

### Tip Instructions

Tip instructions provide the wallet address and amount needed when building transactions in streaming tip mode. The SDK caches the latest tip for convenience.

```typescript
client.on('tipInstruction', (tip) => {
  console.log(`Sender: ${tip.senderName}`);
  console.log(`Tip wallet: ${tip.tipWalletAddress}`);
  console.log(`Tip amount: ${tip.tipAmountSol} SOL`);
  console.log(`Tier: ${tip.tipTier}, latency: ${tip.expectedLatencyMs}ms`);
});

await client.subscribeTipInstructions();

// Access the most recent tip at any time
const latestTip = client.getLatestTip();
```

### Priority Fees

Priority fee recommendations based on current network conditions.

```typescript
client.on('priorityFee', (fee) => {
  console.log(`Speed: ${fee.speed}`);
  console.log(`Compute unit price: ${fee.computeUnitPrice}`);
  console.log(`Landing probability: ${(fee.landingProbability * 100).toFixed(0)}%`);
  console.log(`Network congestion: ${fee.networkCongestion}`);
});

await client.subscribePriorityFees();
```

### Transaction Updates

Real-time status updates for submitted transactions.

```typescript
client.on('transactionUpdate', (update) => {
  console.log(`TX ${update.transactionId}: ${update.status}`);
  if (update.routing) {
    console.log(`Routed via ${update.routing.region} -> ${update.routing.sender}`);
  }
});
```

## Token Billing

Slipstream uses a token-based billing system. 1 token = 1 query = 50,000 lamports = 0.00005 SOL.

### Check Balance

```typescript
const balance = await client.getBalance();
console.log(`${balance.balanceTokens} tokens (${balance.balanceSol} SOL)`);
console.log(`Grace remaining: ${balance.graceRemainingTokens} tokens`);
```

### Get Deposit Address

Top up your balance by sending SOL to your deposit wallet.

```typescript
const deposit = await client.getDepositAddress();
console.log(`Send SOL to: ${deposit.depositWallet}`);
console.log(`Minimum deposit: ${deposit.minAmountSol} SOL`);
```

### Usage History

```typescript
const usage = await client.getUsageHistory({ limit: 50, offset: 0 });
for (const entry of usage) {
  console.log(`${entry.txType}: ${entry.amountLamports} lamports`);
}
```

### Deposit History

```typescript
const deposits = await client.getDepositHistory({ limit: 20 });
for (const d of deposits) {
  console.log(`${d.amountSol} SOL (credited: ${d.credited})`);
}
```

### Pending Deposits

Deposits under $10 USD are held as pending until the cumulative total reaches the minimum.

```typescript
const pending = await client.getPendingDeposit();
if (pending.pendingCount > 0) {
  console.log(`${pending.pendingSol} SOL pending (${pending.pendingCount} deposits)`);
  console.log(`Minimum to credit: $${pending.minimumDepositUsd} USD`);
}
```

## Multi-Region Routing

`MultiRegionClient` connects to workers across multiple regions and automatically routes transactions to the region closest to the current Solana leader.

### Auto-Discovery

```typescript
import { MultiRegionClient, configBuilder } from '@allenhark/slipstream';

const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .leaderHints(true)
  .build();

// Discovers all regions and connects automatically
const multi = await MultiRegionClient.connect(config);

// Transactions auto-route to the best region
const result = await multi.submitTransaction(signedTxBytes);

console.log(`Connected regions: ${multi.connectedRegions().join(', ')}`);

// Listen for routing changes
multi.on('routingUpdate', (routing) => {
  console.log(`Now routing to ${routing.bestRegion} (confidence: ${routing.confidence}%)`);
});

await multi.disconnectAll();
```

### Manual Worker Configuration

```typescript
import { MultiRegionClient, configBuilder, WorkerEndpoint } from '@allenhark/slipstream';

const workers: WorkerEndpoint[] = [
  { id: 'w1', region: 'us-east', http: 'http://10.0.1.1:9000', websocket: 'ws://10.0.1.1:9000/ws' },
  { id: 'w2', region: 'eu-central', http: 'http://10.0.2.1:9000', websocket: 'ws://10.0.2.1:9000/ws' },
  { id: 'w3', region: 'ap-tokyo', http: 'http://10.0.3.1:9000', websocket: 'ws://10.0.3.1:9000/ws' },
];

const multi = await MultiRegionClient.create(
  configBuilder().apiKey('sk_live_your_key_here').build(),
  workers,
  {
    autoFollowLeader: true,
    minSwitchConfidence: 70,
    switchCooldownMs: 5000,
    broadcastHighPriority: false,
    maxBroadcastRegions: 3,
  }
);
```

### MultiRegionConfig Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoFollowLeader` | `boolean` | `true` | Auto-switch region based on leader hints |
| `minSwitchConfidence` | `number` | `60` | Minimum confidence to trigger region switch |
| `switchCooldownMs` | `number` | `5000` | Cooldown between region switches |
| `broadcastHighPriority` | `boolean` | `false` | Broadcast high-priority transactions to all regions |
| `maxBroadcastRegions` | `number` | `3` | Max regions for broadcast mode |

## Error Handling

All errors are instances of `SlipstreamError` with a `code` property for programmatic handling.

```typescript
import { SlipstreamError } from '@allenhark/slipstream';

try {
  const result = await client.submitTransaction(txBytes);
} catch (err) {
  if (err instanceof SlipstreamError) {
    switch (err.code) {
      case 'INSUFFICIENT_TOKENS':
        console.log('Top up your balance');
        break;
      case 'RATE_LIMITED':
        console.log('Slow down, rate limited');
        break;
      case 'TIMEOUT':
        console.log('Request timed out');
        break;
      case 'CONNECTION':
        console.log('Connection error:', err.message);
        break;
      case 'TRANSACTION':
        console.log('Transaction error:', err.message);
        break;
      default:
        console.log(`Error [${err.code}]: ${err.message}`);
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `CONFIG` | Invalid configuration |
| `CONNECTION` | Connection failure |
| `AUTH` | Authentication failure (invalid API key) |
| `PROTOCOL` | Protocol-level error |
| `TRANSACTION` | Transaction submission error |
| `TIMEOUT` | Operation timed out |
| `RATE_LIMITED` | Rate limit exceeded |
| `NOT_CONNECTED` | Client not connected |
| `STREAM_CLOSED` | WebSocket stream closed |
| `INSUFFICIENT_TOKENS` | Token balance too low |
| `ALL_PROTOCOLS_FAILED` | All connection protocols failed |
| `INTERNAL` | Internal SDK error |

## Connection Lifecycle

```typescript
// Connection events
client.on('connected', () => console.log('WebSocket connected'));
client.on('disconnected', () => console.log('WebSocket disconnected'));
client.on('error', (err) => console.error('Error:', err));

// Check status
const status = client.connectionStatus();
console.log(`State: ${status.state}, Protocol: ${status.protocol}`);

// Performance metrics
const metrics = client.metrics();
console.log(`Submitted: ${metrics.transactionsSubmitted}`);
console.log(`Confirmed: ${metrics.transactionsConfirmed}`);
console.log(`Avg latency: ${metrics.averageLatencyMs.toFixed(1)}ms`);
console.log(`Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
```

## Examples

| Example | Description |
|---------|-------------|
| [`basic.ts`](./examples/basic.ts) | Connect and submit a transaction |
| [`streaming.ts`](./examples/streaming.ts) | Leader hints, tips, and priority fee streams |
| [`billing.ts`](./examples/billing.ts) | Balance, deposits, and usage history |
| [`multi-region.ts`](./examples/multi-region.ts) | Auto-routing with MultiRegionClient |
| [`advanced-config.ts`](./examples/advanced-config.ts) | All ConfigBuilder options |
| [`submit-transaction.ts`](./examples/submit-transaction.ts) | Transaction submission with options |
| [`priority-fees.ts`](./examples/priority-fees.ts) | Priority fee configuration and streaming |
| [`deduplication.ts`](./examples/deduplication.ts) | Deduplication patterns |

## Governance and Support

This SDK is community supported. Enterprise support is available at [allenhark.com](https://allenhark.com).

## License

Apache-2.0
