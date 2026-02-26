# PROJECT: ToF UDP(141B) -> WS Bridge + Next.js WebApp (PWA-ish Dashboard)

## Language Rule
- 모든 안내 문구와 사용자 대상 응답은 한국어로 작성한다.

## Goal
Receive ToF simulator packets via UDP (141 bytes binary), bridge them to WebSocket as binary, and render a mobile-friendly dashboard:
1) 3D visualization of 8x8 depth map as point cloud (valid cells by bitmask)
2) STATUS display (IDLE/PRESENT/MOVING/STATION) from packet
3) ACTIVITY TIME display (ms) from packet (no calculation in webapp)

## Hard Constraints
- Browser cannot receive UDP directly. Implement UDP->WebSocket bridge in Node.
- WebApp receives WebSocket binary as ArrayBuffer and parses it.
- Packet size must be exactly 141 bytes; otherwise drop.

## Packet Layout (141 bytes)
Offsets (0-based):
- 0..7    : BITMASK (8 bytes) uint64
- 8..135  : VALUES (128 bytes) = 64 * int16 (SHORT signed)
- 136     : STATUS (1 byte) uint8
- 137..140: ACTIVITY_TIME_MS (4 bytes) uint32
Endianness: default Little Endian. Web UI must allow toggle LE/BE.

Meaning
- VALUES is 8x8 depth map: idx = row*8 + col, row/col: 0..7
- BITMASK bit i == 1 means cell i is valid and should be rendered.
- 3D mapping: x=(col-3.5)*xyScale, y=-(row-3.5)*xyScale, z=value*depthScale
- xyScale and depthScale are user-adjustable sliders in UI.

STATUS mapping (default table, editable):
0=IDLE, 1=PRESENT, 2=MOVING, 3=STATION

## Deliverables (Repository Structure)
Create a monorepo:
/
  udp-bridge/
    package.json
    bridge.js
    README.md
  webapp/
    package.json
    next.config.js (or default)
    public/manifest.json
    public/icons/icon-192.png (can be placeholder text instruction if not generating binary)
    app/page.tsx (Next.js App Router)
    app/layout.tsx
    components/
      ToFDashboard.tsx
      ToFViewer.tsx
      useToFStream.ts
      utils.ts
    README.md
  README.md (root)

## Part 1: udp-bridge (Node.js)
### Tech
- Node.js ESM
- deps: ws
- use dgram for UDP

### Config
- UDP_PORT default 5005
- WS_PORT default 8080
- accept env overrides: UDP_PORT, WS_PORT
- bind UDP on 0.0.0.0
- WebSocket server on 0.0.0.0

### Behavior
- On UDP message:
  - If msg.length !== 141: ignore
  - else broadcast the msg Buffer to all WS clients
- Log:
  - "UDP listening on <ip>:<port>"
  - "WS listening on ws://<ip>:<port>"
  - When clients connect/disconnect: print connected client count

### Mock Mode (must implement)
- CLI flag: --mock
- If --mock enabled:
  - do NOT require UDP input
  - generate fake 141B packets at 30fps and broadcast via WS
  - Fake packet rules:
    - bitmask = all 1s (64 valid) or checkerboard (toggle every 1s)
    - values[idx] = int16( 800 + 300*sin(t + idx/4) ) (any nice wave)
    - status cycles 1->2->3->0 every 2 seconds
    - activityMs increases by 33ms each frame (uint32)
  - This is for UI testing with no simulator

### udp-bridge/package.json scripts
- "start": "node bridge.js"
- "mock": "node bridge.js --mock"

## Part 2: webapp (Next.js + Three.js)
### Tech
- Next.js (App Router)
- React
- Three.js + OrbitControls (from three/examples)
- Tailwind optional; keep styling minimal but mobile-friendly
- WebSocket native API (no socket.io)

### UI Layout (mobile first)
Header:
- Connection badge: Connected/Reconnecting/Disconnected
- STATUS badge: text from mapping table, show UNKNOWN(code) if not mapped
- Last update: "x.xx s ago" based on local receipt time

Main:
- 3D viewer canvas (responsive, touch rotate/zoom/pan)

Footer cards:
- ACTIVITY TIME: show hh:mm:ss and raw ms smaller
- Debug: valid points count, endian mode

Controls:
- Toggle: Little/Big endian
- Slider: depthScale (default 0.001)
- Slider: xyScale (default 0.05)
- Optional: checkbox "use bitmask" (on by default) for debugging

### Stream Handling (Important)
- Use a hook useToFStream(url) that:
  - connects WebSocket
  - reconnects with exponential backoff
  - stores latest received ArrayBuffer (lastPacketRef)
  - tracks connectionState + lastReceivedAt
- Rendering:
  - In viewer component, use requestAnimationFrame loop
  - On each frame, if lastPacket changed, parse and update geometry
  - Drop frames (only latest) to keep UI smooth

### Parsing (must be in utils.ts)
Implement:
- parsePacket(buf: ArrayBuffer, littleEndian: boolean) => { bitmask: bigint, values: Int16Array(64), statusCode: number, activityMs: number }
- isValidCell(bitmask: bigint, idx: number) => boolean
- msToHMS(ms:number)=>string

### Three.js Viewer Rules
- Use BufferGeometry + Points
- Reuse geometry; update position attribute only
- When building positions:
  - iterate 8x8
  - if bitmask says valid, push x,y,z (float)
- Use computeBoundingSphere after update
- Avoid heavy per-frame allocations if possible:
  - ok to rebuild Float32Array when packet changes (64 points max)
- Add simple axes helper optional

### PWA-ish
- Add a basic manifest.json
- Set meta tags in layout for viewport and theme-color

### webapp scripts
- "dev": "next dev"
- "build": "next build"
- "start": "next start"

## Root README
Include:
- How to run bridge:
  - cd udp-bridge && npm i && npm run start
  - cd udp-bridge && npm run mock
- How to run webapp:
  - cd webapp && npm i && npm run dev
- How to connect from phone:
  - Ensure phone and bridge PC are on same Wi-Fi
  - Use ws://<PC_LAN_IP>:8080 in the webapp (provide a simple input box or env var NEXT_PUBLIC_WS_URL)
- Troubleshooting:
  - If values look wrong, toggle Endian
  - If valid cells look shifted, bitmask bit order may differ; adjust isValidCell mapping

## Acceptance Criteria
- With mock mode: webapp shows animated 3D point cloud, status changing, activity time increasing.
- With real UDP: bridge relays and webapp updates in real time.
- UI remains responsive on mobile.
