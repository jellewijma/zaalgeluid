import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { initialPlayback } from "../shared/protocol";
import { PLAYER_LEASE_MS, PAIRING_PIN_MS } from "../shared/cloud-protocol";
import { createAuthUser, googleConfigured, googleProfile, playerRedirect } from "../convex/auth_policy";

const modules = import.meta.glob("../convex/**/*.ts");
const CLIENT = "player_abcdefghijklmnop";
const OTHER_CLIENT = "player_otherabcdefghijk";
const TOKEN = "a".repeat(64);
const PIN = "123456";

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const [ownerId, strangerId] = await t.run(async ctx => Promise.all([
    ctx.db.insert("users", { email: "jelle" }),
    ctx.db.insert("users", { email: "someone-else" }),
  ]));
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const stranger = t.withIdentity({ subject: `${strangerId}|stranger-session` });
  await t.run(ctx => ctx.db.insert("authAccounts", { userId: ownerId, provider: "password", providerAccountId: "jelle" }));
  await owner.mutation(api.rooms.claimPlayer, { sentAt: Date.now(), clientId: CLIENT, pin: PIN });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" })));
  const music = await owner.mutation(api.files.finishUpload, { storageId, name: "Liedje", filename: "liedje.mp3", kind: "music" });
  const effectStorageId = await t.run(ctx => ctx.storage.store(new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" })));
  const effect = await owner.mutation(api.files.finishUpload, { storageId: effectStorageId, name: "Effect", filename: "effect.mp3", kind: "effect" });
  await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true }, ackSequence: 0 });
  return { t, owner, stranger, ownerId, music, effect, storageId };
}

beforeEach(() => {
  vi.stubEnv("OWNER_LOGIN", "jelle");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("SITE_URL", "https://jellewijma.com/play-audio");
  vi.stubEnv("AUTH_GOOGLE_ID", "");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
});

async function googleUser(t: Awaited<ReturnType<typeof fixture>>["t"], subject: string, email: string) {
  const userId = await t.run(async ctx => {
    const userId = await createAuthUser(ctx, {
      provider: { id: "google" }, existingUserId: null,
      profile: googleProfile({ sub: subject, email, email_verified: true, name: subject }),
    });
    await ctx.db.insert("authAccounts", { userId, provider: "google", providerAccountId: subject, emailVerified: email });
    return userId;
  });
  return { id: userId, client: t.withIdentity({ subject: `${userId}|google-session` }) };
}

describe("Google identity and private libraries", () => {
  it("requires a configured provider and verified Google subject without exposing configuration values", async () => {
    const { t } = await fixture();
    expect(await t.query(api.account.authMethods, {})).toEqual({ google: false, password: true });
    await expect(t.action(api.auth.signIn, { provider: "google", params: {} })).rejects.toThrow("google");
    vi.stubEnv("AUTH_GOOGLE_ID", "example-client");
    expect(googleConfigured()).toBe(false);
    vi.stubEnv("AUTH_GOOGLE_SECRET", "example-secret");
    expect(await t.query(api.account.authMethods, {})).toEqual({ google: true, password: true });
    for (const bad of [
      { sub: "subject", email: "person@gmail.com", email_verified: false },
      { sub: "subject", email: "person@gmail.com", email_verified: "true" },
      { sub: "", email: "person@gmail.com", email_verified: true },
      { sub: "subject", email_verified: true },
    ]) expect(() => googleProfile(bad)).toThrow("geverifieerd");
    expect(googleProfile({ sub: "stable-subject", email: "Person@gmail.com", email_verified: true })).toEqual({
      id: "stable-subject", email: "person@gmail.com", emailVerified: true,
    });
  });

  it("rejects external and sibling-path OAuth redirects and preserves the application prefix once", () => {
    for (const destination of ["/play-audio/player", "https://jellewijma.com/play-audio/player", "/play-audio/player?unused=1"]) {
      expect(playerRedirect(destination)).toBe("https://jellewijma.com/play-audio/player");
    }
    for (const destination of ["//evil.example/play-audio/player", "https://jellewijma.com.evil.example/play-audio/player",
      "https://user@jellewijma.com/play-audio/player", "/play-audio-other/player", "/player", "javascript:alert(1)",
      "/play-audio/../player", "https://evil.example/play-audio/player"]) {
      expect(() => playerRedirect(destination)).toThrow("aanmeldbestemming");
    }
    vi.stubEnv("SITE_URL", "http://localhost:3179/play-audio/");
    expect(playerRedirect("/play-audio/player")).toBe("http://localhost:3179/play-audio/player");
  });

  it("keeps legacy IDs and access intact, never merges by email, and rejects unauthenticated or unverified users", async () => {
    const { t, owner, ownerId, stranger, music } = await fixture();
    expect(await t.query(api.account.current, {})).toBeNull();
    expect(await stranger.query(api.account.current, {})).toBeNull();
    expect(await owner.query(api.account.current, {})).toEqual({ name: "jelle", email: "jelle", canChangePassword: true });
    const first = await googleUser(t, "google-first-subject", "jelle");
    const second = await googleUser(t, "google-second-subject", "jelle");
    expect(first.id).not.toBe(ownerId);
    expect(second.id).not.toBe(first.id);
    expect(await first.client.query(api.files.list, {})).toEqual([]);
    expect((await owner.query(api.files.list, {}))[0].id).toBe(music.id);
    expect((await first.client.query(api.account.current, {}))?.canChangePassword).toBe(false);
    await expect(first.client.action(api.account.changePassword, { currentPassword: "anything", newPassword: "sufficient-password" })).rejects.toThrow("beheerder");
    const updated = await t.run(ctx => createAuthUser(ctx, {
      provider: { id: "google" }, existingUserId: first.id,
      profile: googleProfile({ sub: "google-first-subject", email: "changed@gmail.com", email_verified: true }),
    }));
    expect(updated).toBe(first.id);
    expect((await first.client.query(api.account.current, {}))?.email).toBe("changed@gmail.com");
    const before = await t.run(ctx => ctx.db.query("users").take(20));
    await expect(t.run(ctx => createAuthUser(ctx, { provider: { id: "google" }, existingUserId: null, profile: { email: "x@gmail.com", emailVerified: false } }))).rejects.toThrow("geverifieerd");
    expect(await t.run(ctx => ctx.db.query("users").take(20))).toHaveLength(before.length);
    const unverifiedId = await t.run(async ctx => {
      const id = await ctx.db.insert("users", { email: "fake@gmail.com", emailVerificationTime: Date.now() });
      await ctx.db.insert("authAccounts", { userId: id, provider: "google", providerAccountId: "unverified-subject" });
      return id;
    });
    expect(await t.withIdentity({ subject: `${unverifiedId}|session` }).query(api.account.current, {})).toBeNull();
  });

  it("isolates two Google players, media and commands while keeping controller capabilities bound to their room", async () => {
    const { t, owner } = await fixture();
    const alice = await googleUser(t, "google-alice", "alice@gmail.com");
    const bob = await googleUser(t, "google-bob", "bob@gmail.com");
    const aliceRoom = await alice.client.mutation(api.rooms.claimPlayer, { clientId: CLIENT, pin: "246810", sentAt: Date.now() });
    const bobRoom = await bob.client.mutation(api.rooms.claimPlayer, { clientId: CLIENT, pin: "246810", sentAt: Date.now() });
    expect(aliceRoom.roomId).not.toBe(bobRoom.roomId);
    expect((await alice.client.query(api.rooms.setup, {}))?.roomId).toBe(aliceRoom.roomId);
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["alice song"], { type: "audio/mpeg" })));
    const song = await alice.client.mutation(api.files.finishUpload, { storageId, name: "Alice", filename: "alice.mp3", kind: "music" });
    expect(await bob.client.query(api.files.list, {})).toEqual([]);
    expect(await bob.client.query(api.files.mediaUrls, {})).toEqual({});
    await expect(bob.client.mutation(api.files.remove, { trackId: song.id })).rejects.toThrow("Geen toegang");
    await expect(bob.client.mutation(api.files.finishUpload, { storageId, name: "Stolen", filename: "stolen.mp3", kind: "music" })).rejects.toThrow("Geen toegang");
    await alice.client.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true, trackId: song.id }, ackSequence: 0 });
    await bob.client.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true }, ackSequence: 0 });
    await expect(bob.client.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true, trackId: song.id }, ackSequence: 0 })).rejects.toThrow("deze bibliotheek");
    await expect(bob.client.mutation(api.rooms.sendCommand, { command: { action: "select", trackId: song.id }, sentAt: Date.now() })).rejects.toThrow("beschikbaar");
    expect((await t.mutation(api.rooms.pair, { pin: "246810", token: TOKEN })).ok).toBe(false);
    expect((await t.mutation(api.rooms.pair, { roomId: "invalid-room", pin: "246810", token: TOKEN })).ok).toBe(false);
    expect((await t.mutation(api.rooms.pair, { roomId: aliceRoom.roomId, pin: "246810", token: TOKEN })).ok).toBe(true);
    expect(await t.mutation(api.rooms.pair, { roomId: bobRoom.roomId, pin: "246810", token: TOKEN })).toMatchObject({
      ok: false, error: expect.stringContaining("andere speler"),
    });
    expect((await bob.client.query(api.rooms.state, { token: TOKEN }))?.tracks.map(track => track.id)).toEqual([song.id]);
    expect(await bob.client.query(api.rooms.state, { token: "invalid-token" })).toBeNull();
    await expect(bob.client.mutation(api.rooms.sendCommand, { token: "invalid-token", command: { action: "stop" }, sentAt: Date.now() })).rejects.toThrow("Koppel");
    await bob.client.mutation(api.rooms.sendCommand, { token: TOKEN, command: { action: "stop" }, sentAt: Date.now() });
    expect(await bob.client.query(api.rooms.pendingCommands, { clientId: CLIENT, afterSequence: 0 })).toEqual([]);
    expect(await alice.client.query(api.rooms.pendingCommands, { clientId: CLIENT, afterSequence: 0 })).toHaveLength(1);
    await bob.client.mutation(api.rooms.revokeControllers, {});
    expect(await t.query(api.rooms.state, { token: TOKEN })).not.toBeNull();
    await alice.client.mutation(api.rooms.revokeControllers, {});
    expect(await t.query(api.rooms.state, { token: TOKEN })).toBeNull();
    await bob.client.mutation(api.rooms.claimPlayer, { clientId: OTHER_CLIENT, pin: "112233", sentAt: Date.now(), force: true });
    expect((await alice.client.query(api.rooms.state, {}))?.playerClientId).toBe(CLIENT);
    expect((await owner.query(api.rooms.state, {}))?.playerClientId).toBe(CLIENT);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("online audio access", () => {
  it("keeps owner operations private and reveals no PIN or media URL to a paired controller", async () => {
    const { t, owner, stranger } = await fixture();
    expect(await t.query(api.rooms.state, {})).toBeNull();
    expect(await t.query(api.rooms.setup, {})).toBeNull();
    expect(await stranger.query(api.rooms.state, {})).toBeNull();
    expect(await t.query(api.files.mediaUrls, {})).toEqual({});
    await expect(stranger.mutation(api.files.generateUploadUrl, {})).rejects.toThrow("beheerder");
    await expect(stranger.mutation(api.rooms.claimPlayer, { sentAt: Date.now(), clientId: OTHER_CLIENT, pin: PIN, force: true })).rejects.toThrow("beheerder");
    expect(await t.mutation(api.rooms.pair, { pin: PIN, token: TOKEN })).toMatchObject({ ok: true });
    const state = await t.query(api.rooms.state, { token: TOKEN });
    expect(state?.tracks).toHaveLength(2);
    expect(state).not.toHaveProperty("pin");
    expect(state).not.toHaveProperty("mediaUrls");
    expect(state?.tracks[0]).not.toHaveProperty("storageId");
    expect(JSON.stringify(state)).not.toContain("https://");
    expect(await t.query(api.rooms.state, { token: "invalid-token" })).toBeNull();
    expect(Object.keys(await owner.query(api.files.mediaUrls, {}))).toHaveLength(2);
  });

  it("rejects public sign-up, reset, and a different login before account creation", async () => {
    const { t } = await fixture();
    for (const flow of ["signUp", "reset", "reset-verification", "email-verification"]) {
      await expect(t.action(api.auth.signIn, { provider: "password", params: { flow, email: "jelle", password: "long-enough-password", newPassword: "long-enough-password" } })).rejects.toThrow("Aanmelden niet toegestaan");
    }
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "someone-else", password: "long-enough-password" } })).rejects.toThrow("Aanmelden niet toegestaan");
    const accounts = await t.run(ctx => ctx.db.query("authAccounts").take(10));
    expect(accounts).toHaveLength(1);
  });

  it("persists the PIN lockout across failed calls, then recovers after five minutes", async () => {
    const { t, owner } = await fixture();
    for (let attempt = 0; attempt < 8; attempt++) expect((await t.mutation(api.rooms.pair, { pin: "999999", token: TOKEN })).ok).toBe(false);
    expect(await t.mutation(api.rooms.pair, { pin: PIN, token: TOKEN })).toMatchObject({ ok: false, error: expect.stringContaining("vijf minuten") });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await owner.mutation(api.rooms.claimPlayer, { sentAt: Date.now(), clientId: CLIENT, pin: PIN });
    expect((await t.mutation(api.rooms.pair, { pin: PIN, token: TOKEN })).ok).toBe(true);
    await owner.mutation(api.rooms.revokeControllers, {});
    expect(await t.query(api.rooms.state, { token: TOKEN })).toBeNull();
  });

  it("expires a pairing PIN without extending existing grants", async () => {
    const { t, owner } = await fixture();
    const pair = await t.mutation(api.rooms.pair, { pin: PIN, token: TOKEN });
    vi.advanceTimersByTime(PAIRING_PIN_MS + 1);
    await t.run(async ctx => {
      const room = await ctx.db.query("rooms").withIndex("by_key", q => q.eq("key", "primary")).unique();
      await ctx.db.patch(room!._id, { leaseUntil: Date.now() + PLAYER_LEASE_MS });
    });
    expect((await t.mutation(api.rooms.pair, { pin: PIN, token: "b".repeat(64) })).ok).toBe(false);
    expect(await t.query(api.rooms.state, { token: TOKEN })).not.toBeNull();
    await t.mutation(api.rooms.controllerHeartbeat, { token: TOKEN });
    vi.setSystemTime(pair.expiresAt! + 1);
    expect(await t.query(api.rooms.state, { token: TOKEN })).toBeNull();
    expect(await owner.query(api.rooms.setup, {})).not.toBeNull();
  });
});

describe("lease fencing and command delivery", () => {
  it("rejects delayed claims and force-takeovers after their original request has expired", async () => {
    const { owner } = await fixture();
    const sentAt = Date.now();
    vi.advanceTimersByTime(PLAYER_LEASE_MS + 1);
    await expect(owner.mutation(api.rooms.claimPlayer, { clientId: OTHER_CLIENT, pin: PIN, sentAt })).rejects.toThrow("verlopen");
    await owner.mutation(api.rooms.claimPlayer, { clientId: OTHER_CLIENT, pin: PIN, sentAt: Date.now() });
    await expect(owner.mutation(api.rooms.claimPlayer, { clientId: CLIENT, pin: PIN, force: true, sentAt })).rejects.toThrow("verlopen");
    expect((await owner.query(api.rooms.state, {}))?.playerClientId).toBe(OTHER_CLIENT);
  });

  it("prevents another player, allows explicit takeover, and fences the previous tab", async () => {
    const { t, owner } = await fixture();
    await expect(owner.mutation(api.rooms.claimPlayer, { sentAt: Date.now(), clientId: OTHER_CLIENT, pin: PIN })).rejects.toThrow("al een speler");
    await owner.mutation(api.rooms.sendCommand, { command: { action: "stop" }, sentAt: Date.now() });
    const claim = await owner.mutation(api.rooms.claimPlayer, { sentAt: Date.now(), clientId: OTHER_CLIENT, pin: "654321", force: true });
    expect(claim.ackSequence).toBe(1);
    await expect(owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: initialPlayback, ackSequence: 1 })).rejects.toThrow("geen actieve");
    expect(await owner.query(api.rooms.pendingCommands, { clientId: CLIENT, afterSequence: 0 })).toEqual([]);
    await owner.mutation(api.rooms.releasePlayer, { clientId: CLIENT });
    expect((await owner.query(api.rooms.state, {}))?.playerClientId).toBe(OTHER_CLIENT);
    expect(await t.query(api.rooms.pendingCommands, { clientId: OTHER_CLIENT, afterSequence: 0 })).toEqual([]);
  });

  it("rejects offline mutation replay, expires old commands and enforces acknowledgement order", async () => {
    const { owner } = await fixture();
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "play" }, sentAt: Date.now() - 5000 })).rejects.toThrow("verlopen");
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "play" }, sentAt: Date.now() + 5001 })).rejects.toThrow("verlopen");
    const first = await owner.mutation(api.rooms.sendCommand, { command: { action: "stop" }, sentAt: Date.now() });
    vi.advanceTimersByTime(5001);
    const pending = await owner.query(api.rooms.pendingCommands, { clientId: CLIENT, afterSequence: 0 });
    expect(pending).toHaveLength(1);
    expect(pending[0].expiresAt).toBeLessThan(Date.now());
    await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true }, ackSequence: first.sequence });
    await expect(owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: initialPlayback, ackSequence: 0 })).rejects.toThrow("Verouderde");
    vi.advanceTimersByTime(PLAYER_LEASE_MS + 1);
    await expect(owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: initialPlayback, ackSequence: first.sequence })).rejects.toThrow("geen actieve");
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "stop" }, sentAt: Date.now() })).rejects.toThrow("offline");
    expect(await owner.query(api.rooms.pendingCommands, { clientId: CLIENT, afterSequence: 0 })).toEqual([]);
  });

  it("validates audio channels, queue bounds and disabled player commands while allowing stop", async () => {
    const { owner, effect, music } = await fixture();
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "select", trackId: effect.id }, sentAt: Date.now() })).rejects.toThrow("beschikbaar");
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "effect-play", trackId: music.id }, sentAt: Date.now() })).rejects.toThrow("beschikbaar");
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "volume", value: 3 }, sentAt: Date.now() })).rejects.toThrow("Ongeldige");
    await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true, queue: Array.from({ length: 200 }, () => music.id) }, ackSequence: 0 });
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "queue-add", trackId: music.id }, sentAt: Date.now() })).rejects.toThrow("wachtrij is vol");
    await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: initialPlayback, ackSequence: 0 });
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "play" }, sentAt: Date.now() })).rejects.toThrow("Activeer");
    await expect(owner.mutation(api.rooms.sendCommand, { command: { action: "stop" }, sentAt: Date.now() })).resolves.toEqual({ sequence: 1 });
  });
});

describe("durable file safety", () => {
  it("rejects unauthorized finalization and invalid names, and deduplicates storage references", async () => {
    const { t, owner, stranger, storageId, music } = await fixture();
    await expect(stranger.mutation(api.files.finishUpload, { storageId, name: "Stolen", filename: "stolen.mp3", kind: "music" })).rejects.toThrow("beheerder");
    const duplicate = await owner.mutation(api.files.finishUpload, { storageId, name: "Again", filename: "again.mp3", kind: "music" });
    expect(duplicate.id).toBe(music.id);
    const invalid = await t.run(ctx => ctx.storage.store(new Blob(["<html>"], { type: "text/html" })));
    await expect(owner.mutation(api.files.finishUpload, { storageId: invalid, name: "Bad", filename: "bad.html", kind: "music" })).rejects.toThrow("geldige naam");
    await expect(owner.mutation(api.files.finishUpload, { storageId, name: "Bad", filename: "../bad.mp3", kind: "music" })).rejects.toThrow("geldige naam");
  });

  it("protects selected, queued and pending audio before deleting storage", async () => {
    const { t, owner, stranger, music, storageId } = await fixture();
    await expect(stranger.mutation(api.files.remove, { trackId: music.id })).rejects.toThrow("beheerder");
    await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true, trackId: music.id }, ackSequence: 0 });
    await expect(owner.mutation(api.files.remove, { trackId: music.id })).rejects.toThrow("eerst uit");
    await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true, queue: [music.id] }, ackSequence: 0 });
    await expect(owner.mutation(api.files.remove, { trackId: music.id })).rejects.toThrow("eerst uit");
    await owner.mutation(api.rooms.reportPlayback, { clientId: CLIENT, playback: { ...initialPlayback, ready: true }, ackSequence: 0 });
    await owner.mutation(api.rooms.sendCommand, { command: { action: "select", trackId: music.id }, sentAt: Date.now() });
    await expect(owner.mutation(api.files.remove, { trackId: music.id })).rejects.toThrow("verwerkt nog");
    vi.advanceTimersByTime(5001);
    await owner.mutation(api.files.remove, { trackId: music.id });
    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await owner.query(api.files.list, {})).toHaveLength(1);
  });

  it("cleans orphaned uploads while preserving linked audio and new uploads", async () => {
    const { t, owner } = await fixture();
    const orphan = await t.run(ctx => ctx.storage.store(new Blob(["unused"], { type: "audio/mpeg" })));
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    const fresh = await t.run(ctx => ctx.storage.store(new Blob(["fresh"], { type: "audio/mpeg" })));
    await t.mutation(internal.cleanup.orphanedUploads, {});
    expect(await t.run(ctx => ctx.storage.getUrl(orphan))).toBeNull();
    expect(await t.run(ctx => ctx.storage.getUrl(fresh))).not.toBeNull();
    expect(Object.keys(await owner.query(api.files.mediaUrls, {}))).toHaveLength(2);
  });
});
