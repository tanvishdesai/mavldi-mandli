/* Static build for Vercel (or any static host).
   - copies the Convex browser client and the QR library into public/vendor
   - writes public/env.js with the Convex deployment URL
   The URL comes from CONVEX_URL (set by `npx convex deploy --cmd`, by Vercel's
   env vars, or by .env.local which `npx convex dev` writes). */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pub = join(root, "public");
mkdirSync(join(pub, "vendor"), { recursive: true });

const convexPkg = dirname(require.resolve("convex/package.json"));
copyFileSync(join(convexPkg, "dist", "browser.bundle.js"), join(pub, "vendor", "convex.js"));
copyFileSync(require.resolve("qrcode-generator"), join(pub, "vendor", "qrcode.js"));

function fromEnvFile(file, key) {
  if (!existsSync(file)) return "";
  const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}
const url =
  process.env.CONVEX_URL ||
  process.env.PUBLIC_CONVEX_URL ||
  process.env.CONVEX_SELF_HOSTED_URL ||
  fromEnvFile(join(root, ".env.local"), "CONVEX_URL") ||
  fromEnvFile(join(root, ".env.local"), "CONVEX_SELF_HOSTED_URL");

if (!url) {
  console.error("✖ No Convex URL. Set CONVEX_URL (e.g. https://your-deployment.convex.cloud or your self-hosted backend URL).");
  process.exit(1);
}
writeFileSync(join(pub, "env.js"), `window.CONVEX_URL = ${JSON.stringify(url)};\n`);
console.log(`✓ Built public/ for ${url}`);
