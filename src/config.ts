import "dotenv/config";
import { z } from "zod";

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      APP_ORIGIN: z.url().default("http://localhost:3001"),
      PUBLIC_ORIGIN: z.url().optional(),
      DATABASE_URL: z.string().startsWith("postgres").min(15),
      SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
      FORECAST_SERVICE_URL: z.url().default("http://127.0.0.1:8001"),
    })
    .parse(env);
  const origin = new URL(config.APP_ORIGIN);
  if (
    origin.origin !== config.APP_ORIGIN ||
    !["http:", "https:"].includes(origin.protocol)
  ) {
    throw new Error(
      "APP_ORIGIN must be an HTTP(S) origin without a path or trailing slash",
    );
  }
  if (config.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error("Production APP_ORIGIN must use HTTPS");
  }
  if (config.PUBLIC_ORIGIN) {
    const guest = new URL(config.PUBLIC_ORIGIN);
    if (
      guest.origin !== config.PUBLIC_ORIGIN ||
      !["http:", "https:"].includes(guest.protocol)
    )
      throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin without a path");
    if (config.NODE_ENV === "production" && guest.protocol !== "https:")
      throw new Error("Production PUBLIC_ORIGIN must use HTTPS");
  }
  return config;
}
export type Config = ReturnType<typeof readConfig>;
