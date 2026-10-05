/* Single-role admin auth: one password (PBKDF2, stored in settings), and
   session tokens chosen by the admin's browser and registered here on a
   successful login. Every admin function takes that token. */
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { audit, fail, getSetting, setSetting, timingSafeEqual } from "./lib";

const SESSION_MS = 7 * 24 * 3600_000;
const ITER = 100_000;
const MIN_PASSWORD = 12;

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
async function verify(pw: string, stored: string | undefined) {
  const [alg, iter, salt, want] = String(stored ?? "").split("$");
  if (alg !== "pbkdf2" || !salt || !want) return false;
  return timingSafeEqual(await pbkdf2(pw, unhex(salt), parseInt(iter, 10)), want);
}
const validToken = (t: string) => /^[A-Za-z0-9_-]{32,}$/.test(t);

export const _state = internalQuery({
  args: {},
  handler: async (ctx) => ({ hash: await getSetting(ctx, "admin_password_hash") }),
});

/* Progressive backoff on failed logins instead of a flat 15-minute lockout.
   A flat lockout keyed on one global row let anyone lock the real admin out of
   the panel all night by failing ten times; PBKDF2 at 100k iterations is itself
   a hard rate limit on guessing, so the lock only has to blunt bursts. Already
   signed-in devices (7-day sessions) are unaffected either way.
   ponytail: global key because a mutation sees no client IP — per-IP needs the
   login moved behind an httpAction, which is the upgrade if this is ever abused. */
const BACKOFF_MS = [0, 0, 0, 5_000, 15_000, 60_000, 300_000, 900_000];
const backoffFor = (fails: number) => BACKOFF_MS[Math.min(fails, BACKOFF_MS.length - 1)];

export const _throttle = internalMutation({
  args: { reset: v.optional(v.boolean()) },
  handler: async (ctx, { reset }) => {
    const now = Date.now();
    const row = await ctx.db.query("attempts").withIndex("by_key", (q) => q.eq("key", "login")).unique();
    if (reset) { if (row) await ctx.db.delete(row._id); return 0; }
    // `resetAt` here is "locked until"; count is consecutive failures
    if (row && row.resetAt > now) return row.resetAt - now; // still cooling off
    const fails = row && row.resetAt > now - 3600_000 ? row.count : 0; // forget after an idle hour
    if (row) await ctx.db.patch(row._id, { count: fails + 1, resetAt: now + backoffFor(fails + 1) });
    else await ctx.db.insert("attempts", { key: "login", count: 1, resetAt: now + backoffFor(1) });
    return 0;
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
    const waitMs = await ctx.runMutation(internal.auth._throttle, {});
    if (waitMs > 0) {
      fail(`Too many attempts. Try again in ${Math.ceil(waitMs / 1000)} seconds.`, "RATE_LIMIT");
    }
    const { hash } = await ctx.runQuery(internal.auth._state, {});
    if (hash) {
      if (!(await verify(password, hash))) fail("Wrong password.", "UNAUTHENTICATED");
      await ctx.runMutation(internal.auth._startSession, { token });
    } else {
      /* First sign-in ever. The password must come from the deployment's
         environment: there is deliberately no built-in fallback, because a
         fallback compiled into a public repo is a published admin password.
         Set it with: npx convex env set ADMIN_PASSWORD '<strong password>' */
      const initial = process.env.ADMIN_PASSWORD;
      if (!initial || initial.length < MIN_PASSWORD) {
        fail(
          "This deployment has no admin password set. Set ADMIN_PASSWORD " +
            `(at least ${MIN_PASSWORD} characters) on the Convex deployment, then sign in.`,
          "NOT_CONFIGURED",
        );
      }
      if (!timingSafeEqual(password, initial!)) fail("Wrong password.", "UNAUTHENTICATED");
      await ctx.runMutation(internal.auth._startSession, {
        token, hash: await hashPassword(password), isDefault: false,
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
    await audit(ctx, "password.change");
  },
});

export const changePassword = action({
  args: { token: v.string(), current: v.string(), next: v.string() },
  handler: async (ctx, { token, current, next }) => {
    if (!(await ctx.runQuery(internal.auth._isSession, { token }))) fail("Please sign in again.", "UNAUTHENTICATED");
    const { hash } = await ctx.runQuery(internal.auth._state, {});
    if (!(await verify(current, hash))) fail("Current password is wrong.");
    if (next.length < MIN_PASSWORD) fail(`New password must be at least ${MIN_PASSWORD} characters.`);
    if (next === current) fail("Pick a password you have not used here before.");
    await ctx.runMutation(internal.auth._setPassword, { token, hash: await hashPassword(next) });
    return true;
  },
});

/* Re-authentication for actions that change where money goes. Takes the live
   session AND the password, so a stolen session token alone cannot redirect
   payments. Throttled on the same bucket as login. */
export const requirePassword = internalAction({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, { token, password }): Promise<true> => {
    if (!(await ctx.runQuery(internal.auth._isSession, { token }))) fail("Please sign in again.", "UNAUTHENTICATED");
    const waitMs = await ctx.runMutation(internal.auth._throttle, {});
    if (waitMs > 0) fail(`Too many attempts. Try again in ${Math.ceil(waitMs / 1000)} seconds.`, "RATE_LIMIT");
    const { hash } = await ctx.runQuery(internal.auth._state, {});
    if (!(await verify(password, hash))) fail("Password is wrong.", "UNAUTHENTICATED");
    await ctx.runMutation(internal.auth._throttle, { reset: true });
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
