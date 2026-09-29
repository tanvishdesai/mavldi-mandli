/* Single-role admin auth: one password (PBKDF2, stored in settings), and
   session tokens chosen by the admin's browser and registered here on a
   successful login. Every admin function takes that token. */
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { fail, getSetting, setSetting } from "./lib";

const DEFAULT_PASSWORD = "mavladi2026";
const SESSION_MS = 7 * 24 * 3600_000;
const ITER = 100_000;

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function hashPassword(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${await pbkdf2(pw, salt, ITER)}`;
}
async function verify(pw: string, stored: string) {
  const [alg, iter, salt, want] = stored.split("$");
  if (alg !== "pbkdf2" || !salt || !want) return false;
  const got = await pbkdf2(pw, unhex(salt), parseInt(iter, 10));
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
const validToken = (t: string) => /^[A-Za-z0-9_-]{32,}$/.test(t);

export const _state = internalQuery({
  args: {},
  handler: async (ctx) => ({ hash: await getSetting(ctx, "admin_password_hash") }),
});

/* at most 10 failed tries per 15 minutes */
export const _throttle = internalMutation({
  args: { reset: v.optional(v.boolean()) },
  handler: async (ctx, { reset }) => {
    const now = Date.now();
    const row = await ctx.db.query("attempts").withIndex("by_key", (q) => q.eq("key", "login")).unique();
    if (reset) { if (row) await ctx.db.delete(row._id); return true; }
    if (!row || row.resetAt < now) {
      if (row) await ctx.db.delete(row._id);
      await ctx.db.insert("attempts", { key: "login", count: 1, resetAt: now + 15 * 60_000 });
      return true;
    }
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return row.count < 10;
  },
});

export const _startSession = internalMutation({
  args: { token: v.string(), hash: v.optional(v.string()), isDefault: v.optional(v.boolean()) },
  handler: async (ctx, { token, hash, isDefault }) => {
    if (hash) {
      await setSetting(ctx, "admin_password_hash", hash);
      await setSetting(ctx, "admin_password_is_default", isDefault ? "1" : "0");
    }
    // tidy expired sessions while we're here
    for (const s of await ctx.db.query("sessions").collect()) if (s.expiresAt < Date.now()) await ctx.db.delete(s._id);
    await ctx.db.insert("sessions", { token, expiresAt: Date.now() + SESSION_MS });
  },
});

export const login = action({
  args: { password: v.string(), token: v.string() },
  handler: async (ctx, { password, token }) => {
    if (!validToken(token)) fail("Please refresh and try again.");
    if (!(await ctx.runMutation(internal.auth._throttle, {}))) fail("Too many attempts. Try again in 15 minutes.", "RATE_LIMIT");
    const { hash } = await ctx.runQuery(internal.auth._state, {});
    if (hash) {
      if (!(await verify(password, hash))) fail("Wrong password.", "UNAUTHENTICATED");
      await ctx.runMutation(internal.auth._startSession, { token });
    } else {
      // first sign-in ever: the password comes from the deployment's environment
      const initial = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
      if (password !== initial) fail("Wrong password.", "UNAUTHENTICATED");
      await ctx.runMutation(internal.auth._startSession, {
        token, hash: await hashPassword(password), isDefault: !process.env.ADMIN_PASSWORD,
      });
    }
    await ctx.runMutation(internal.auth._throttle, { reset: true });
    return true;
  },
});

export const _setPassword = internalMutation({
  args: { token: v.string(), hash: v.string() },
  handler: async (ctx, { token, hash }) => {
    await setSetting(ctx, "admin_password_hash", hash);
    await setSetting(ctx, "admin_password_is_default", "0");
    // sign out every other device
    for (const s of await ctx.db.query("sessions").collect()) if (s.token !== token) await ctx.db.delete(s._id);
  },
});

export const changePassword = action({
  args: { token: v.string(), current: v.string(), next: v.string() },
  handler: async (ctx, { token, current, next }) => {
    if (!(await ctx.runQuery(internal.auth._isSession, { token }))) fail("Please sign in again.", "UNAUTHENTICATED");
    const { hash } = await ctx.runQuery(internal.auth._state, {});
    if (!(await verify(current, hash))) fail("Current password is wrong.");
    if (next.length < 8) fail("New password must be at least 8 characters.");
    await ctx.runMutation(internal.auth._setPassword, { token, hash: await hashPassword(next) });
    return true;
  },
});

export const _isSession = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique();
    return !!s && s.expiresAt > Date.now();
  },
});

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = token ? await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique() : null;
    const admin = !!s && s.expiresAt > Date.now();
    return { admin, default_password: admin && (await getSetting(ctx, "admin_password_is_default")) === "1" };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (s) await ctx.db.delete(s._id);
  },
});
