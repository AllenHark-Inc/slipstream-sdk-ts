[![allenhark.com](https://allenhark.com/allenhark-logo.png)](https://allenhark.com)

# Slipstream TypeScript SDK

The official TypeScript/JavaScript client for **AllenHark Slipstream**, the high-performance Solana transaction relay and intelligence network.

[![npm](https://img.shields.io/npm/v/@allenhark/slipstream.svg)](https://www.npmjs.com/package/@allenhark/slipstream)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Features

- **Discovery-based connection** -- auto-discovers workers, no manual endpoint configuration
- **Leader-proximity routing** -- real-time leader hints route transactions to the lowest-latency region
- **Multi-region support** -- connect to workers across regions, auto-route based on leader schedule
- **QUIC transport** -- binary protocol for lowest latency on server-side bots (Node.js)
- **6 real-time streams** -- leader hints, tip instructions, priority fees, latest blockhash, latest slot, transaction updates
- **Stream billing** -- each stream costs 1 token; 1-hour reconnect grace period
- **Billing tiers** -- Free (100 tx/day), Standard, Pro, Enterprise with tier-specific rate limits and pricing
- **Token billing** -- check balance, deposit SOL, view usage and deposit history
- **Keep-alive & time sync** -- background ping with RTT measurement and NTP-style clock synchronization
- **Protocol fallback** -- QUIC -> WebSocket -> HTTP automatic fallback chain
- **Dual entry points** -- `@allenhark/slipstream` (browser) and `@allenhark/slipstream/node` (server with QUIC)
- **Full TypeScript types** -- complete type safety for all API surfaces

## Installation

```bash
npm install @allenhark/slipstream
```

Requires Node.js 23+. Also works in modern browsers via WebSocket.

For server-side QUIC support, also install the optional QUIC dependency:

```bash
npm install @aspect-build/quic
```

## Quick Start

### Browser / General (WebSocket + HTTP)

```typescript
import { SlipstreamClient, configBuilder } from '@allenhark/slipstream';

const client = await SlipstreamClient.connect(
  configBuilder().apiKey('sk_live_your_key_here').build()
);

const result = await client.submitTransaction(signedTxBytes);
console.log(`TX: ${result.transactionId} (${result.status})`);

const balance = await client.getBalance();
console.log(`Balance: ${balance.balanceTokens} tokens`);

await client.disconnect();
```

### Server-Side Bot (QUIC)

```typescript
import { SlipstreamClient, configBuilder } from '@allenhark/slipstream/node';

// Automatically uses QUIC if @aspect-build/quic is installed
const client = await SlipstreamClient.connect(
  configBuilder().apiKey('sk_live_your_key_here').build()
);
console.log(`Connected via ${client.connectionStatus().protocol}`); // 'quic'
```

---

## Configuration

### ConfigBuilder Reference

Use `configBuilder()` to construct a `SlipstreamConfig`. Only `apiKey` is required.

```typescript
import { configBuilder, BackoffStrategy, PriorityFeeSpeed } from '@allenhark/slipstream';

const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .region('us-east')
  .tier('pro')
  .minConfidence(80)
  .build();
```

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey(key)` | `string` | **required** | API key (must start with `sk_`) |
| `region(region)` | `string` | auto | Preferred region (e.g., `'us-east'`, `'eu-central'`) |
| `endpoint(url)` | `string` | auto | Override discovery with explicit worker endpoint |
| `discoveryUrl(url)` | `string` | `https://discovery.slipstream.allenhark.com` | Custom discovery service URL |
| `tier(tier)` | `BillingTier` | `'pro'` | Billing tier: `'free'`, `'standard'`, `'pro'`, `'enterprise'` |
| `connectionTimeout(ms)` | `number` | `10000` | Connection timeout in milliseconds |
| `maxRetries(n)` | `number` | `3` | Maximum retry attempts for failed requests |
| `leaderHints(bool)` | `boolean` | `true` | Auto-subscribe to leader hint stream on connect |
| `streamTipInstructions(bool)` | `boolean` | `false` | Auto-subscribe to tip instruction stream on connect |
| `streamPriorityFees(bool)` | `boolean` | `false` | Auto-subscribe to priority fee stream on connect |
| `streamLatestBlockhash(bool)` | `boolean` | `false` | Auto-subscribe to latest blockhash stream on connect |
| `streamLatestSlot(bool)` | `boolean` | `false` | Auto-subscribe to latest slot stream on connect |
| `protocolTimeouts(obj)` | `ProtocolTimeouts` | `{ quic: 2000, websocket: 3000, http: 5000 }` | Per-protocol timeout in ms |
| `quicConfig(obj)` | `QuicConfig` | see below | QUIC transport options (server-side only) |
| `priorityFee(obj)` | `PriorityFeeConfig` | `{ enabled: false, speed: 'fast' }` | Priority fee optimization (see below) |
| `retryBackoff(strategy)` | `BackoffStrategy` | `'exponential'` | Retry backoff: `'linear'` or `'exponential'` |
| `minConfidence(n)` | `number` | `70` | Minimum confidence (0-100) for leader hint routing |
| `keepAlive(bool)` | `boolean` | `true` | Enable background keep-alive ping loop |
| `keepAliveInterval(ms)` | `number` | `5000` | Keep-alive ping interval in milliseconds |
| `idleTimeout(ms)` | `number` | none | Disconnect after idle period |
| `webhookUrl(url)` | `string` | none | HTTPS endpoint to receive webhook POST deliveries |
| `webhookEvents(events)` | `string[]` | `['transaction.confirmed']` | Webhook event types to subscribe to |
| `webhookNotificationLevel(level)` | `string` | `'final'` | Transaction notification level: `'all'`, `'final'`, or `'confirmed'` |

### Billing Tiers

Each API key has a billing tier that determines transaction cost, rate limits, and priority queuing. Set the tier to match your API key's assigned tier:

```typescript
const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .tier('pro')   // 'free' | 'standard' | 'pro' | 'enterprise'
  .build();
```

| Tier | Cost per TX | Cost per Stream | Rate Limit | Burst | Priority Slots | Daily Limit |
|------|------------|-----------------|------------|-------|----------------|-------------|
| **free** | 0 (counter) | 0 (counter) | 5 rps | 10 | 5 concurrent | 100 tx/day |
| **standard** | 50,000 lamports (0.00005 SOL) | 50,000 lamports | 5 rps | 10 | 10 concurrent | Unlimited |
| **pro** | 100,000 lamports (0.0001 SOL) | 50,000 lamports | 20 rps | 50 | 50 concurrent | Unlimited |
| **enterprise** | 1,000,000 lamports (0.001 SOL) | 50,000 lamports | 100 rps | 200 | 200 concurrent | Unlimited |

- **Free tier**: Uses a daily counter instead of token billing. Transactions and stream subscriptions both decrement the counter. Resets at UTC midnight.
- **Standard/Pro/Enterprise**: Deducted from token balance per transaction. Stream subscriptions cost 1 token each with a 1-hour reconnect grace period.

### PriorityFeeConfig

Controls automatic priority fee optimization for transactions.

```typescript
const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .priorityFee({
    enabled: true,
    speed: PriorityFeeSpeed.UltraFast,
    maxTip: 0.01,  // Max 0.01 SOL
  })
  .build();
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable automatic priority fee optimization |
| `speed` | `PriorityFeeSpeed` | `'fast'` | Fee tier: `'slow'`, `'fast'`, or `'ultra_fast'` |
| `maxTip` | `number` | none | Maximum tip in SOL (caps the priority fee) |

**PriorityFeeSpeed tiers:**

| Speed | Compute Unit Price | Landing Probability | Use Case |
|-------|-------------------|--------------------|---------|
| `'slow'` | Low | ~60-70% | Cost-sensitive, non-urgent transactions |
| `'fast'` | Medium | ~85-90% | Default balance of cost and speed |
| `'ultra_fast'` | High | ~95-99% | Time-critical trading, MEV protection |

### ProtocolTimeouts

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `quic` | `number` | `2000` | QUIC connection timeout (ms) |
| `websocket` | `number` | `3000` | WebSocket connection timeout (ms) |
| `http` | `number` | `5000` | HTTP request timeout (ms) |

### QuicConfig (Server-Side Only)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | `number` | `2000` | QUIC connection timeout (ms) |
| `keepAliveIntervalMs` | `number` | `5000` | Transport-level keep-alive (ms) |
| `maxIdleTimeoutMs` | `number` | `30000` | Max idle before disconnect (ms) |
| `insecure` | `boolean` | `false` | Skip TLS cert verification (dev only) |

### Protocol Fallback Chain

| Environment | Fallback Order |
|-------------|---------------|
| **Server** (`/node`) | QUIC (2s) -> WebSocket (3s) -> HTTP (5s) |
| **Browser** (default) | WebSocket (3s) -> HTTP (5s) |

---

## Connecting

### Auto-Discovery (Recommended)

```typescript
import { SlipstreamClient, configBuilder } from '@allenhark/slipstream';

// Minimal -- discovery finds the best worker
const client = await SlipstreamClient.connect(
  configBuilder().apiKey('sk_live_xxx').build()
);

// With region preference
const client = await SlipstreamClient.connect(
  configBuilder().apiKey('sk_live_xxx').region('us-east').build()
);
```

### Direct Endpoint (Advanced)

```typescript
const client = await SlipstreamClient.connect(
  configBuilder()
    .apiKey('sk_live_xxx')
    .endpoint('http://worker-ip:9000')
    .build()
);
```

### Connection Info

```typescript
const info = client.connectionInfo();
console.log(`Session: ${info.sessionId}`);
console.log(`Protocol: ${info.protocol}`);  // 'quic', 'ws', 'http'
console.log(`Region: ${info.region}`);
console.log(`Rate limit: ${info.rateLimit.rps} rps (burst: ${info.rateLimit.burst})`);
```

---

## Transaction Submission

### Basic Submit

```typescript
const result = await client.submitTransaction(signedTxBytes);
console.log(`TX ID: ${result.transactionId}`);
console.log(`Status: ${result.status}`);
if (result.signature) {
  console.log(`Signature: ${result.signature}`);
}
```

### Submit with Options

```typescript
import { SubmitOptions } from '@allenhark/slipstream';

const result = await client.submitTransactionWithOptions(signedTxBytes, {
  broadcastMode: true,          // Fan-out to multiple regions
  preferredSender: 'nozomi',    // Prefer a specific sender
  maxRetries: 5,                // Override default retry count
  timeoutMs: 10000,             // Custom timeout
  dedupId: 'my-unique-id',     // Custom deduplication ID
});
```

#### SubmitOptions Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `broadcastMode` | `boolean` | `false` | Fan-out to multiple regions simultaneously |
| `preferredSender` | `string` | none | Prefer a specific sender (e.g., `'nozomi'`, `'0slot'`) |
| `maxRetries` | `number` | `2` | Retry attempts on failure |
| `timeoutMs` | `number` | `30000` | Timeout per attempt in milliseconds |
| `dedupId` | `string` | none | Custom deduplication ID (prevents double-submit) |

### TransactionResult Fields

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Internal request ID |
| `transactionId` | `string` | Slipstream transaction ID |
| `signature` | `string?` | Solana transaction signature (base58, when confirmed) |
| `status` | `TransactionStatus` | Current status (see table below) |
| `slot` | `number?` | Solana slot (when confirmed) |
| `timestamp` | `number` | Unix timestamp in milliseconds |
| `routing` | `RoutingInfo?` | Routing details (region, sender, latencies) |
| `error` | `TransactionError?` | Error details (on failure) |

### TransactionStatus Values

| Status | Description |
|--------|-------------|
| `'pending'` | Received, not yet processed |
| `'processing'` | Being validated and routed |
| `'sent'` | Forwarded to sender |
| `'confirmed'` | Confirmed on Solana |
| `'failed'` | Failed permanently |
| `'duplicate'` | Deduplicated (already submitted) |
| `'rate_limited'` | Rate limit exceeded for your tier |
| `'insufficient_tokens'` | Token balance too low (or free tier daily limit reached) |

### RoutingInfo Fields

| Field | Type | Description |
|-------|------|-------------|
| `region` | `string` | Region that handled the transaction |
| `sender` | `string` | Sender service used |
| `routingLatencyMs` | `number` | Time spent in routing logic (ms) |
| `senderLatencyMs` | `number` | Time spent in sender submission (ms) |
| `totalLatencyMs` | `number` | Total end-to-end latency (ms) |

---

## Streaming

Real-time data feeds over QUIC (binary on server) or WebSocket (browser). Subscribe with `on()`, unsubscribe with `off()`.

**Billing:** Each stream subscription costs **1 token (0.00005 SOL)**. If the SDK reconnects within 1 hour for the same stream, no re-billing occurs (reconnect grace period). Free-tier keys deduct from the daily counter instead of tokens.

### Leader Hints

Which region is closest to the current Solana leader. Emitted every 250ms when confidence >= threshold.

```typescript
client.on('leaderHint', (hint) => {
  console.log(`Slot ${hint.slot}: best region = ${hint.preferredRegion}`);
  console.log(`  Leader: ${hint.leaderPubkey}`);
  console.log(`  Confidence: ${hint.confidence}%`);
  console.log(`  TPU RTT: ${hint.metadata.tpuRttMs}ms`);
  console.log(`  Backups: ${hint.backupRegions.join(', ')}`);
});

await client.subscribeLeaderHints();
```

#### LeaderHint Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `number` | Unix millis |
| `slot` | `number` | Current slot |
| `expiresAtSlot` | `number` | Slot when this hint expires |
| `preferredRegion` | `string` | Best region for current leader |
| `backupRegions` | `string[]` | Fallback regions in priority order |
| `confidence` | `number` | Confidence score (0-100) |
| `leaderPubkey` | `string` | Current leader validator pubkey |
| `metadata.tpuRttMs` | `number` | RTT to leader's TPU from preferred region (ms) |
| `metadata.regionScore` | `number` | Region quality score |
| `metadata.leaderTpuAddress` | `string?` | Leader's TPU address (ip:port) |
| `metadata.regionRttMs` | `Record<string, number>?` | Per-region RTT to leader |

### Tip Instructions

Wallet address and tip amount for building transactions in streaming tip mode.

```typescript
client.on('tipInstruction', (tip) => {
  console.log(`Sender: ${tip.senderName} (${tip.sender})`);
  console.log(`  Wallet: ${tip.tipWalletAddress}`);
  console.log(`  Amount: ${tip.tipAmountSol} SOL (tier: ${tip.tipTier})`);
  console.log(`  Latency: ${tip.expectedLatencyMs}ms, Confidence: ${tip.confidence}%`);
  for (const alt of tip.alternativeSenders) {
    console.log(`  Alt: ${alt.sender} @ ${alt.tipAmountSol} SOL`);
  }
});

await client.subscribeTipInstructions();

// Latest cached tip (no subscription required)
const latestTip = client.getLatestTip();
```

#### TipInstruction Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `number` | Unix millis |
| `sender` | `string` | Sender ID |
| `senderName` | `string` | Human-readable sender name |
| `tipWalletAddress` | `string` | Tip wallet address (base58) |
| `tipAmountSol` | `number` | Required tip amount in SOL |
| `tipTier` | `string` | Tip tier name |
| `expectedLatencyMs` | `number` | Expected submission latency (ms) |
| `confidence` | `number` | Confidence score (0-100) |
| `validUntilSlot` | `number` | Slot until which this tip is valid |
| `alternativeSenders` | `AlternativeSender[]` | Alternative sender options (`{ sender, tipAmountSol, confidence }`) |

### Priority Fees

Network-condition-based fee recommendations, updated every second.

```typescript
client.on('priorityFee', (fee) => {
  console.log(`Speed: ${fee.speed}`);
  console.log(`  CU price: ${fee.computeUnitPrice} micro-lamports`);
  console.log(`  CU limit: ${fee.computeUnitLimit}`);
  console.log(`  Est cost: ${fee.estimatedCostSol} SOL`);
  console.log(`  Landing probability: ${fee.landingProbability}%`);
  console.log(`  Congestion: ${fee.networkCongestion}`);
  console.log(`  Recent success rate: ${(fee.recentSuccessRate * 100).toFixed(1)}%`);
});

await client.subscribePriorityFees();
```

#### PriorityFee Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `number` | Unix millis |
| `speed` | `string` | Fee speed tier (`'slow'`, `'fast'`, `'ultra_fast'`) |
| `computeUnitPrice` | `number` | Compute unit price in micro-lamports |
| `computeUnitLimit` | `number` | Recommended compute unit limit |
| `estimatedCostSol` | `number` | Estimated total priority fee in SOL |
| `landingProbability` | `number` | Estimated landing probability (0-100) |
| `networkCongestion` | `string` | Network congestion level (`'low'`, `'medium'`, `'high'`) |
| `recentSuccessRate` | `number` | Recent success rate (0.0-1.0) |

### Latest Blockhash

Streams the latest blockhash every 2 seconds. Build transactions without a separate RPC call.

```typescript
client.on('latestBlockhash', (data) => {
  console.log(`Blockhash: ${data.blockhash}`);
  console.log(`  Valid until block height: ${data.lastValidBlockHeight}`);
});

await client.subscribeLatestBlockhash();
```

#### LatestBlockhash Fields

| Field | Type | Description |
|-------|------|-------------|
| `blockhash` | `string` | Latest blockhash (base58) |
| `lastValidBlockHeight` | `number` | Last valid block height for this blockhash |
| `timestamp` | `number` | Unix millis when fetched |

### Latest Slot

Streams the current confirmed slot on every slot change (~400ms).

```typescript
client.on('latestSlot', (data) => {
  console.log(`Current slot: ${data.slot}`);
});

await client.subscribeLatestSlot();
```

#### LatestSlot Fields

| Field | Type | Description |
|-------|------|-------------|
| `slot` | `number` | Current confirmed slot number |
| `timestamp` | `number` | Unix millis |

### Transaction Updates

Real-time status updates for submitted transactions.

```typescript
client.on('transactionUpdate', (update) => {
  console.log(`TX ${update.transactionId}: ${update.status}`);
  if (update.routing) {
    console.log(`  Routed via ${update.routing.region} -> ${update.routing.sender}`);
  }
});
```

### Auto-Subscribe on Connect

Enable streams at configuration time so they activate immediately:

```typescript
const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .leaderHints(true)                  // default: true
  .streamTipInstructions(true)        // default: false
  .streamPriorityFees(true)           // default: false
  .streamLatestBlockhash(true)        // default: false
  .streamLatestSlot(true)             // default: false
  .build();

const client = await SlipstreamClient.connect(config);
// All 5 streams are active immediately -- just register listeners
client.on('leaderHint', onHint);
client.on('tipInstruction', onTip);
client.on('priorityFee', onFee);
client.on('latestBlockhash', onBlockhash);
client.on('latestSlot', onSlot);
```

### All Events

| Event | Payload | Description |
|-------|---------|-------------|
| `leaderHint` | `LeaderHint` | Region recommendation update (every 250ms) |
| `tipInstruction` | `TipInstruction` | Tip wallet/amount update |
| `priorityFee` | `PriorityFee` | Priority fee recommendation (every 1s) |
| `latestBlockhash` | `LatestBlockhash` | Latest blockhash (every 2s) |
| `latestSlot` | `LatestSlot` | Current confirmed slot (~400ms) |
| `transactionUpdate` | `TransactionResult` | Transaction status change |
| `connected` | -- | Transport connected |
| `disconnected` | -- | Transport disconnected |
| `ping` | `PingResult` | Keep-alive ping result (RTT, clock offset) |
| `error` | `Error` | Transport error |

---

## Keep-Alive & Time Sync

Background keep-alive mechanism providing latency measurement and NTP-style clock synchronization.

```typescript
// Enabled by default (5s interval)
const config = configBuilder()
  .apiKey('sk_live_your_key_here')
  .keepAlive(true)                // default: true
  .keepAliveInterval(5000)        // default: 5000ms
  .build();

const client = await SlipstreamClient.connect(config);

// Manual ping
const ping = await client.ping();
console.log(`RTT: ${ping.rttMs}ms, Clock offset: ${ping.clockOffsetMs}ms`);

// Derived measurements (median from sliding window of 10 samples)
const latency = client.latencyMs();     // number | null (RTT / 2)
const offset = client.clockOffsetMs();  // number | null
const serverNow = client.serverTime();  // number (unix ms, local time + offset)

// Listen for ping events
client.on('ping', (result) => {
  console.log(`Ping #${result.seq}: RTT ${result.rttMs}ms, offset ${result.clockOffsetMs}ms`);
});
```

#### PingResult Fields

| Field | Type | Description |
|-------|------|-------------|
| `seq` | `number` | Sequence number |
| `rttMs` | `number` | Round-trip time in milliseconds |
| `clockOffsetMs` | `number` | Clock offset: `serverTime - (clientSendTime + rtt/2)` (can be negative) |
| `serverTime` | `number` | Server timestamp at time of pong (unix millis) |

---

## Token Billing

Token-based billing system. Paid tiers (Standard/Pro/Enterprise) deduct tokens per transaction and stream subscription. Free tier uses a daily counter.

### Billing Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| Transaction submission | 1 token (0.00005 SOL) | Per transaction sent to Solana |
| Stream subscription | 1 token (0.00005 SOL) | Per stream type; 1-hour reconnect grace period |
| Webhook delivery | 0.00001 SOL (10,000 lamports) | Per successful POST delivery; retries not charged |
| Keep-alive ping | Free | Background ping/pong not billed |
| Discovery | Free | `GET /v1/discovery` has no auth or billing |
| Balance/billing queries | Free | `getBalance()`, `getUsageHistory()`, etc. |
| Webhook management | Free | `registerWebhook()`, `getWebhook()`, `deleteWebhook()` not billed |
| Free tier daily limit | 100 operations/day | Transactions + stream subs + webhook deliveries all count |

### Token Economics

| Unit | Value |
|------|-------|
| 1 token | 0.00005 SOL = 50,000 lamports |
| Initial balance | 200 tokens (0.01 SOL) per new API key |
| Minimum deposit | 2,000 tokens (0.1 SOL / ~$10 USD) |
| Grace period | -20 tokens (-0.001 SOL) before hard block |

### Check Balance

```typescript
const balance = await client.getBalance();
console.log(`SOL:    ${balance.balanceSol}`);
console.log(`Tokens: ${balance.balanceTokens}`);
console.log(`Lamports: ${balance.balanceLamports}`);
console.log(`Grace remaining: ${balance.graceRemainingTokens} tokens`);
```

#### Balance Fields

| Field | Type | Description |
|-------|------|-------------|
| `balanceSol` | `number` | Balance in SOL |
| `balanceTokens` | `number` | Balance in tokens (1 token = 1 query) |
| `balanceLamports` | `number` | Balance in lamports |
| `graceRemainingTokens` | `number` | Grace tokens remaining before hard block |

### Get Deposit Address

```typescript
const deposit = await client.getDepositAddress();
console.log(`Send SOL to: ${deposit.depositWallet}`);
console.log(`Minimum: ${deposit.minAmountSol} SOL`);
```

### Minimum Deposit

Deposits must reach **$10 USD equivalent** in SOL before tokens are credited. Deposits below this threshold accumulate as pending.

```typescript
const minUsd = SlipstreamClient.getMinimumDepositUsd(); // 10.0

const pending = await client.getPendingDeposit();
if (pending.pendingCount > 0) {
  console.log(`${pending.pendingSol} SOL pending (${pending.pendingCount} deposits)`);
}
```

### Usage History

```typescript
const usage = await client.getUsageHistory({ limit: 50, offset: 0 });
for (const entry of usage) {
  console.log(`${entry.txType}: ${entry.amountLamports} lamports (balance: ${entry.balanceAfterLamports})`);
}
```

### Deposit History

```typescript
const deposits = await client.getDepositHistory({ limit: 20 });
for (const d of deposits) {
  console.log(`${d.amountSol} SOL | $${d.usdValue ?? 0} USD | ${d.credited ? 'CREDITED' : 'PENDING'}`);
}
```

### Free Tier Usage

For free-tier API keys, check the daily usage counter:

```typescript
const usage = await client.getFreeTierUsage();
console.log(`Used: ${usage.used}/${usage.limit}`);       // e.g. 42/100
console.log(`Remaining: ${usage.remaining}`);              // e.g. 58
console.log(`Resets at: ${usage.resetsAt}`);               // UTC midnight ISO string
```

#### FreeTierUsage Fields

| Field | Type | Description |
|-------|------|-------------|
| `used` | `number` | Transactions used today |
| `remaining` | `number` | Remaining transactions today |
| `limit` | `number` | Daily transaction limit (100) |
| `resetsAt` | `string` | UTC midnight reset time (RFC 3339) |

---

## Webhooks

Server-side HTTP notifications for transaction lifecycle events and billing alerts. One webhook per API key.

### Setup

Register a webhook via config (auto-registers on connect) or manually:

```typescript
// Option 1: Via config (auto-registers on connect)
const client = await SlipstreamClient.connect(
  configBuilder()
    .apiKey('sk_live_12345678')
    .webhookUrl('https://your-server.com/webhooks/slipstream')
    .webhookEvents(['transaction.confirmed', 'transaction.failed', 'billing.low_balance'])
    .webhookNotificationLevel('final')
    .build()
);

// Option 2: Manual registration
const webhook = await client.registerWebhook(
  'https://your-server.com/webhooks/slipstream',
  ['transaction.confirmed', 'billing.low_balance'],  // events (optional)
  'final'                                             // level (optional)
);

console.log(`Webhook ID: ${webhook.id}`);
console.log(`Secret: ${webhook.secret}`);  // Save this -- shown only once
```

### Manage Webhooks

```typescript
// Get current webhook config
const webhook = await client.getWebhook();
if (webhook) {
  console.log(`URL: ${webhook.url}`);
  console.log(`Events: ${webhook.events.join(', ')}`);
  console.log(`Active: ${webhook.isActive}`);
}

// Remove webhook
await client.deleteWebhook();
```

### Event Types

| Event | Description | Payload |
|-------|-------------|---------|
| `transaction.sent` | TX accepted and sent to Solana | `signature`, `region`, `sender`, `latencyMs` |
| `transaction.confirmed` | TX confirmed on-chain | `signature`, `confirmedSlot`, `confirmationTimeMs`, full `getTransaction` response |
| `transaction.failed` | TX timed out or errored | `signature`, `error`, `elapsedMs` |
| `billing.low_balance` | Balance below threshold | `balanceTokens`, `thresholdTokens` |
| `billing.depleted` | Balance at zero / grace period | `balanceTokens`, `graceRemainingTokens` |
| `billing.deposit_received` | SOL deposit credited | `amountSol`, `tokensCredited`, `newBalanceTokens` |

### Notification Levels (transaction events only)

| Level | Events delivered |
|-------|-----------------|
| `'all'` | `transaction.sent` + `transaction.confirmed` + `transaction.failed` |
| `'final'` | `transaction.confirmed` + `transaction.failed` (terminal states only) |
| `'confirmed'` | `transaction.confirmed` only |

Billing events are always delivered when subscribed (no level filtering).

### Webhook Payload

Each POST includes these headers:
- `X-Slipstream-Signature: sha256=<hex>` -- HMAC-SHA256 of body using webhook secret
- `X-Slipstream-Timestamp: <unix_seconds>` -- for replay protection
- `X-Slipstream-Event: <event_type>` -- event name
- `Content-Type: application/json`

```json
{
  "id": "evt_01H...",
  "type": "transaction.confirmed",
  "created_at": 1707000000,
  "api_key_prefix": "sk_live_",
  "data": {
    "signature": "5K8c...",
    "transaction_id": "uuid",
    "confirmed_slot": 245678902,
    "confirmation_time_ms": 450,
    "transaction": { "...full Solana getTransaction response..." }
  }
}
```

### Verifying Webhook Signatures (Node.js)

```typescript
import crypto from 'crypto';

function verifyWebhook(body: string, signatureHeader: string, secret: string): boolean {
  const expected = signatureHeader.replace('sha256=', '');
  const computed = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expected));
}

// Express example
app.post('/webhooks/slipstream', (req, res) => {
  const signature = req.headers['x-slipstream-signature'] as string;
  const timestamp = req.headers['x-slipstream-timestamp'] as string;

  // Reject if timestamp is too old (>5 min)
  if (Date.now() / 1000 - parseInt(timestamp) > 300) {
    return res.status(400).send('Timestamp too old');
  }

  if (!verifyWebhook(JSON.stringify(req.body), signature, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  switch (event.type) {
    case 'transaction.confirmed':
      console.log(`TX ${event.data.signature} confirmed at slot ${event.data.confirmed_slot}`);
      break;
    case 'billing.low_balance':
      console.log(`Low balance: ${event.data.balance_tokens} tokens`);
      break;
  }

  res.status(200).send('OK');
});
```

### Billing

Each successful webhook delivery costs **0.00001 SOL (10,000 lamports)**. Failed deliveries (non-2xx or timeout) are not charged. Free tier deliveries count against the daily limit.

### Retry Policy

- Max 3 attempts: immediate, then 30s, then 5 minutes
- Webhook auto-disabled after 10 consecutive failed deliveries

#### WebhookConfig Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Webhook ID |
| `url` | `string` | Delivery URL |
| `secret` | `string?` | HMAC signing secret (only shown on registration) |
| `events` | `string[]` | Subscribed event types |
| `notificationLevel` | `string` | Transaction notification level |
| `isActive` | `boolean` | Whether webhook is active |
| `createdAt` | `string` | Creation timestamp (ISO 8601) |

---

## Multi-Region Routing

`MultiRegionClient` connects to workers across multiple regions and automatically routes transactions to the region closest to the current Solana leader.

### Auto-Discovery

```typescript
import { MultiRegionClient, configBuilder } from '@allenhark/slipstream';

const multi = await MultiRegionClient.connect(
  configBuilder().apiKey('sk_live_your_key_here').build()
);

// Transactions auto-route to the best region
const result = await multi.submitTransaction(signedTxBytes);

console.log(`Connected regions: ${multi.connectedRegions().join(', ')}`);

// Listen for routing changes
multi.on('routingUpdate', (routing) => {
  console.log(`Now routing to ${routing.bestRegion} (confidence: ${routing.confidence}%)`);
  console.log(`Leader: ${routing.leaderPubkey}`);
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

#### MultiRegionConfig Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoFollowLeader` | `boolean` | `true` | Auto-switch region based on leader hints |
| `minSwitchConfidence` | `number` | `60` | Minimum confidence (0-100) to trigger region switch |
| `switchCooldownMs` | `number` | `5000` | Cooldown between region switches (ms) |
| `broadcastHighPriority` | `boolean` | `false` | Broadcast high-priority transactions to all regions |
| `maxBroadcastRegions` | `number` | `3` | Maximum regions for broadcast mode |

### Routing Recommendation

Ask the server for the current best region:

```typescript
const rec = await client.getRoutingRecommendation();
console.log(`Best: ${rec.bestRegion} (${rec.confidence}%)`);
console.log(`Leader: ${rec.leaderPubkey}`);
console.log(`Fallbacks: ${rec.fallbackRegions.join(', ')} (${rec.fallbackStrategy})`);
console.log(`Valid for: ${rec.validForMs}ms`);
```

#### RoutingRecommendation Fields

| Field | Type | Description |
|-------|------|-------------|
| `bestRegion` | `string` | Recommended region |
| `leaderPubkey` | `string` | Current leader validator pubkey |
| `slot` | `number` | Current slot |
| `confidence` | `number` | Confidence score (0-100) |
| `expectedRttMs` | `number?` | Expected RTT to leader from best region (ms) |
| `fallbackRegions` | `string[]` | Fallback regions in priority order |
| `fallbackStrategy` | `FallbackStrategy` | `'sequential'`, `'broadcast'`, `'retry'`, or `'none'` |
| `validForMs` | `number` | Time until this recommendation expires (ms) |

---

## Deduplication

Prevent duplicate submissions with `dedupId`:

```typescript
const result = await client.submitTransactionWithOptions(txBytes, {
  dedupId: 'unique-tx-id-12345',
  maxRetries: 5,
});

// Same dedupId across retries = safe from double-spend
```

---

## Connection Status & Metrics

```typescript
// Connection status
const status = client.connectionStatus();
console.log(`State: ${status.state}`);       // 'connected', 'disconnected', etc.
console.log(`Protocol: ${status.protocol}`); // 'quic', 'ws', 'http'
console.log(`Region: ${status.region}`);
console.log(`Latency: ${status.latencyMs}ms`);

// Connection events
client.on('connected', () => console.log('Connected'));
client.on('disconnected', () => console.log('Disconnected'));
client.on('error', (err) => console.error('Error:', err));

// Performance metrics
const metrics = client.metrics();
console.log(`Submitted: ${metrics.transactionsSubmitted}`);
console.log(`Confirmed: ${metrics.transactionsConfirmed}`);
console.log(`Avg latency: ${metrics.averageLatencyMs.toFixed(1)}ms`);
console.log(`Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
```

---

## Error Handling

```typescript
import { SlipstreamError } from '@allenhark/slipstream';

try {
  const result = await client.submitTransaction(txBytes);
} catch (err) {
  if (err instanceof SlipstreamError) {
    switch (err.code) {
      case 'INSUFFICIENT_TOKENS':
        const balance = await client.getBalance();
        const deposit = await client.getDepositAddress();
        console.log(`Low balance: ${balance.balanceTokens} tokens`);
        console.log(`Deposit to: ${deposit.depositWallet}`);
        break;
      case 'RATE_LIMITED':
        console.log('Slow down -- rate limited for your tier');
        break;
      case 'TIMEOUT':
        console.log('Request timed out');
        break;
      case 'CONNECTION':
        console.log('Connection error:', err.message);
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
| `RATE_LIMITED` | Rate limit exceeded for your tier |
| `NOT_CONNECTED` | Client not connected |
| `STREAM_CLOSED` | Stream closed unexpectedly |
| `INSUFFICIENT_TOKENS` | Token balance too low (or free tier daily limit reached) |
| `ALL_PROTOCOLS_FAILED` | All connection protocols failed |
| `INTERNAL` | Internal SDK error |

---

## Examples

| Example | Description |
|---------|-------------|
| [`basic.ts`](./examples/basic.ts) | Connect and submit a transaction |
| [`streaming.ts`](./examples/streaming.ts) | Leader hints, tips, priority fees, blockhash, slot streams |
| [`billing.ts`](./examples/billing.ts) | Balance, deposits, and usage history |
| [`multi-region.ts`](./examples/multi-region.ts) | Auto-routing with MultiRegionClient |
| [`advanced-config.ts`](./examples/advanced-config.ts) | All ConfigBuilder options |
| [`submit-transaction.ts`](./examples/submit-transaction.ts) | Transaction submission with options |
| [`priority-fees.ts`](./examples/priority-fees.ts) | Priority fee configuration and streaming |
| [`deduplication.ts`](./examples/deduplication.ts) | Deduplication patterns |

## License

Apache-2.0
