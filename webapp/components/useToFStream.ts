"use client";

import { useEffect, useRef, useState } from "react";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

type UseToFStreamResult = {
  connectionState: ConnectionState;
  lastPacketRef: React.MutableRefObject<ArrayBuffer | null>;
  lastReceivedAt: number | null;
  latestByteLength: number;
  packetCount: number;
  invalidPacketCount: number;
};

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 10000;
const WATCHDOG_TIMEOUT_MS = 3000;
const WATCHDOG_INTERVAL_MS = 500;

export function useToFStream(url: string): UseToFStreamResult {
  const lastPacketRef = useRef<ArrayBuffer | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const closedByUserRef = useRef(false);
  const lastReceivedAtRef = useRef<number | null>(null);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [latestByteLength, setLatestByteLength] = useState(0);
  const [packetCount, setPacketCount] = useState(0);
  const [invalidPacketCount, setInvalidPacketCount] = useState(0);

  useEffect(() => {
    if (!url) {
      setConnectionState("disconnected");
      return;
    }

    closedByUserRef.current = false;
    reconnectAttemptRef.current = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearWatchdogTimer = () => {
      if (watchdogTimerRef.current !== null) {
        window.clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };

    const startWatchdogTimer = () => {
      clearWatchdogTimer();
      watchdogTimerRef.current = window.setInterval(() => {
        if (closedByUserRef.current) {
          return;
        }
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const lastAt = lastReceivedAtRef.current;
        if (lastAt === null) {
          return;
        }
        if (Date.now() - lastAt <= WATCHDOG_TIMEOUT_MS) {
          return;
        }

        setConnectionState("disconnected");
        socket.close();
      }, WATCHDOG_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (closedByUserRef.current) {
        return;
      }

      setConnectionState("reconnecting");
      const delay = Math.min(
        BACKOFF_BASE_MS * 2 ** reconnectAttemptRef.current,
        BACKOFF_MAX_MS
      );
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (closedByUserRef.current) {
        return;
      }

      setConnectionState(
        reconnectAttemptRef.current === 0 ? "connecting" : "reconnecting"
      );

      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        const now = Date.now();
        lastReceivedAtRef.current = now;
        setConnectionState("connected");
        startWatchdogTimer();
      };

      socket.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer)) {
          setInvalidPacketCount((value) => value + 1);
          return;
        }

        setLatestByteLength(event.data.byteLength);
        if (event.data.byteLength !== 141) {
          setInvalidPacketCount((value) => value + 1);
          return;
        }

        const now = Date.now();
        lastPacketRef.current = event.data;
        lastReceivedAtRef.current = now;
        setLastReceivedAt(now);
        setConnectionState("connected");
        setPacketCount((value) => value + 1);
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (closedByUserRef.current) {
          setConnectionState("disconnected");
          return;
        }
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closedByUserRef.current = true;
      clearReconnectTimer();
      clearWatchdogTimer();
      const currentSocket = socketRef.current;
      socketRef.current = null;
      if (currentSocket) {
        currentSocket.close();
      }
      setConnectionState("disconnected");
    };
  }, [url]);

  return {
    connectionState,
    lastPacketRef,
    lastReceivedAt,
    latestByteLength,
    packetCount,
    invalidPacketCount,
  };
}
