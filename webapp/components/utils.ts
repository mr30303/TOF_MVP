const PACKET_SIZE = 141;
const VALUE_COUNT = 64;

export type ParsedPacket = {
  bitmask: bigint;
  values: Int16Array;
  statusCode: number;
  activityMs: number;
};

export function parsePacket(
  buf: ArrayBuffer,
  littleEndian: boolean
): ParsedPacket {
  if (buf.byteLength !== PACKET_SIZE) {
    throw new RangeError(
      `Invalid packet length: ${buf.byteLength}. Expected ${PACKET_SIZE} bytes.`
    );
  }

  const view = new DataView(buf);
  const values = new Int16Array(VALUE_COUNT);

  for (let index = 0; index < VALUE_COUNT; index += 1) {
    values[index] = view.getInt16(8 + index * 2, littleEndian);
  }

  return {
    bitmask: view.getBigUint64(0, littleEndian),
    values,
    statusCode: view.getUint8(136),
    activityMs: view.getUint32(137, littleEndian),
  };
}

export function isValidCell(
  bitmask: bigint,
  idx: number,
  reverseBitOrder = false
): boolean {
  if (idx < 0 || idx >= VALUE_COUNT) {
    return false;
  }
  const bitIndex = reverseBitOrder ? VALUE_COUNT - 1 - idx : idx;
  return ((bitmask >> BigInt(bitIndex)) & 1n) === 1n;
}

export function buildPointPositions(
  bitmask: bigint,
  values: Int16Array,
  depthScale: number,
  xyScale: number,
  useBitmask = true,
  reverseBitOrder = false
): Float32Array {
  const points: number[] = [];

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const idx = row * 8 + col;
      if (useBitmask && !isValidCell(bitmask, idx, reverseBitOrder)) {
        continue;
      }

      const x = (col - 3.5) * xyScale;
      const y = -(row - 3.5) * xyScale;
      const z = values[idx] * depthScale;
      points.push(x, y, z);
    }
  }

  return new Float32Array(points);
}

export function msToHMS(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}
