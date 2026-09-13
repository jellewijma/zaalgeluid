import { getAuthUserId } from "@convex-dev/auth/server";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export function ownerLogin() {
  const login = process.env.OWNER_LOGIN?.trim().toLowerCase();
  if (!login) throw new Error("Beheerdersaccount is nog niet ingericht.");
  return login;
}

export async function findOwner(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  if (await isLegacyOwner(ctx, userId)) return user;
  const google = await ctx.db.query("authAccounts")
    .withIndex("userIdAndProvider", q => q.eq("userId", userId).eq("provider", "google")).take(1);
  return google[0]?.providerAccountId && google[0].emailVerified && user.emailVerificationTime !== undefined ? user : null;
}

export async function legacyOwnerId(ctx: QueryCtx | MutationCtx) {
  const login = process.env.OWNER_LOGIN?.trim().toLowerCase();
  if (!login) return null;
  const account = await ctx.db.query("authAccounts")
    .withIndex("providerAndAccountId", q => q.eq("provider", "password").eq("providerAccountId", login)).unique();
  return account?.userId ?? null;
}

export async function isLegacyOwner(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await legacyOwnerId(ctx) === userId;
}

const requireOwner = customCtx(async (ctx: QueryCtx | MutationCtx) => {
  const owner = await findOwner(ctx);
  if (!owner) throw new Error("Meld je aan als beheerder.");
  return { owner };
});
export const ownerQuery = customQuery(query, requireOwner);
export const ownerMutation = customMutation(mutation, requireOwner);

export async function getRoom(ctx: QueryCtx | MutationCtx, ownerId: Id<"users">) {
  return ctx.db.query("rooms").withIndex("by_ownerId", q => q.eq("ownerId", ownerId)).unique();
}

export async function tokenHash(token: string) {
  if (!/^(?:[a-fA-F0-9]{64}|[A-Za-z0-9_-]{43})$/.test(token)) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

export async function getController(ctx: QueryCtx | MutationCtx, token: string) {
  const hash = await tokenHash(token);
  if (!hash) return null;
  const grant = await ctx.db.query("controllers").withIndex("by_tokenHash", q => q.eq("tokenHash", hash)).unique();
  return grant && grant.expiresAt > Date.now() ? grant : null;
}

export async function requestedRoom(ctx: QueryCtx | MutationCtx, token?: string) {
  if (token !== undefined) {
    const controller = await getController(ctx, token);
    return controller ? ctx.db.get(controller.roomId) : null;
  }
  const owner = await findOwner(ctx);
  return owner ? getRoom(ctx, owner._id) : null;
}

export function assertPlayer(room: Doc<"rooms"> | null, ownerId: string, clientId: string) {
  if (!room || room.ownerId !== ownerId || room.playerClientId !== clientId || room.leaseUntil <= Date.now()) {
    throw new Error("Deze speler heeft geen actieve verbinding meer. Verbind opnieuw.");
  }
  return room;
}

export function toTrack(file: Doc<"media">) {
  return {
    id: file._id, name: file.name, filename: file.filename, size: file.size,
    createdAt: new Date(file._creationTime).toISOString(), kind: file.kind,
  };
}
