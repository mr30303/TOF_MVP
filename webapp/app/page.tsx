"use client";

import { useEffect, useMemo, useState } from "react";
import { ToFDashboard } from "../components/ToFDashboard";
import { ToFViewer } from "../components/ToFViewer";
import { useToFStream } from "../components/useToFStream";
import { isValidCell, parsePacket } from "../components/utils";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://innert.iptime.org:28080";
const DEFAULT_DEPTH_SCALE = 0.001;
const DEFAULT_XY_SCALE = 0.05;

export default function HomePage() {
  const [urlInput, setUrlInput] = useState(DEFAULT_WS_URL);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_WS_URL);
  const [littleEndian, setLittleEndian] = useState(true);
  const [depthScale, setDepthScale] = useState(DEFAULT_DEPTH_SCALE);
  const [xyScale, setXyScale] = useState(DEFAULT_XY_SCALE);
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

    const values: number[] = [];
    for (let index = 0; index < 64; index += 1) {
      const valid = useBitmask
        ? isValidCell(parsed.bitmask, index, reverseBitOrder)
        : true;
      if (!valid) {
        continue;
      }
      values.push(parsed.values[index]);
    }

    if (values.length === 0) {
      return { min: null as number | null, max: null as number | null };
    }

    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [parsed, useBitmask, reverseBitOrder]);

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
          <span className="label">{"\ubdf0\uc5b4 \uac00\uc774\ub4dc"}</span>
          <span className="value">
            {
              "\ub192\uc774\uac00 \ubc14\ub2e5\uc5d0\uc11c \uc704\ub85c \ucc44\uc6cc\uc9c0\ub294 \ud615\ud0dc\ub85c \ud45c\uc2dc\ub429\ub2c8\ub2e4."
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
