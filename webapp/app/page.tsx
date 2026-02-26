"use client";

import { useEffect, useMemo, useState } from "react";
import { ToFDashboard } from "../components/ToFDashboard";
import {
  DEFAULT_CEILING_HEIGHT_M,
  type RenderMode,
  type ViewMode,
  ToFViewer,
} from "../components/ToFViewer";
import { useToFStream } from "../components/useToFStream";
import { isValidCell, parsePacket } from "../components/utils";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://innert.iptime.org:28080";
const DEFAULT_DEPTH_SCALE = 0.001;
const DEFAULT_XY_SCALE = 0.05;
const MIN_DISTANCE_MM = 300;
const MAX_DISTANCE_MM = 3800;
const MM_TO_M = 0.001;
const RAY_H_FOV_DEG = 45;
const RAY_V_FOV_DEG = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildRayDirections(hFovDeg: number, vFovDeg: number): Float32Array {
  const directions = new Float32Array(64 * 3);
  const tanHalfH = Math.tan((hFovDeg * Math.PI) / 360);
  const tanHalfV = Math.tan((vFovDeg * Math.PI) / 360);
  for (let index = 0; index < 64; index += 1) {
    const row = Math.floor(index / 8);
    const col = index % 8;
    const nx = ((col + 0.5) / 8 - 0.5) * 2;
    const nz = (0.5 - (row + 0.5) / 8) * 2;
    const x = nx * tanHalfH;
    const y = -1;
    const z = nz * tanHalfV;
    const invLen = 1 / Math.sqrt(x * x + y * y + z * z);
    const base = index * 3;
    directions[base] = x * invLen;
    directions[base + 1] = y * invLen;
    directions[base + 2] = z * invLen;
  }
  return directions;
}

const PRECOMPUTED_RAY_DIRS = buildRayDirections(RAY_H_FOV_DEG, RAY_V_FOV_DEG);

export default function HomePage() {
  const [urlInput, setUrlInput] = useState(DEFAULT_WS_URL);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_WS_URL);
  const [littleEndian, setLittleEndian] = useState(true);
  const [depthScale, setDepthScale] = useState(DEFAULT_DEPTH_SCALE);
  const [xyScale, setXyScale] = useState(DEFAULT_XY_SCALE);
  const [renderMode, setRenderMode] = useState<RenderMode>("ray");
  const viewMode: ViewMode = "topdown";
  const [useBitmask, setUseBitmask] = useState(true);
  const [reverseBitOrder, setReverseBitOrder] = useState(false);
  const [now, setNow] = useState(Date.now());
  const stream = useToFStream(activeUrl);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const parsed = useMemo(() => {
    const packet = stream.lastPacketRef.current;
    if (packet === null || stream.latestByteLength !== 141) {
      return null;
    }
    try {
      return parsePacket(packet, littleEndian);
    } catch {
      return null;
    }
  }, [
    littleEndian,
    stream.lastPacketRef,
    stream.latestByteLength,
    stream.packetCount,
  ]);

  const frameMinMax = useMemo(() => {
    if (parsed === null) {
      return { min: null as number | null, max: null as number | null };
    }

    const valuesMm: number[] = [];
    for (let index = 0; index < 64; index += 1) {
      const valid = useBitmask
        ? isValidCell(parsed.bitmask, index, reverseBitOrder)
        : true;
      if (!valid) {
        continue;
      }
      if (renderMode === "ray") {
        const depthMm = clamp(parsed.values[index], MIN_DISTANCE_MM, MAX_DISTANCE_MM);
        const dirBase = index * 3;
        const endY =
          DEFAULT_CEILING_HEIGHT_M + PRECOMPUTED_RAY_DIRS[dirBase + 1] * (depthMm * MM_TO_M);
        valuesMm.push(endY * 1000);
      } else {
        valuesMm.push(parsed.values[index]);
      }
    }

    if (valuesMm.length === 0) {
      return { min: null as number | null, max: null as number | null };
    }

    return {
      min: Math.round(Math.min(...valuesMm)),
      max: Math.round(Math.max(...valuesMm)),
    };
  }, [parsed, useBitmask, reverseBitOrder, renderMode]);

  return (
    <main className="page">
      <h1 className="title">ToF {"\ub300\uc2dc\ubcf4\ub4dc"}</h1>
      <p className="subtitle">
        {
          "UDP \ube0c\ub9ac\uc9c0 mock \ubaa8\ub4dc(`npm run mock`)\uc5d0 \uc5f0\uacb0\ud574 \ub300\uc2dc\ubcf4\ub4dc\ub97c \ud655\uc778\ud569\ub2c8\ub2e4."
        }
      </p>

      <section className="card">
        <div className="row">
          <span className="label">3D {"\ubdf0\uc5b4"}</span>
          <span className="value">{"\ud0d1-\uce21\uba74 \uace0\uc815 (8x8 \uac12 \ubcc0\ud654 \uad00\ucc30\uc6a9)"}</span>
        </div>
        <div className="row">
          <span className="label">{"\ub80c\ub354 \ubaa8\ub4dc"}</span>
          <span className="value">{renderMode === "tower" ? "tower" : "ray"}</span>
        </div>
        {renderMode === "ray" ? (
          <div className="row">
            <span className="label">{"\uce74\uba54\ub77c \ubdf0"}</span>
            <span className="value">{viewMode}</span>
          </div>
        ) : null}
        <div className="row">
          <span className="label">{"\ubdf0\uc5b4 \uac00\uc774\ub4dc"}</span>
          <span className="value">
            {
              renderMode === "ray"
                ? "\ucc9c\uc7a5 \uc13c\uc11c\uc5d0\uc11c y=0 \ubc14\ub2e5\uae4c\uc9c0 \ub808\uc774\uc640 \ub05d\uc810\uc744 \ud45c\uc2dc\ud569\ub2c8\ub2e4."
                : "\ub192\uc774\uac00 \ubc14\ub2e5\uc5d0\uc11c \uc704\ub85c \ucc44\uc6cc\uc9c0\ub294 \ud615\ud0dc\ub85c \ud45c\uc2dc\ub429\ub2c8\ub2e4."
            }
          </span>
        </div>
        <ToFViewer
          lastPacketRef={stream.lastPacketRef}
          littleEndian={littleEndian}
          depthScale={depthScale}
          xyScale={xyScale}
          useBitmask={useBitmask}
          reverseBitOrder={reverseBitOrder}
          legendMin={frameMinMax.min}
          legendMax={frameMinMax.max}
          renderMode={renderMode}
          ceilingHeight={DEFAULT_CEILING_HEIGHT_M}
          view={viewMode}
        />
      </section>

      <ToFDashboard
        connectionState={stream.connectionState}
        lastReceivedAt={stream.lastReceivedAt}
        now={now}
        parsed={parsed}
        littleEndian={littleEndian}
        invalidPacketCount={stream.invalidPacketCount}
        depthScale={depthScale}
        xyScale={xyScale}
        useBitmask={useBitmask}
        reverseBitOrder={reverseBitOrder}
        onLittleEndianChange={setLittleEndian}
        onDepthScaleChange={setDepthScale}
        onXyScaleChange={setXyScale}
        onUseBitmaskChange={setUseBitmask}
        onReverseBitOrderChange={setReverseBitOrder}
      />

      <details className="card collapsible-card">
        <summary className="summary-toggle">
          {"\uace0\uae09 \uc815\ubcf4 \ubc0f \uc5f0\uacb0 \uc124\uc815"}
        </summary>
        <div className="collapsible-body">
          <section className="subpanel">
            <div className="row">
              <span className="label">{"\uc6f9\uc18c\ucf13 \uc8fc\uc18c"}</span>
              <span className="value">{activeUrl}</span>
            </div>
            <div className="row">
              <span className="label">
                {"\ucd5c\uc2e0 \ubc14\uc774\ud2b8 \uae38\uc774"}
              </span>
              <span className="value">{stream.latestByteLength || "-"}</span>
            </div>
            <div className="row">
              <span className="label">{"\uc218\uc2e0 \ud328\ud0b7 \uc218"}</span>
              <span className="value">{stream.packetCount}</span>
            </div>
            <div className="row">
              <span className="label">{"\ud328\ud0b7 \uc720\ud6a8\uc131(141B)"}</span>
              <span className="value">
                {stream.latestByteLength === 141
                  ? "\uc608"
                  : "\uc544\ub2c8\uc624"}
              </span>
            </div>
          </section>

          <section className="subpanel controls">
            <span className="label">{"\ub80c\ub354 \ubaa8\ub4dc"}</span>
            <div className="toggle-group">
              <button
                className={`button button-toggle ${
                  renderMode === "tower" ? "button-toggle-active" : ""
                }`}
                type="button"
                onClick={() => setRenderMode("tower")}
              >
                tower
              </button>
              <button
                className={`button button-toggle ${
                  renderMode === "ray" ? "button-toggle-active" : ""
                }`}
                type="button"
                onClick={() => setRenderMode("ray")}
              >
                ray
              </button>
            </div>
          </section>

          {renderMode === "ray" ? (
            <section className="subpanel">
              <div className="row">
                <span className="label">{"\uce74\uba54\ub77c \ubdf0 \ud504\ub9ac\uc14b"}</span>
                <span className="value">topdown</span>
              </div>
            </section>
          ) : null}

          <section className="subpanel controls">
            <label htmlFor="ws-url">{"\uc6f9\uc18c\ucf13 \uc8fc\uc18c"}</label>
            <input
              id="ws-url"
              className="input"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="ws://innert.iptime.org:28080"
            />
            <button
              className="button"
              type="button"
              disabled={urlInput.trim().length === 0}
              onClick={() => setActiveUrl(urlInput.trim())}
            >
              {"\uc8fc\uc18c \uc801\uc6a9"}
            </button>
          </section>
        </div>
      </details>
    </main>
  );
}
