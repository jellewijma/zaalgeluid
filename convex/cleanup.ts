import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const expired = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const now = Date.now();
    const commands = await ctx.db.query("commands").withIndex("by_expiresAt", q => q.lt("expiresAt", now - 60_000)).take(100);
    const grants = await ctx.db.query("controllers").withIndex("by_expiresAt", q => q.lt("expiresAt", now)).take(100);
    await Promise.all([...commands, ...grants].map(row => ctx.db.delete(row._id)));
    if (commands.length === 100 || grants.length === 100) await ctx.scheduler.runAfter(0, internal.cleanup.expired, {});
    return null;
  },
});

export const orphanedUploads = internalMutation({
  args: { cursor: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.system.query("_storage").order("asc").paginate({ cursor: cursor ?? null, numItems: 100 });
    for (const stored of page.page) {
      if (stored._creationTime > Date.now() - 60 * 60 * 1000) continue;
      const linked = await ctx.db.query("media").withIndex("by_storageId", q => q.eq("storageId", stored._id)).unique();
      if (!linked) await ctx.storage.delete(stored._id);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.cleanup.orphanedUploads, { cursor: page.continueCursor });
    return null;
  },
});
