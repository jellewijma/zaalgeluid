import { createAccount, getAuthUserId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalAction, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { findOwner, isLegacyOwner, ownerLogin } from "./access";
import { googleConfigured } from "./auth_policy";

export const current = query({
  args: {}, returns: v.union(v.object({ name: v.string(), email: v.string(), canChangePassword: v.boolean() }), v.null()),
  handler: async ctx => {
    const user = await findOwner(ctx);
    return user ? { name: user.name ?? user.email ?? "", email: user.email ?? "", canChangePassword: await isLegacyOwner(ctx, user._id) } : null;
  },
});

export const authMethods = query({
  args: {}, returns: v.object({ google: v.boolean(), password: v.boolean() }),
  handler: async () => ({ google: googleConfigured(), password: Boolean(process.env.OWNER_LOGIN?.trim()) }),
});

function validatePassword(password: string) {
  if (password.length < 12 || password.length > 200) throw new Error("Gebruik een wachtwoord van 12 tot 200 tekens.");
}

export const ownerAccount = internalQuery({
  args: {}, returns: v.union(v.id("users"), v.null()),
  handler: async ctx => {
    const account = await ctx.db.query("authAccounts")
      .withIndex("providerAndAccountId", q => q.eq("provider", "password").eq("providerAccountId", ownerLogin())).unique();
    return account?.userId ?? null;
  },
});

export const bootstrapOwner = internalAction({
  args: { password: v.string() }, returns: v.null(),
  handler: async (ctx, { password }) => {
    validatePassword(password);
    if (await ctx.runQuery(internal.account.ownerAccount, {})) throw new Error("Beheerdersaccount bestaat al; er is niets gewijzigd.");
    await createAccount(ctx, {
      provider: "password", account: { id: ownerLogin(), secret: password },
      profile: { email: ownerLogin(), name: "Jelle" },
      shouldLinkViaEmail: false, shouldLinkViaPhone: false,
    });
    return null;
  },
});

export const resetOwner = internalAction({
  args: { password: v.string() }, returns: v.null(),
  handler: async (ctx, { password }) => {
    validatePassword(password);
    const userId = await ctx.runQuery(internal.account.ownerAccount, {});
    if (!userId) throw new Error("Beheerdersaccount bestaat niet.");
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: ownerLogin(), secret: password } });
    await invalidateSessions(ctx, { userId });
    return null;
  },
});

export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() }, returns: v.null(),
  handler: async (ctx, { currentPassword, newPassword }) => {
    validatePassword(newPassword);
    const currentUserId = await getAuthUserId(ctx);
    const ownerId = await ctx.runQuery(internal.account.ownerAccount, {});
    if (!currentUserId || ownerId !== currentUserId) throw new Error("Meld je aan als beheerder.");
    await retrieveAccount(ctx, { provider: "password", account: { id: ownerLogin(), secret: currentPassword } });
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: ownerLogin(), secret: newPassword } });
    await invalidateSessions(ctx, { userId: currentUserId });
    return null;
  },
});
