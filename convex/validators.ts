import { v } from "convex/values";

export const kindValidator = v.union(v.literal("music"), v.literal("effect"));
export const statusValidator = v.union(
  v.literal("idle"), v.literal("loading"), v.literal("playing"),
  v.literal("paused"), v.literal("stopped"), v.literal("ended"), v.literal("error"),
);
export const playbackValidator = v.object({
  trackId: v.union(v.string(), v.null()), status: statusValidator,
  currentTime: v.number(), duration: v.number(), volume: v.number(),
  ready: v.boolean(), error: v.union(v.string(), v.null()), queue: v.array(v.string()),
  effectTrackId: v.union(v.string(), v.null()), effectStatus: statusValidator,
  effectVolume: v.number(), effectError: v.union(v.string(), v.null()),
});
export const commandValidator = v.union(
  v.object({ action: v.literal("select"), trackId: v.string() }),
  v.object({ action: v.union(v.literal("queue-add"), v.literal("queue-remove")), trackId: v.string() }),
  v.object({ action: v.union(v.literal("queue-clear"), v.literal("next"), v.literal("previous"), v.literal("effect-stop")) }),
  v.object({ action: v.literal("effect-play"), trackId: v.string() }),
  v.object({ action: v.literal("effect-volume"), value: v.number() }),
  v.object({ action: v.union(v.literal("play"), v.literal("pause"), v.literal("stop"), v.literal("restart"), v.literal("clear")) }),
  v.object({ action: v.literal("volume"), value: v.number() }),
  v.object({ action: v.literal("seek"), value: v.number() }),
);
export const trackValidator = v.object({
  id: v.string(), name: v.string(), filename: v.string(), size: v.number(),
  createdAt: v.string(), kind: kindValidator,
});
export const setupValidator = v.object({
  roomId: v.string(),
  pin: v.string(), pinExpiresAt: v.number(),
  playerClientId: v.union(v.string(), v.null()), leaseUntil: v.number(),
});
export const cloudStateValidator = v.object({
  tracks: v.array(trackValidator), playerOnline: v.boolean(), controllerCount: v.number(),
  playback: playbackValidator, playerClientId: v.union(v.string(), v.null()),
  leaseUntil: v.number(), serverNow: v.number(), ackSequence: v.number(),
});
export const pendingCommandValidator = v.object({
  sequence: v.number(), command: commandValidator, expiresAt: v.number(), clientId: v.string(),
});
