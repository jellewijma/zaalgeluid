import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertPlayer, findOwner, getController, getRoom, ownerMutation, toTrack, tokenHash } from "./access";
import { cloudStateValidator, commandValidator, pendingCommandValidator, playbackValidator, setupValidator } from "./validators";
import { initialPlayback } from "../shared/protocol";
import type { Playback, Command } from "../shared/protocol";
import { COMMAND_TTL_MS, CONTROLLER_GRANT_MS, CONTROLLER_PRESENCE_MS, PAIRING_PIN_MS, PLAYER_LEASE_MS } from "../shared/cloud-protocol";

const MAX_QUEUE = 200;
const MAX_CONTROLLERS = 32;
const PAIR_LOCKOUT_MS = 5 * 60 * 1000;

function validClientId(clientId: string) {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(clientId)) throw new Error("Ongeldige speleridentificatie.");
}
function validPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("Gebruik een pincode van zes cijfers.");
}
function finiteRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}
function assertFreshRequest(sentAt: number, now: number) {
  if (!Number.isFinite(sentAt) || now - sentAt >= COMMAND_TTL_MS || sentAt - now > COMMAND_TTL_MS) {
    throw new Error("Deze opdracht is verlopen. Probeer opnieuw.");
  }
}
async function mediaFor(ctx: QueryCtx | MutationCtx, room: Doc<"rooms">) {
  return ctx.db.query("media").withIndex("by_ownerId", q => q.eq("ownerId", room.ownerId)).take(1000);
}
function validatePlayback(playback: Playback, files: Doc<"media">[]) {
  if (playback.queue.length > MAX_QUEUE || !finiteRange(playback.currentTime, 0, 604800) ||
      !finiteRange(playback.duration, 0, 604800) || !finiteRange(playback.volume, 0, 1) ||
      !finiteRange(playback.effectVolume, 0, 1) || (playback.error?.length ?? 0) > 1000 ||
      (playback.effectError?.length ?? 0) > 1000) throw new Error("Ongeldige afspeelstatus.");
  const tracks = new Map(files.map(file => [String(file._id), file.kind]));
  if ((playback.trackId !== null && tracks.get(playback.trackId) !== "music") ||
      (playback.effectTrackId !== null && tracks.get(playback.effectTrackId) !== "effect") ||
      playback.queue.some(id => tracks.get(id) !== "music")) throw new Error("Bestand is niet beschikbaar in deze bibliotheek.");
}
function validateCommand(command: Command, room: Doc<"rooms">, files: Doc<"media">[]) {
  if ("trackId" in command) {
    const file = files.find(file => file._id === command.trackId);
    if (!file || file.kind !== (command.action === "effect-play" ? "effect" : "music")) {
      throw new Error("Bestand is niet beschikbaar voor deze actie.");
    }
  }
  if ("value" in command && !finiteRange(command.value, 0, command.action === "seek" ? room.playback.duration : 1)) {
    throw new Error("Ongeldige waarde voor deze actie.");
  }
  if (command.action === "queue-add" && room.playback.queue.length >= MAX_QUEUE) throw new Error("De wachtrij is vol (maximaal 200 liedjes).");
  if (!room.playback.ready && command.action !== "stop" && command.action !== "effect-stop") {
    throw new Error("Activeer eerst het geluid op de speler.");
  }
}

export const state = query({
  args: { token: v.optional(v.string()) }, returns: v.union(cloudStateValidator, v.null()),
  handler: async (ctx, { token }) => {
    const room = await getRoom(ctx);
    if (!room) return null;
    const owner = await findOwner(ctx);
    if (owner?._id !== room.ownerId && (!token || !await getController(ctx, token, room))) return null;
    const now = Date.now();
    const controllers = await ctx.db.query("controllers")
      .withIndex("by_roomId_and_lastSeen", q => q.eq("roomId", room._id).gt("lastSeen", now - CONTROLLER_PRESENCE_MS)).take(MAX_CONTROLLERS);
    return {
      tracks: (await mediaFor(ctx, room)).map(toTrack),
      playerOnline: room.playerClientId !== null && room.leaseUntil > now,
      controllerCount: controllers.filter(controller => controller.expiresAt > now).length,
      playback: room.playback, playerClientId: room.playerClientId,
      leaseUntil: room.leaseUntil, serverNow: now, ackSequence: room.ackSequence,
    };
  },
});

// An action is deliberately used: a query containing Date.now() can be cached.
export const serverTime = action({
  args: {}, returns: v.number(), handler: async () => Date.now(),
});

export const setup = query({
  args: {}, returns: v.union(setupValidator, v.null()),
  handler: async ctx => {
    const owner = await findOwner(ctx);
    if (!owner) return null;
    const room = await getRoom(ctx);
    if (!room || room.ownerId !== owner._id) return null;
    return { pin: room.pin, pinExpiresAt: room.pinExpiresAt, playerClientId: room.playerClientId, leaseUntil: room.leaseUntil };
  },
});

export const claimPlayer = ownerMutation({
  args: { clientId: v.string(), pin: v.string(), force: v.optional(v.boolean()), sentAt: v.number() },
  returns: v.object({ pin: v.string(), pinExpiresAt: v.number(), leaseUntil: v.number(), ackSequence: v.number(), serverNow: v.number() }),
  handler: async (ctx, { clientId, pin, force, sentAt }) => {
    validClientId(clientId); validPin(pin);
    const now = Date.now();
    assertFreshRequest(sentAt, now);
    const room = await getRoom(ctx);
    if (room && room.ownerId !== ctx.owner._id) throw new Error("Geen toegang tot deze speler.");
    if (room && room.playerClientId !== clientId && room.playerClientId !== null && room.leaseUntil > now && !force) {
      throw new Error("Er is al een speler actief. Neem de bediening over om deze speler te gebruiken.");
    }
    const leaseUntil = now + PLAYER_LEASE_MS;
    const pinExpiresAt = now + PAIRING_PIN_MS;
    if (!room) {
      await ctx.db.insert("rooms", {
        key: "primary", ownerId: ctx.owner._id, playerClientId: clientId, leaseUntil, pin, pinExpiresAt,
        playback: initialPlayback, sequence: 0, ackSequence: 0,
        pairFailures: 0, pairWindowStart: now, pairLockedUntil: 0,
      });
      return { pin, pinExpiresAt, leaseUntil, ackSequence: 0, serverNow: now };
    }
    const sameClient = room.playerClientId === clientId;
    const playback: Playback = sameClient ? room.playback : {
      ...room.playback, ready: false, status: room.playback.trackId ? "paused" : "idle",
      effectTrackId: null, effectStatus: "idle", effectError: null,
    };
    const ackSequence = sameClient ? room.ackSequence : room.sequence;
    await ctx.db.patch(room._id, { playerClientId: clientId, leaseUntil, pin, pinExpiresAt, playback, ackSequence });
    return { pin, pinExpiresAt, leaseUntil, ackSequence, serverNow: now };
  },
});

export const rotatePin = ownerMutation({
  args: { clientId: v.string(), pin: v.string() }, returns: setupValidator,
  handler: async (ctx, { clientId, pin }) => {
    validPin(pin);
    const room = assertPlayer(await getRoom(ctx), ctx.owner._id, clientId);
    const pinExpiresAt = Date.now() + PAIRING_PIN_MS;
    await ctx.db.patch(room._id, { pin, pinExpiresAt });
    return { pin, pinExpiresAt, playerClientId: room.playerClientId, leaseUntil: room.leaseUntil };
  },
});

export const reportPlayback = ownerMutation({
  args: { clientId: v.string(), playback: playbackValidator, ackSequence: v.number() }, returns: v.null(),
  handler: async (ctx, { clientId, playback, ackSequence }) => {
    const room = assertPlayer(await getRoom(ctx), ctx.owner._id, clientId);
    if (!Number.isSafeInteger(ackSequence) || ackSequence < room.ackSequence || ackSequence > room.sequence) {
      throw new Error("Verouderde bevestiging van de afspeelstatus.");
    }
    validatePlayback(playback, await mediaFor(ctx, room));
    await ctx.db.patch(room._id, { playback, ackSequence, leaseUntil: Date.now() + PLAYER_LEASE_MS });
    return null;
  },
});

export const releasePlayer = ownerMutation({
  args: { clientId: v.string() }, returns: v.null(),
  handler: async (ctx, { clientId }) => {
    const room = await getRoom(ctx);
    if (!room || room.ownerId !== ctx.owner._id || room.playerClientId !== clientId) return null;
    await ctx.db.patch(room._id, {
      playerClientId: null, leaseUntil: 0, pinExpiresAt: 0, ackSequence: room.sequence,
      playback: { ...room.playback, ready: false, status: room.playback.trackId ? "paused" : "idle", effectStatus: "stopped", effectTrackId: null },
    });
    return null;
  },
});

export const pair = mutation({
  args: { pin: v.string(), token: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()), expiresAt: v.union(v.number(), v.null()) }),
  handler: async (ctx, { pin, token }) => {
    const fail = (error: string) => ({ ok: false, error, expiresAt: null });
    const hash = await tokenHash(token);
    if (!hash) return fail("Ongeldige koppelcode. Vernieuw de pagina.");
    const room = await getRoom(ctx);
    const now = Date.now();
    if (!room || room.playerClientId === null || room.leaseUntil <= now) return fail("Er is geen speler online.");
    if (room.pairLockedUntil > now) return fail("Te veel pogingen. Probeer het over vijf minuten opnieuw.");
    if (room.pin !== pin || room.pinExpiresAt <= now) {
      const newWindow = now - room.pairWindowStart >= PAIR_LOCKOUT_MS;
      const pairFailures = (newWindow ? 0 : room.pairFailures) + 1;
      await ctx.db.patch(room._id, {
        pairFailures, pairWindowStart: newWindow ? now : room.pairWindowStart,
        pairLockedUntil: pairFailures >= 8 ? now + PAIR_LOCKOUT_MS : 0,
      });
      return fail(pairFailures >= 8 ? "Te veel pogingen. Probeer het over vijf minuten opnieuw." : "Pincode is onjuist of verlopen.");
    }
    const existing = await ctx.db.query("controllers").withIndex("by_tokenHash", q => q.eq("tokenHash", hash)).unique();
    const active = await ctx.db.query("controllers")
      .withIndex("by_roomId_and_expiresAt", q => q.eq("roomId", room._id).gt("expiresAt", now)).take(MAX_CONTROLLERS);
    if ((!existing || existing.expiresAt <= now) && active.length >= MAX_CONTROLLERS) return fail("Er zijn te veel apparaten gekoppeld. Verbreek bestaande koppelingen op de speler.");
    const expiresAt = now + CONTROLLER_GRANT_MS;
    if (existing) await ctx.db.patch(existing._id, { roomId: room._id, expiresAt, lastSeen: now });
    else await ctx.db.insert("controllers", { roomId: room._id, tokenHash: hash, expiresAt, lastSeen: now });
    await ctx.db.patch(room._id, { pairFailures: 0, pairLockedUntil: 0, pairWindowStart: now });
    return { ok: true, error: null, expiresAt };
  },
});

export const controllerHeartbeat = mutation({
  args: { token: v.string() }, returns: v.null(),
  handler: async (ctx, { token }) => {
    const room = await getRoom(ctx);
    const controller = room ? await getController(ctx, token, room) : null;
    if (!controller) throw new Error("Koppeling verlopen. Koppel dit apparaat opnieuw.");
    await ctx.db.patch(controller._id, { lastSeen: Date.now() });
    return null;
  },
});

export const revokeControllers = ownerMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const room = await getRoom(ctx);
    if (!room || room.ownerId !== ctx.owner._id) return null;
    const grants = await ctx.db.query("controllers")
      .withIndex("by_roomId_and_expiresAt", q => q.eq("roomId", room._id).gt("expiresAt", Date.now())).take(MAX_CONTROLLERS);
    await Promise.all(grants.map(grant => ctx.db.delete(grant._id)));
    return null;
  },
});

export const sendCommand = mutation({
  args: { token: v.optional(v.string()), command: commandValidator, sentAt: v.number() },
  returns: v.object({ sequence: v.number() }),
  handler: async (ctx, { token, command, sentAt }) => {
    const room = await getRoom(ctx);
    if (!room) throw new Error("Er is geen speler online.");
    const owner = await findOwner(ctx);
    if (owner?._id !== room.ownerId && (!token || !await getController(ctx, token, room))) throw new Error("Koppel dit apparaat opnieuw.");
    const now = Date.now();
    assertFreshRequest(sentAt, now);
    if (!room.playerClientId || room.leaseUntil <= now) throw new Error("De speler is offline.");
    validateCommand(command, room, await mediaFor(ctx, room));
    const pending = await ctx.db.query("commands")
      .withIndex("by_roomId_and_clientId_and_sequence", q => q.eq("roomId", room._id).eq("clientId", room.playerClientId!).gt("sequence", room.ackSequence)).take(100);
    if (pending.length >= 100) throw new Error("De speler verwerkt nog opdrachten. Probeer opnieuw.");
    if (command.action === "queue-add") {
      const queuedAdds = pending.filter(item => item.expiresAt > now && item.command.action === "queue-add").length;
      if (room.playback.queue.length + queuedAdds >= MAX_QUEUE) throw new Error("De wachtrij is vol (maximaal 200 liedjes).");
    }
    const sequence = room.sequence + 1;
    await ctx.db.insert("commands", { roomId: room._id, clientId: room.playerClientId, sequence, command, expiresAt: Math.min(sentAt + COMMAND_TTL_MS, now + COMMAND_TTL_MS) });
    await ctx.db.patch(room._id, { sequence });
    return { sequence };
  },
});

export const pendingCommands = query({
  args: { clientId: v.string(), afterSequence: v.number() }, returns: v.array(pendingCommandValidator),
  handler: async (ctx, { clientId, afterSequence }) => {
    const owner = await findOwner(ctx);
    const room = await getRoom(ctx);
    if (!owner || !room || room.ownerId !== owner._id || room.playerClientId !== clientId || room.leaseUntil <= Date.now()) return [];
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return [];
    const commands = await ctx.db.query("commands")
      .withIndex("by_roomId_and_clientId_and_sequence", q => q.eq("roomId", room._id).eq("clientId", clientId).gt("sequence", Math.max(afterSequence, room.ackSequence))).take(100);
    // Expired records are returned so the player can acknowledge their sequence without executing them.
    return commands.map(({ sequence, command, expiresAt, clientId: target }) => ({ sequence, command, expiresAt, clientId: target }));
  },
});
