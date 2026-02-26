# udp-bridge

Receives ToF UDP packets and broadcasts valid packets to WebSocket clients.

## Run

```bash
npm install
npm run start
```

## Run (Mock)

```bash
npm run mock
```

## Environment Variables

- `UDP_PORT` (default: `5005`)
- `WS_PORT` (default: `9090`)
- `LOG_FIRST_PACKET` (default: `1`, set `0` to disable first-packet parse log)

## Behavior

- UDP packet size filter (`141` bytes only)
- Broadcast UDP payload to all connected WS clients as binary
- Connection count logs on connect/disconnect
- Mock mode (`--mock`) broadcasts generated 141-byte packets at ~30fps without UDP input
