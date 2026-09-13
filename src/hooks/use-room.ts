import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialPlayback,
  type ClientMessage,
  type Command,
  type RoomState,
  type ServerMessage,
} from "../../shared/protocol";
import { AudioEngine } from "../lib/audio-engine";
import { appPath } from "../lib/paths";

export type Connection = "connecting" | "connected" | "disconnected" | "busy";
const emptyRoom: RoomState = {
  tracks: [],
  playerOnline: false,
  controllerCount: 0,
  playback: initialPlayback,
};

export function useRoom(
  token: string,
  role: "player" | "controller",
  onInvalidSession: () => void,
) {
  const [state, setState] = useState<RoomState>(emptyRoom);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const invalidSessionRef = useRef(onInvalidSession);
  useEffect(() => {
    invalidSessionRef.current = onInvalidSession;
  }, [onInvalidSession]);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let connectTimeout: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let blocked = false;
    let lastMessage = Date.now();
    const send = (message: ClientMessage) => {
      if (socketRef.current?.readyState === WebSocket.OPEN)
        socketRef.current.send(JSON.stringify(message));
    };
    const engine =
      role === "player"
        ? new AudioEngine({
            token,
            onPlayback: (playback) => send({ type: "playback", playback }),
          })
        : null;
    engineRef.current = engine;

    const connect = () => {
      if (disposed || blocked) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${appPath("/ws")}?token=${encodeURIComponent(token)}`,
      );
      socketRef.current = ws;
      connectTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          setConnection("disconnected");
          ws.close();
        }
      }, 8000);
      ws.onopen = () => {
        clearTimeout(connectTimeout);
        attempts = 0;
        lastMessage = Date.now();
        setConnection("connected");
        setError(null);
        if (engine) send({ type: "playback", playback: engine.getSnapshot() });
      };
      ws.onmessage = (event) => {
        lastMessage = Date.now();
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "state") setState(message.state);
        if (message.type === "command" && engine)
          void engine.execute(message.command);
        if (message.type === "error") {
          setError(message.message);
          if (message.code === "PLAYER_BUSY") {
            blocked = true;
            setConnection("busy");
          }
          if (message.code === "UNAUTHORIZED") {
            blocked = true;
            invalidSessionRef.current();
          }
        }
      };
      ws.onclose = () => {
        clearTimeout(connectTimeout);
        engine?.disconnect();
        if (disposed || blocked) return;
        setConnection("disconnected");
        setState((previous) => ({ ...previous, playerOnline: false }));
        // Validate before reconnecting so a restarted server or expired tablet session
        // returns to pairing instead of retrying an obsolete token forever.
        retry = setTimeout(
          () => {
            void fetch(appPath("/api/tracks"), {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(5000),
            })
              .then((response) => {
                if (disposed) return;
                if (response.status === 401 || response.status === 403)
                  invalidSessionRef.current();
                else connect();
              })
              .catch(() => {
                if (!disposed) connect();
              });
          },
          Math.min(1000 * 2 ** attempts++, 5000),
        );
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const heartbeat = setInterval(() => {
      if (
        Date.now() - lastMessage > 10000 &&
        socketRef.current?.readyState === WebSocket.OPEN
      ) {
        engine?.disconnect();
        setConnection("disconnected");
        setState((previous) => ({ ...previous, playerOnline: false }));
        socketRef.current.close();
      } else send({ type: "ping" });
    }, 3000);
    return () => {
      disposed = true;
      clearInterval(heartbeat);
      clearTimeout(retry);
      clearTimeout(connectTimeout);
      socketRef.current?.close();
      socketRef.current = null;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [token, role]);

  const command = useCallback((value: Command) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError(
        "Geen verbinding. Wacht tot de verbinding is hersteld en probeer opnieuw.",
      );
      return;
    }
    setError(null);
    socketRef.current.send(
      JSON.stringify({
        type: "command",
        command: value,
      } satisfies ClientMessage),
    );
  }, []);
  const enable = useCallback(async () => {
    setError(null);
    try {
      await engineRef.current?.enable();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Audio activeren is niet gelukt.",
      );
    }
  }, []);
  return {
    state,
    connection,
    command,
    enable,
    error,
    clearError: () => setError(null),
  };
}
