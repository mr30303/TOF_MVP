"use client";

import { useMemo, useState } from "react";
import type { ConnectionState } from "./useToFStream";
import { isValidCell, msToHMS, type ParsedPacket } from "./utils";

type ToFDashboardProps = {
  connectionState: ConnectionState;
  lastReceivedAt: number | null;
  now: number;
  parsed: ParsedPacket | null;
  littleEndian: boolean;
  invalidPacketCount: number;
  depthScale: number;
  xyScale: number;
  useBitmask: boolean;
  reverseBitOrder: boolean;
  onLittleEndianChange: (value: boolean) => void;
  onDepthScaleChange: (value: number) => void;
  onXyScaleChange: (value: number) => void;
  onUseBitmaskChange: (value: boolean) => void;
  onReverseBitOrderChange: (value: boolean) => void;
};

const DEFAULT_STATUS_MAPPING: Record<number, string> = {
  0: "\ub300\uae30",
  1: "\uac10\uc9c0",
  2: "\uc774\ub3d9",
  3: "\uc815\uc9c0",
};
const INT16_MAX = 32767;

type SensorCell = {
  index: number;
  value: number;
  valid: boolean;
};

function formatConnectionState(connectionState: ConnectionState): string {
  switch (connectionState) {
    case "connecting":
      return "\uc5f0\uacb0 \uc911";
    case "connected":
      return "\uc5f0\uacb0\ub428";
    case "reconnecting":
      return "\uc7ac\uc5f0\uacb0 \uc911";
    default:
      return "\uc5f0\uacb0 \ub04a\uae40";
  }
}

function formatSince(lastReceivedAt: number | null, now: number): string {
  if (lastReceivedAt === null) {
    return "-";
  }
  const diffSeconds = Math.max(0, (now - lastReceivedAt) / 1000);
  return `${diffSeconds.toFixed(2)}\ucd08 \uc804`;
}

function countValidCells(
  packet: ParsedPacket | null,
  useBitmask: boolean,
  reverseBitOrder: boolean
): number {
  if (packet === null) {
    return 0;
  }
  if (!useBitmask) {
    return 64;
  }
  let count = 0;
  for (let index = 0; index < 64; index += 1) {
    if (isValidCell(packet.bitmask, index, reverseBitOrder)) {
      count += 1;
    }
  }
  return count;
}

function buildSensorCells(
  packet: ParsedPacket | null,
  useBitmask: boolean,
  reverseBitOrder: boolean
): SensorCell[] {
  const cells: SensorCell[] = [];

  if (packet === null) {
    for (let index = 0; index < 64; index += 1) {
      cells.push({ index, value: 0, valid: false });
    }
    return cells;
  }

  for (let index = 0; index < 64; index += 1) {
    const valid = useBitmask
      ? isValidCell(packet.bitmask, index, reverseBitOrder)
      : true;
    cells.push({
      index,
      value: packet.values[index],
      valid,
    });
  }

  return cells;
}

export function ToFDashboard({
  connectionState,
  lastReceivedAt,
  now,
  parsed,
  littleEndian,
  invalidPacketCount,
  depthScale,
  xyScale,
  useBitmask,
  reverseBitOrder,
  onLittleEndianChange,
  onDepthScaleChange,
  onXyScaleChange,
  onUseBitmaskChange,
  onReverseBitOrderChange,
}: ToFDashboardProps) {
  const [statusMapping, setStatusMapping] = useState(DEFAULT_STATUS_MAPPING);

  const statusClass = useMemo(
    () => `status status-${connectionState}`,
    [connectionState]
  );
  const connectionText = useMemo(
    () => formatConnectionState(connectionState),
    [connectionState]
  );
  const validPointCount = useMemo(
    () => countValidCells(parsed, useBitmask, reverseBitOrder),
    [parsed, useBitmask, reverseBitOrder]
  );
  const sensorCells = useMemo(
    () => buildSensorCells(parsed, useBitmask, reverseBitOrder),
    [parsed, useBitmask, reverseBitOrder]
  );

  const frameStats = useMemo(() => {
    const validValues = sensorCells.filter((cell) => cell.valid).map((cell) => cell.value);
    if (validValues.length === 0) {
      return { min: null as number | null, max: null as number | null };
    }
    return {
      min: Math.min(...validValues),
      max: Math.max(...validValues),
    };
  }, [sensorCells]);

  const statusText = useMemo(() => {
    if (parsed === null) {
      return "-";
    }
    const mapped = statusMapping[parsed.statusCode]?.trim();
    if (mapped) {
      return mapped;
    }
    return `\ubbf8\uc815\uc758(${parsed.statusCode})`;
  }, [parsed, statusMapping]);

  const updateStatusMapping = (code: number, value: string) => {
    setStatusMapping((current) => ({
      ...current,
      [code]: value,
    }));
  };

  return (
    <>
      <section className="card">
        <div className="row">
          <span className="label">{"\uc5f0\uacb0 \uc0c1\ud0dc"}</span>
          <span className={statusClass}>{connectionText}</span>
        </div>
        <div className="row">
          <span className="label">{"\uc0c1\ud0dc"}</span>
          <span className="status status-info">{statusText}</span>
        </div>
        <div className="row">
          <span className="label">{"\ub9c8\uc9c0\ub9c9 \uc218\uc2e0"}</span>
          <span className="value">{formatSince(lastReceivedAt, now)}</span>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <span className="label">{"\ud65c\ub3d9 \uc2dc\uac04"}</span>
          <span className="value value-strong">
            {parsed ? msToHMS(parsed.activityMs) : "-"}
          </span>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <span className="label">{"8x8 \uc13c\uc11c \uac12"}</span>
          <span className="value">
            {"\ud604\uc7ac \ucd5c\ub300"}: {frameStats.max ?? "-"}
          </span>
        </div>
        <div className="row">
          <span className="label">{"\ud604\uc7ac \ucd5c\uc18c"}</span>
          <span className="value">{frameStats.min ?? "-"}</span>
        </div>
        <div className="row">
          <span className="label">{"\uc774\ub860 \ucd5c\ub300(int16)"}</span>
          <span className="value">{INT16_MAX}</span>
        </div>
        <div className="sensor-grid">
          {sensorCells.map((cell) => (
            <div
              key={cell.index}
              className={`sensor-cell ${cell.valid ? "" : "sensor-cell-invalid"}`}
              title={`idx ${cell.index}`}
            >
              {cell.valid ? cell.value : "-"}
            </div>
          ))}
        </div>
      </section>

      <details className="card collapsible-card">
        <summary className="summary-toggle">
          {"\uc0c1\uc138 \uc815\ubcf4 \ubc0f \uc124\uc815"}
        </summary>
        <div className="collapsible-body">
          <section className="subpanel">
            <div className="row">
              <span className="label">{"\uc720\ud6a8 \ud3ec\uc778\ud2b8"}</span>
              <span className="value">{validPointCount}</span>
            </div>
            <div className="row">
              <span className="label">{"\uc5d4\ub514\uc548 \ubaa8\ub4dc"}</span>
              <span className="value">
                {littleEndian ? "\ub9ac\ud2c0" : "\ube45"}
              </span>
            </div>
            <div className="row">
              <span className="label">{"\uc0c1\ud0dc \ucf54\ub4dc"}</span>
              <span className="value">{parsed ? parsed.statusCode : "-"}</span>
            </div>
            <div className="row">
              <span className="label">{"\ube44\ud2b8\ub9c8\uc2a4\ud06c \uc0ac\uc6a9"}</span>
              <span className="value">
                {useBitmask ? "\ucf1c\uc9d0" : "\uaebc\uc9d0"}
              </span>
            </div>
            <div className="row">
              <span className="label">{"\ube44\ud2b8 \uc21c\uc11c \ubc18\uc804"}</span>
              <span className="value">
                {reverseBitOrder ? "\ucf1c\uc9d0" : "\uaebc\uc9d0"}
              </span>
            </div>
            <div className="row">
              <span className="label">{"\ubb34\ud6a8 \ud328\ud0b7 \uc218"}</span>
              <span className="value">{invalidPacketCount}</span>
            </div>
          </section>

          <section className="subpanel controls">
            <span className="label">{"\uc5d4\ub514\uc548"}</span>
            <div className="toggle-group">
              <button
                className={`button button-toggle ${
                  littleEndian ? "button-toggle-active" : ""
                }`}
                type="button"
                onClick={() => onLittleEndianChange(true)}
              >
                {"\ub9ac\ud2c0 \uc5d4\ub514\uc548"}
              </button>
              <button
                className={`button button-toggle ${
                  littleEndian ? "" : "button-toggle-active"
                }`}
                type="button"
                onClick={() => onLittleEndianChange(false)}
              >
                {"\ube45 \uc5d4\ub514\uc548"}
              </button>
            </div>
          </section>

          <section className="subpanel controls">
            <span className="label">
              {"\uc0c1\ud0dc \ucf54\ub4dc \ub9e4\ud551 (\uc218\uc815 \uac00\ub2a5)"}
            </span>
            <div className="mapping-grid">
              {[0, 1, 2, 3].map((code) => (
                <label
                  key={code}
                  className="mapping-row"
                  htmlFor={`status-map-${code}`}
                >
                  <span className="value">
                    {"\ucf54\ub4dc"} {code}
                  </span>
                  <input
                    id={`status-map-${code}`}
                    className="input"
                    value={statusMapping[code] ?? ""}
                    onChange={(event) => updateStatusMapping(code, event.target.value)}
                    placeholder={`\ucf54\ub4dc ${code} \uc0c1\ud0dc\uba85`}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="subpanel controls">
            <span className="label">{"\ubdf0\uc5b4 \uc635\uc158"}</span>
            <label className="option-row" htmlFor="depth-scale-range">
              <span>
                {"\uae4a\uc774 \ubc30\uc728"} ({depthScale.toFixed(4)})
              </span>
              <input
                id="depth-scale-range"
                className="range-input"
                type="range"
                min="0.0001"
                max="0.0100"
                step="0.0001"
                value={depthScale}
                onChange={(event) => onDepthScaleChange(Number(event.target.value))}
              />
            </label>

            <label className="option-row" htmlFor="xy-scale-range">
              <span>
                XY {"\ubc30\uc728"} ({xyScale.toFixed(3)})
              </span>
              <input
                id="xy-scale-range"
                className="range-input"
                type="range"
                min="0.010"
                max="0.200"
                step="0.001"
                value={xyScale}
                onChange={(event) => onXyScaleChange(Number(event.target.value))}
              />
            </label>

            <label className="check-row" htmlFor="use-bitmask">
              <input
                id="use-bitmask"
                type="checkbox"
                checked={useBitmask}
                onChange={(event) => onUseBitmaskChange(event.target.checked)}
              />
              <span>{"\ube44\ud2b8\ub9c8\uc2a4\ud06c \uc0ac\uc6a9"}</span>
            </label>

            <label className="check-row" htmlFor="reverse-bit-order">
              <input
                id="reverse-bit-order"
                type="checkbox"
                checked={reverseBitOrder}
                onChange={(event) => onReverseBitOrderChange(event.target.checked)}
              />
              <span>{"\ube44\ud2b8 \uc21c\uc11c \ubc18\uc804 (\uc635\uc158)"}</span>
            </label>
          </section>
        </div>
      </details>
    </>
  );
}
