# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Keep-alive & time sync**: Background ping loop (default 5s) measures RTT and synchronizes clocks with the server using NTP-style calculation.
- `ping()` method — send a single ping and get `PingResult { seq, rttMs, clockOffsetMs, serverTime }`.
- `latencyMs()` — median one-way latency from sliding window of 10 samples.
- `clockOffsetMs()` — median clock offset between client and server.
- `serverTime()` — current server time estimated from local clock + offset.
- `configBuilder().keepAlive(bool)` — enable/disable keep-alive (default: true).
- `configBuilder().keepAliveInterval(ms)` — ping interval in milliseconds (default: 5000).
- `'ping'` event emitted on each successful ping with `PingResult`.
- QUIC transport: binary ping/pong over bidi stream (StreamType 0x08).
- WebSocket transport: JSON-based ping/pong messages with timing.
- HTTP transport: `GET /v1/ping` endpoint for time sync.
- **Free tier usage**: `getFreeTierUsage()` method in SDK.
- **Stream billing**: All stream subscriptions billed at 1 token per connection (1-hour reconnect grace period).
- **Latest blockhash stream**: `subscribeLatestBlockhash()` — blockhash updates every 2s.
- **Latest slot stream**: `subscribeLatestSlot()` — slot updates on every slot change (~400ms).
- **Priority tiers**: `configBuilder().tier('pro')` — set billing tier (free/standard/pro/enterprise).

- Initial SDK setup.
