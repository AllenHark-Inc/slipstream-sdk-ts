# @allenhark/slipstream

TypeScript/JavaScript SDK for Slipstream - Solana transaction relay. 

## Installation

```bash
npm install @allenhark/slipstream
```

## Quick Start

```typescript
import { SlipstreamClient } from '@allenhark/slipstream';

const client = new SlipstreamClient({
  apiKey: 'sk_live_...',
  region: 'us-west',
});

await client.connect();

// Subscribe to tips
client.on('tip', (tip) => {
  console.log(`Tip: ${tip.amount} SOL to ${tip.wallet}`);
});

// Submit transaction
const result = await client.submitTransaction(tx);
```

## Features

- **Browser + Node.js** - Works everywhere
- **WebSocket/QUIC Fallback** - Automatic protocol selection
- **Event-Driven** - Subscribe to streams
- **TypeScript** - Full type safety

## Documentation

