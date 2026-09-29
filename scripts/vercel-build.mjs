/* Vercel build: if the project has Convex deploy credentials, push the backend
   functions first and build the site against that deployment; otherwise just
   build the static site against CONVEX_URL. */
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const selfHosted = process.env.CONVEX_SELF_HOSTED_URL && process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
const cloud = process.env.CONVEX_DEPLOY_KEY;

if (selfHosted || cloud) {
  console.log(`▸ Deploying Convex functions to ${selfHosted ? process.env.CONVEX_SELF_HOSTED_URL : "Convex cloud"}…`);
  run(`npx convex deploy --cmd-url-env-var-name CONVEX_URL --cmd "node scripts/build.mjs"`);
} else {
  console.log("▸ No Convex deploy credentials — building the site only (functions must already be deployed).");
  run("node scripts/build.mjs");
}
