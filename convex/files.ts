import { v } from "convex/values";
import { findOwner, getRoom, ownerMutation, ownerQuery, toTrack } from "./access";
import { kindValidator, trackValidator } from "./validators";
import { query } from "./_generated/server";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const MAX_LIBRARY = 1000;
const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus|aif|aiff)$/i;

export const list = ownerQuery({
  args: {}, returns: v.array(trackValidator),
  handler: async ctx => (await ctx.db.query("media").withIndex("by_ownerId", q => q.eq("ownerId", ctx.owner._id)).take(MAX_LIBRARY)).map(toTrack),
});

export const mediaUrls = query({
  args: {}, returns: v.record(v.string(), v.string()),
  handler: async ctx => {
    const owner = await findOwner(ctx);
    if (!owner) return {};
    const files = await ctx.db.query("media").withIndex("by_ownerId", q => q.eq("ownerId", owner._id)).take(MAX_LIBRARY);
    const pairs = await Promise.all(files.map(async file => [file._id, await ctx.storage.getUrl(file.storageId)] as const));
    return Object.fromEntries(pairs.filter((pair): pair is readonly [typeof pair[0], string] => pair[1] !== null));
  },
});

export const generateUploadUrl = ownerMutation({
  args: {}, returns: v.string(),
  handler: async ctx => {
    const files = await ctx.db.query("media").withIndex("by_ownerId", q => q.eq("ownerId", ctx.owner._id)).take(MAX_LIBRARY);
    if (files.length >= MAX_LIBRARY) throw new Error("De bibliotheek is vol (maximaal 1000 bestanden).");
    return ctx.storage.generateUploadUrl();
  },
});

export const finishUpload = ownerMutation({
  args: { storageId: v.id("_storage"), name: v.string(), filename: v.string(), kind: kindValidator }, returns: trackValidator,
  handler: async (ctx, { storageId, name, filename, kind }) => {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 200 || filename.length > 255 || !AUDIO_EXTENSION.test(filename) ||
        /[\\/]/.test(filename) || Array.from(filename).some(character => character.charCodeAt(0) < 32)) {
      throw new Error("Kies een audiobestand met een geldige naam.");
    }
    const metadata = await ctx.db.system.get(storageId);
    if (!metadata || metadata.size < 1 || metadata.size > MAX_FILE_SIZE) throw new Error("Audiobestand ontbreekt of is groter dan 500 MB.");
    const contentType = metadata.contentType?.split(";")[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith("audio/") && !["application/octet-stream", "video/webm", "video/mp4", "application/ogg"].includes(contentType)) {
      throw new Error("Dit bestand heeft geen ondersteund audioformaat.");
    }
    const existing = await ctx.db.query("media").withIndex("by_storageId", q => q.eq("storageId", storageId)).unique();
    if (existing) {
      if (existing.ownerId !== ctx.owner._id) throw new Error("Geen toegang tot dit bestand.");
      return toTrack(existing);
    }
    const files = await ctx.db.query("media").withIndex("by_ownerId", q => q.eq("ownerId", ctx.owner._id)).take(MAX_LIBRARY);
    if (files.length >= MAX_LIBRARY) throw new Error("De bibliotheek is vol (maximaal 1000 bestanden).");
    const id = await ctx.db.insert("media", { ownerId: ctx.owner._id, storageId, name: cleanName, filename, kind, size: metadata.size });
    const file = await ctx.db.get(id);
    if (!file) throw new Error("Opslaan is mislukt.");
    return toTrack(file);
  },
});

export const remove = ownerMutation({
  args: { trackId: v.string() }, returns: v.null(),
  handler: async (ctx, { trackId }) => {
    const id = ctx.db.normalizeId("media", trackId);
    const file = id ? await ctx.db.get(id) : null;
    if (!file || file.ownerId !== ctx.owner._id) throw new Error("Geen toegang tot dit bestand.");
    const room = await getRoom(ctx, ctx.owner._id);
    if (room && room.ownerId === ctx.owner._id) {
      if (room.playback.trackId === trackId || room.playback.effectTrackId === trackId || room.playback.queue.includes(trackId)) {
        throw new Error("Verwijder dit bestand eerst uit de speler en de wachtrij.");
      }
      if (room.playerClientId) {
        const pending = await ctx.db.query("commands")
          .withIndex("by_roomId_and_clientId_and_sequence", q => q.eq("roomId", room._id).eq("clientId", room.playerClientId!).gt("sequence", room.ackSequence)).take(100);
        if (pending.some(item => item.expiresAt > Date.now() && "trackId" in item.command && item.command.trackId === trackId)) {
          throw new Error("De speler verwerkt nog een opdracht voor dit bestand.");
        }
      }
    }
    await ctx.db.delete(file._id);
    await ctx.storage.delete(file.storageId);
    return null;
  },
});
