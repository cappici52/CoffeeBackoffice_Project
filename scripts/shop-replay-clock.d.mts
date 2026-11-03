import type { Database } from "../src/db.js";
export function replayQuery(
  text: string,
  values: unknown[] | undefined,
  instant: string,
  runId: string,
): { text: string; values: unknown[] | undefined };
export function replayDatabase(
  db: Database,
  getInstant: () => string,
  runId: string,
): Database;
