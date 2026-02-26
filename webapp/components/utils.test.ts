import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPointPositions,
  isValidCell,
  msToHMS,
  parsePacket,
} from "./utils";

type BuildPacketOptions = {
  littleEndian: boolean;
  bitmask: bigint;
  values: Int16Array;
  statusCode: number;
  activityMs: number;
};

function buildPacket(options: BuildPacketOptions): ArrayBuffer {
  const buffer = new ArrayBuffer(141);
  const view = new DataView(buffer);

  view.setBigUint64(0, options.bitmask, options.littleEndian);
  for (let i = 0; i < 64; i += 1) {
    view.setInt16(8 + i * 2, options.values[i], options.littleEndian);
  }
  view.setUint8(136, options.statusCode);
  view.setUint32(137, options.activityMs, options.littleEndian);

  return buffer;
}

test("parsePacket parses 141B little-endian packets", () => {
  const values = new Int16Array(64);
  values[0] = -1234;
  values[1] = 2222;
  values[63] = -32768;

  const bitmask = 1n | (1n << 63n);
  const packet = buildPacket({
    littleEndian: true,
    bitmask,
    values,
    statusCode: 2,
    activityMs: 123456,
  });

  const parsed = parsePacket(packet, true);

  assert.equal(parsed.bitmask, bitmask);
  assert.equal(parsed.values.length, 64);
  assert.equal(parsed.values[0], -1234);
  assert.equal(parsed.values[1], 2222);
  assert.equal(parsed.values[63], -32768);
  assert.equal(parsed.statusCode, 2);
  assert.equal(parsed.activityMs, 123456);
  assert.equal(isValidCell(parsed.bitmask, 0), true);
  assert.equal(isValidCell(parsed.bitmask, 63), true);
  assert.equal(isValidCell(parsed.bitmask, 1), false);
});

test("parsePacket parses same structure in big-endian mode", () => {
  const values = new Int16Array(64);
  values[0] = 1000;
  values[10] = -2000;
  values[63] = 3456;

  const bitmask = (1n << 10n) | (1n << 63n);
  const packet = buildPacket({
    littleEndian: false,
    bitmask,
    values,
    statusCode: 3,
    activityMs: 987654321,
  });

  const parsed = parsePacket(packet, false);

  assert.equal(parsed.bitmask, bitmask);
  assert.equal(parsed.values[0], 1000);
  assert.equal(parsed.values[10], -2000);
  assert.equal(parsed.values[63], 3456);
  assert.equal(parsed.statusCode, 3);
  assert.equal(parsed.activityMs, 987654321);
  assert.equal(isValidCell(parsed.bitmask, 10), true);
  assert.equal(isValidCell(parsed.bitmask, 9), false);
});

test("parsePacket throws on invalid packet length", () => {
  const invalid = new ArrayBuffer(140);
  assert.throws(
    () => parsePacket(invalid, true),
    /Invalid packet length: 140. Expected 141 bytes\./
  );
});

test("msToHMS formats milliseconds to hh:mm:ss", () => {
  assert.equal(msToHMS(0), "00:00:00");
  assert.equal(msToHMS(3661000), "01:01:01");
  assert.equal(msToHMS(86399999), "23:59:59");
});

test("buildPointPositions maps row/col to x/y/z and honors bitmask", () => {
  const values = new Int16Array(64);
  values[0] = 1000;
  values[9] = 2000;
  values[63] = 3000;

  const bitmask = (1n << 0n) | (1n << 9n) | (1n << 63n);
  const positions = buildPointPositions(bitmask, values, 0.001, 0.05, true);

  assert.equal(positions.length, 9);
  assert.deepEqual(
    Array.from(positions).map((value) => Number(value.toFixed(4))),
    [
      -0.175, 0.175, 1.0, // idx 0: row 0, col 0
      -0.125, 0.125, 2.0, // idx 9: row 1, col 1
      0.175, -0.175, 3.0, // idx 63: row 7, col 7
    ]
  );
});

test("isValidCell and buildPointPositions support reverse bit order", () => {
  const reverseMask = 1n << 63n;
  assert.equal(isValidCell(reverseMask, 0, true), true);
  assert.equal(isValidCell(reverseMask, 0, false), false);

  const values = new Int16Array(64);
  values[0] = 1111;
  const positions = buildPointPositions(reverseMask, values, 0.001, 0.05, true, true);

  assert.equal(positions.length, 3);
  assert.deepEqual(
    Array.from(positions).map((value) => Number(value.toFixed(4))),
    [-0.175, 0.175, 1.111]
  );
});
