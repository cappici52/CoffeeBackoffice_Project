import "dotenv/config";
import { spawnSync } from "node:child_process";
if (!process.env.DATABASE_URL)
  throw new Error(
    "Set DATABASE_URL to a development database with schema-creation permission",
  );
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run"],
  {
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL },
  },
);
process.exitCode = result.status ?? 1;
