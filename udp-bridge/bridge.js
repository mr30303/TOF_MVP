import dgram from "node:dgram";
import { WebSocket, WebSocketServer } from "ws";

const PACKET_SIZE = 141;
const GRID_SIZE = 8;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const FRAME_INTERVAL_MS = 33;
const BIND_HOST = "0.0.0.0";
const UDP_PORT = Number.parseInt(process.env.UDP_PORT ?? "5005", 10);
const WS_PORT = Number.parseInt(process.env.WS_PORT ?? "9090", 10);
const LOG_FIRST_PACKET = process.env.LOG_FIRST_PACKET !== "0";

const ALL_VALID_BITMASK = (1n << 64n) - 1n;
const PERSON_SIGMA = 1.15;
const PERSON_DEPTH_DROP_MM = 1150;
const BASE_DEPTH_MM = 2350;
const MIN_DEPTH_MM = 320;
const MAX_DEPTH_MM = 4200;

const PHASE_IDLE_MS = 5500;
const PHASE_MOVE_MS = 8500;
const PHASE_PRESENT_MS = 4500;
const PHASE_STATION_MS = 5000;
const PHASE_EXIT_MS = 5500;
const CYCLE_DURATION_MS =
  PHASE_IDLE_MS +
  PHASE_MOVE_MS +
  PHASE_PRESENT_MS +
  PHASE_STATION_MS +
  PHASE_EXIT_MS;

const EDGE_DROP_SEQUENCE = [
  0, 1, 2, 3, 4, 5, 6, 7,
  15, 23, 31, 39, 47, 55, 63,
  62, 61, 60, 59, 58, 57, 56,
  48, 40, 32, 24, 16, 8,
];

const args = new Set(process.argv.slice(2));
const isMockMode = args.has("--mock");

const wss = new WebSocketServer({ host: BIND_HOST, port: WS_PORT });

let udpServer = null;
let mockInterval = null;
let activityMs = 0;
const mockStartMs = Date.now();
let firstPacketLogged = false;

function getConnectedClientCount() {
  let count = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      count += 1;
    }
  }
  return count;
}

function broadcastPacket(packet) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(packet, { binary: true });
    }
  }
}

function countValidBits(bitmask) {
  let bits = bitmask;
  let count = 0;
  while (bits !== 0n) {
    if ((bits & 1n) === 1n) {
      count += 1;
    }
    bits >>= 1n;
  }
  return count;
}

function parsePacketSummary(buffer, littleEndian) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const bitmask = view.getBigUint64(0, littleEndian);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const first8 = [];

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = view.getInt16(8 + index * 2, littleEndian);
    if (index < 8) {
      first8.push(value);
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  const status = view.getUint8(136);
  const activityMs = view.getUint32(137, littleEndian);

  return {
    bitmask,
    validCount: countValidBits(bitmask),
    min,
    max,
    first8,
    status,
    activityMs,
  };
}

function toHexBytes(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString("hex")
    .replace(/(..)/g, "$1 ")
    .trim();
}

function logFirstPacket(message, rinfo) {
  const le = parsePacketSummary(message, true);
  const be = parsePacketSummary(message, false);

  console.log(
    `[UDP first packet] from ${rinfo.address}:${rinfo.port}, bytes=${message.length}`
  );
  console.log(`[UDP first packet] raw[0..31] = ${toHexBytes(message, 0, 32)}`);
  console.log(
    `[UDP first packet][LE] bitmask=0x${le.bitmask.toString(16).padStart(16, "0")} valid=${le.validCount} status=${le.status} activityMs=${le.activityMs} min=${le.min} max=${le.max} first8=[${le.first8.join(", ")}]`
  );
  console.log(
    `[UDP first packet][BE] bitmask=0x${be.bitmask.toString(16).padStart(16, "0")} valid=${be.validCount} status=${be.status} activityMs=${be.activityMs} min=${be.min} max=${be.max} first8=[${be.first8.join(", ")}]`
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getScenario(elapsedMs) {
  let phaseMs = elapsedMs % CYCLE_DURATION_MS;

  if (phaseMs < PHASE_IDLE_MS) {
    return {
      status: 0,
      presence: 0,
      centerRow: 3.5,
      centerCol: 3.5,
      moving: false,
    };
  }
  phaseMs -= PHASE_IDLE_MS;

  if (phaseMs < PHASE_MOVE_MS) {
    const progress = phaseMs / PHASE_MOVE_MS;
    return {
      status: 2,
      presence: 1,
      centerRow: 2.1 + 2.8 * progress + 0.35 * Math.sin(progress * Math.PI * 3.2),
      centerCol: 0.9 + 5.9 * progress,
      moving: true,
    };
  }
  phaseMs -= PHASE_MOVE_MS;

  if (phaseMs < PHASE_PRESENT_MS) {
    const wobble = phaseMs / PHASE_PRESENT_MS;
    return {
      status: 1,
      presence: 1,
      centerRow: 5.1 + 0.18 * Math.sin(wobble * Math.PI * 4),
      centerCol: 6.0 + 0.14 * Math.cos(wobble * Math.PI * 4),
      moving: false,
    };
  }
  phaseMs -= PHASE_PRESENT_MS;

  if (phaseMs < PHASE_STATION_MS) {
    return {
      status: 3,
      presence: 1,
      centerRow: 3.3,
      centerCol: 4.4,
      moving: false,
    };
  }
  phaseMs -= PHASE_STATION_MS;

  const exitProgress = phaseMs / PHASE_EXIT_MS;
  return {
    status: exitProgress < 0.9 ? 2 : 0,
    presence: clamp(1 - exitProgress, 0, 1),
    centerRow: 3.3 - 2.5 * exitProgress,
    centerCol: 4.4 - 4.2 * exitProgress,
    moving: true,
  };
}

function buildMockBitmask(elapsedMs, hasPresence) {
  if (!hasPresence) {
    return ALL_VALID_BITMASK;
  }

  const dropIndex =
    EDGE_DROP_SEQUENCE[Math.floor(elapsedMs / 600) % EDGE_DROP_SEQUENCE.length];
  return ALL_VALID_BITMASK & ~(1n << BigInt(dropIndex));
}

function buildMockPacket(nowMs) {
  const packet = Buffer.alloc(PACKET_SIZE);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

  const elapsedMs = nowMs - mockStartMs;
  const elapsedSeconds = elapsedMs / 1000;
  const scenario = getScenario(elapsedMs);
  const bitmask = buildMockBitmask(elapsedMs, scenario.presence > 0.05);

  view.setBigUint64(0, bitmask, true);

  const baseDepth = BASE_DEPTH_MM + 60 * Math.sin(elapsedSeconds * 0.35);

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const row = Math.floor(index / GRID_SIZE);
    const col = index % GRID_SIZE;

    const dx = col - scenario.centerCol;
    const dy = row - scenario.centerRow;
    const footprint = Math.exp(-(dx * dx + dy * dy) / (2 * PERSON_SIGMA * PERSON_SIGMA));

    const personEffect = scenario.presence * PERSON_DEPTH_DROP_MM * footprint;
    const breathing =
      scenario.presence > 0.05
        ? 18 * Math.sin(elapsedSeconds * 2.6 + row * 0.5 + col * 0.4)
        : 0;
    const motionRipple = scenario.moving
      ? 24 * Math.sin(elapsedSeconds * 5.4 + row * 0.9 - col * 0.6)
      : 0;
    const ambientNoise = 10 * Math.sin(elapsedSeconds * 1.8 + row * 0.7 + col * 0.3);

    const value = Math.round(
      clamp(
        baseDepth - personEffect + breathing + motionRipple + ambientNoise,
        MIN_DEPTH_MM,
        MAX_DEPTH_MM
      )
    );
    view.setInt16(8 + index * 2, value, true);
  }

  if (scenario.presence > 0.05) {
    activityMs = (activityMs + FRAME_INTERVAL_MS) >>> 0;
  } else {
    activityMs = 0;
  }

  view.setUint8(136, scenario.status);
  view.setUint32(137, activityMs, true);

  return packet;
}

function setupUdpBridge() {
  udpServer = dgram.createSocket("udp4");

  udpServer.on("listening", () => {
    const address = udpServer.address();
    if (typeof address === "string") {
      console.log(`UDP listening on ${address}`);
      return;
    }
    console.log(`UDP listening on ${address.address}:${address.port}`);
  });

  udpServer.on("message", (message, rinfo) => {
    if (message.length !== PACKET_SIZE) {
      return;
    }
    if (LOG_FIRST_PACKET && !firstPacketLogged) {
      firstPacketLogged = true;
      logFirstPacket(message, rinfo);
    }
    broadcastPacket(message);
  });

  udpServer.on("error", (error) => {
    console.error(`UDP error: ${error.message}`);
  });

  udpServer.bind(UDP_PORT, BIND_HOST);
}

function startMockLoop() {
  if (mockInterval !== null) {
    return;
  }
  mockInterval = setInterval(() => {
    const packet = buildMockPacket(Date.now());
    broadcastPacket(packet);
  }, FRAME_INTERVAL_MS);
}

wss.on("listening", () => {
  const addressInfo = wss.address();
  if (typeof addressInfo === "string") {
    console.log(`WS listening on ws://${addressInfo}`);
  } else {
    console.log(`WS listening on ws://${addressInfo.address}:${addressInfo.port}`);
  }

  if (isMockMode) {
    console.log("Mock mode enabled (home movement scenario, 30fps). UDP input is disabled.");
    startMockLoop();
  }
});

wss.on("connection", (socket) => {
  console.log(`WS clients connected: ${getConnectedClientCount()}`);

  socket.on("close", () => {
    console.log(`WS clients connected: ${getConnectedClientCount()}`);
  });

  socket.on("error", (error) => {
    console.error(`WS client error: ${error.message}`);
  });
});

wss.on("error", (error) => {
  console.error(`WS server error: ${error.message}`);
});

function shutdown() {
  if (mockInterval !== null) {
    clearInterval(mockInterval);
    mockInterval = null;
  }
  if (udpServer !== null) {
    udpServer.close();
    udpServer = null;
  }
  wss.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (isMockMode) {
  // In mock mode we only publish generated packets over WS.
} else {
  setupUdpBridge();
}
