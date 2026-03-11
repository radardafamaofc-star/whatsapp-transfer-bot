import { useState, useEffect, useCallback, useRef } from "react";
import type { WhatsAppStatus, TransferProgress, WSMessage, SessionInfo, QueueStatus } from "@shared/schema";

export function useWebSocket(userId?: number) {
  const [status, setStatus] = useState<WhatsAppStatus>("disconnected");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [transferProgress, setTransferProgress] =
    useState<TransferProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    totalMembers: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    remaining: 0,
    isRunning: false,
    isPaused: false,
    globalAddsCount: 0,
    safetyPauseAt: 60,
  });
  const [sessionQRCodes, setSessionQRCodes] = useState<Record<string, string>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const userParam = userId !== undefined ? `?userId=${userId}` : "";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws${userParam}`);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);

        switch (message.type) {
          case "status":
            setStatus(message.data as WhatsAppStatus);
            if (message.data === "connected" || message.data === "disconnected") {
              setQrCode(null);
            }
            break;
          case "qr_code":
            if (typeof message.data === "object" && message.data?.sessionId) {
              setSessionQRCodes((prev) => ({
                ...prev,
                [message.data.sessionId]: message.data.qrDataUrl,
              }));
            } else if (typeof message.data === "string") {
              setQrCode(message.data);
              setStatus("qr_code");
            }
            break;
          case "transfer_progress":
            setTransferProgress(message.data as TransferProgress);
            break;
          case "sessions_update":
            setSessions(message.data as SessionInfo[]);
            break;
          case "queue_update":
            setQueueStatus(message.data as QueueStatus);
            break;
          case "error":
            console.error("WS error:", message.data);
            setLastError(message.data as string);
            break;
        }
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [userId]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (status === "connected" || userId === undefined) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/whatsapp/status`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.status && data.status !== status) {
            setStatus(data.status);
            if (data.status === "connected" || data.status === "disconnected") {
              setQrCode(null);
            }
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [status, userId]);

  const clearError = useCallback(() => setLastError(null), []);

  return {
    status,
    qrCode,
    transferProgress,
    setTransferProgress,
    lastError,
    clearError,
    sessions,
    queueStatus,
    sessionQRCodes,
  };
}
