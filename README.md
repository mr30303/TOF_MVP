# ToF Project Monorepo

## Structure

- `udp-bridge/`: UDP(141B) -> WebSocket bridge
- `webapp/`: Next.js dashboard
- `doc/`: work instructions and development checklist

## Run UDP Bridge

### Real UDP mode

```bash
cd udp-bridge
npm install
npm run start
```

Defaults:

- UDP listen: `0.0.0.0:5005`
- WS serve: `ws://0.0.0.0:9090`

Optional env:

```bash
UDP_PORT=5005 WS_PORT=9090 npm run start
```

### Mock mode (no UDP required)

```bash
cd udp-bridge
npm run mock
```

## Run WebApp

```bash
cd webapp
npm install
npm run dev
```

Open: `http://localhost:9091`

The page has a WS URL input. Default is `ws://localhost:9090`.

## Connect From Phone

1. Put phone and PC on the same Wi-Fi.
2. Find PC LAN IP (example: `192.168.0.50`).
3. Keep bridge running on PC.
4. Open the webapp from phone browser:
   `http://<PC_LAN_IP>:9091` (or through your deployed domain)
5. In WS URL input, set:
   `ws://<PC_LAN_IP>:9090`

## Troubleshooting

- Depth values look wrong:
  Toggle `Little/Big Endian` in dashboard.
- Valid cells appear shifted/mirrored:
  Toggle `reverse bit order` option.
- Too many/few points:
  Check `use bitmask` option.
- No updates:
  Confirm bridge log shows WS/UDP listening and webapp shows `connected`.
