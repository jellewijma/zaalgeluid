export interface Track {
  id: string;
  name: string;
  filename: string;
  size: number;
  createdAt: string;
  kind?: "music" | "effect";
}

export type PlaybackStatus =
  "idle" | "loading" | "playing" | "paused" | "stopped" | "ended" | "error";
export interface Playback {
  trackId: string | null;
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  volume: number;
  ready: boolean;
  error: string | null;
  queue: string[];
  effectTrackId: string | null;
  effectStatus: PlaybackStatus;
  effectVolume: number;
  effectError: string | null;
}
export interface RoomState {
  tracks: Track[];
  playerOnline: boolean;
  controllerCount: number;
  playback: Playback;
}
export type Command =
  | { action: "select"; trackId: string }
  | { action: "queue-add" | "queue-remove"; trackId: string }
  | { action: "queue-clear" | "next" | "previous" | "effect-stop" }
  | { action: "effect-play"; trackId: string }
  | { action: "effect-volume"; value: number }
  | { action: "play" | "pause" | "stop" | "restart" | "clear" }
  | { action: "volume"; value: number }
  | { action: "seek"; value: number };
export type ClientMessage =
  | { type: "command"; command: Command }
  | { type: "playback"; playback: Playback }
  | { type: "ping" };
export type ServerMessage =
  | { type: "state"; state: RoomState }
  | { type: "command"; id: string; command: Command }
  | { type: "error"; message: string; code?: string }
  | { type: "pong" };
export interface Setup {
  pin: string;
  token: string;
  urls: string[];
}
export const initialPlayback: Playback = {
  trackId: null,
  status: "idle",
  currentTime: 0,
  duration: 0,
  volume: 0.75,
  ready: false,
  error: null,
  queue: [],
  effectTrackId: null,
  effectStatus: "idle",
  effectVolume: 0.75,
  effectError: null,
};
