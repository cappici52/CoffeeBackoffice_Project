import "dotenv/config";
import { readFile } from "node:fs/promises";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: node scripts/set-promptpay-image.mjs PATH_TO_ORIGINAL_PNG",
  );
const base = process.env.APP_ORIGIN ?? "http://localhost:3001";
if (!process.env.SEED_OWNER_EMAIL || !process.env.SEED_OWNER_PASSWORD)
  throw new Error("Configure the shop owner login locally first");
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
  }),
});
if (!login.ok) throw new Error("Owner login failed: " + login.status);
const cookies = login.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
const image = await readFile(path);
const response = await fetch(base + "/api/payment-qr", {
  method: "PUT",
  headers: { Origin: base, Cookie: cookies, "Content-Type": "image/png" },
  body: image,
});
if (!response.ok)
  throw new Error(
    "QR update failed: " +
      response.status +
      " " +
      (await response.json()).error,
  );
const result = await response.json();
console.log(
  JSON.stringify({
    saved: result.saved,
    original_bytes: image.length,
    fixed_amount_satang: result.fixed_amount_satang,
  }),
);
