import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export function googleConfigured() {
  return Boolean(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim());
}

export function googleProfile(profile: Record<string, unknown>) {
  if (typeof profile.sub !== "string" || !profile.sub.trim() || profile.sub.length > 255 ||
      typeof profile.email !== "string" || !profile.email.trim() || profile.email_verified !== true) {
    throw new Error("Gebruik een Google-account met een geverifieerd e-mailadres.");
  }
  return {
    id: profile.sub,
    email: profile.email.trim().toLowerCase(),
    emailVerified: true,
    ...(typeof profile.name === "string" ? { name: profile.name } : {}),
    ...(typeof profile.picture === "string" ? { image: profile.picture } : {}),
  };
}

export function playerRedirect(redirectTo: string) {
  const site = new URL(process.env.SITE_URL ?? "");
  const destination = new URL(`${site.pathname.replace(/\/$/, "")}/player`, site.origin);
  let requested: URL;
  try { requested = new URL(redirectTo, `${site.origin}/`); }
  catch { throw new Error("Ongeldige aanmeldbestemming."); }
  if (!/^https?:$/.test(site.protocol) || requested.origin !== destination.origin ||
      requested.pathname !== destination.pathname || requested.username || requested.password) {
    throw new Error("Ongeldige aanmeldbestemming.");
  }
  return destination.toString();
}

export async function createAuthUser(ctx: MutationCtx, {
  existingUserId, provider, profile,
}: {
  existingUserId: Id<"users"> | null;
  provider: { id: string };
  profile: Record<string, unknown>;
}) {
  if (provider.id === "google") {
    if (profile.emailVerified !== true || typeof profile.email !== "string" || !profile.email.trim()) {
      throw new Error("Gebruik een Google-account met een geverifieerd e-mailadres.");
    }
    const data = {
      email: profile.email.trim().toLowerCase(), emailVerificationTime: Date.now(),
      ...(typeof profile.name === "string" ? { name: profile.name } : {}),
      ...(typeof profile.image === "string" ? { image: profile.image } : {}),
    };
    // Only the provider's existing subject links identities; an email match never grants another library.
    if (existingUserId) { await ctx.db.patch(existingUserId, data); return existingUserId; }
    return ctx.db.insert("users", data);
  }
  const login = process.env.OWNER_LOGIN?.trim().toLowerCase();
  if (provider.id !== "password" || !login || profile.email !== login) throw new Error("Aanmelden niet toegestaan.");
  if (existingUserId) return existingUserId;
  return ctx.db.insert("users", { email: login, name: "Jelle" });
}
