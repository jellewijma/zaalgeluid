import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { commandValidator, kindValidator, playbackValidator } from "./validators";

export default defineSchema({
  ...authTables,
  rooms: defineTable({
    key: v.literal("primary"), ownerId: v.id("users"),
    playerClientId: v.union(v.string(), v.null()), leaseUntil: v.number(),
    pin: v.string(), pinExpiresAt: v.number(), playback: playbackValidator,
    sequence: v.number(), ackSequence: v.number(),
    pairFailures: v.number(), pairWindowStart: v.number(), pairLockedUntil: v.number(),
  }).index("by_key", ["key"]),
  media: defineTable({
    ownerId: v.id("users"), storageId: v.id("_storage"),
    name: v.string(), filename: v.string(), size: v.number(), kind: kindValidator,
  }).index("by_ownerId", ["ownerId"]).index("by_storageId", ["storageId"]),
  controllers: defineTable({
    roomId: v.id("rooms"), tokenHash: v.string(), expiresAt: v.number(), lastSeen: v.number(),
  }).index("by_tokenHash", ["tokenHash"])
    .index("by_roomId_and_expiresAt", ["roomId", "expiresAt"])
    .index("by_roomId_and_lastSeen", ["roomId", "lastSeen"])
    .index("by_expiresAt", ["expiresAt"]),
  commands: defineTable({
    roomId: v.id("rooms"), clientId: v.string(), sequence: v.number(),
    command: commandValidator, expiresAt: v.number(),
  }).index("by_roomId_and_clientId_and_sequence", ["roomId", "clientId", "sequence"])
    .index("by_expiresAt", ["expiresAt"]),
});
