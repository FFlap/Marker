import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A command is required");

const result = spawnSync(command, args, {
  env: {
    ...process.env,
    WXT_CONVEX_URL: "https://marker-check.convex.cloud",
    WXT_WEBSITE_URL: "https://marker.example.com",
    WXT_CLERK_PUBLISHABLE_KEY:
      "pk_live_Y2xlcmsubWFya2VyLmV4YW1wbGUuY29tJA",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
