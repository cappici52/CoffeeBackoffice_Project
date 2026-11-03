import { Router, raw, type RequestHandler } from "express";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createRequire } from "node:module";
import type { QRCode } from "jsqr";
import type { Database } from "../db.js";
import { fail, record } from "./shared.js";
const jsQR = createRequire(import.meta.url)("jsqr") as (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) => QRCode | null;

export function paymentQrRouter(
  db: Database,
  authenticate: RequestHandler,
  cashier: RequestHandler,
  manage: RequestHandler,
) {
  const r = Router();
  r.use("/payment-qr", authenticate, cashier);
  r.get("/payment-qr", async (_req, res) => {
    const row = (
      await db.query(
        "SELECT sha256,fixed_amount_satang FROM payment_qr WHERE id='promptpay'",
      )
    ).rows[0];
    res.set("Cache-Control", "no-store").json(
      row
        ? {
            available: true,
            image_url: "/api/payment-qr/image?v=" + row.sha256,
            fixed_amount_satang: row.fixed_amount_satang,
          }
        : { available: false },
    );
  });
  r.get("/payment-qr/image", async (_req, res) => {
    const row = (
      await db.query("SELECT image FROM payment_qr WHERE id='promptpay'")
    ).rows[0];
    fail(row, 404, "NOT_FOUND");
    res
      .set("Cache-Control", "no-store")
      .type("png")
      .send(Buffer.from(row.image));
  });
  r.put(
    "/payment-qr",
    manage,
    raw({ type: "image/png", limit: "2mb" }),
    async (req, res) => {
      fail(
        Buffer.isBuffer(req.body) &&
          req.body
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        400,
        "INVALID_PAYMENT_QR",
      );
      const original = req.body as Buffer;
      let payload: string | undefined;
      try {
        const decoder = sharp(original, {
          limitInputPixels: 4_000_000,
          failOn: "warning",
        });
        const metadata = await decoder.metadata();
        fail(
          metadata.format === "png" && (metadata.pages ?? 1) === 1,
          400,
          "INVALID_PAYMENT_QR",
        );
        const { data, info } = await decoder
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        payload = jsQR(
          new Uint8ClampedArray(data),
          info.width,
          info.height,
        )?.data;
      } catch {
        fail(false, 400, "INVALID_PAYMENT_QR");
      }
      fail(payload, 400, "INVALID_PAYMENT_QR");
      const fields = new Map<string, string>();
      for (let i = 0; i < payload.length;) {
        const tag = payload.slice(i, i + 2),
          length = payload.slice(i + 2, i + 4);
        fail(
          /^\d{2}$/.test(tag) &&
            /^\d{2}$/.test(length) &&
            i + 4 + Number(length) <= payload.length &&
            !fields.has(tag),
          400,
          "INVALID_PAYMENT_QR",
        );
        fields.set(tag, payload.slice(i + 4, i + 4 + Number(length)));
        i += 4 + Number(length);
      }
      fail(
        fields.get("53") === "764" &&
          fields.get("58") === "TH" &&
          [...fields].some(
            ([tag, value]) =>
              Number(tag) >= 29 &&
              Number(tag) <= 31 &&
              value.includes("A000000677"),
          ),
        400,
        "INVALID_PAYMENT_QR",
      );
      // Validate EMV CRC without exposing the payload's recipient identifiers.
      let crc = 0xffff;
      for (const char of payload.slice(0, -4)) {
        crc ^= char.charCodeAt(0) << 8;
        for (let bit = 0; bit < 8; bit++)
          crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
      }
      fail(
        payload.slice(-8, -4) === "6304" &&
          crc.toString(16).padStart(4, "0").toUpperCase() ===
            payload.slice(-4).toUpperCase(),
        400,
        "INVALID_PAYMENT_QR",
      );
      const amount = fields.get("54");
      fail(
        amount === undefined || /^\d+(\.\d{1,2})?$/.test(amount),
        400,
        "INVALID_PAYMENT_QR",
      );
      const fixed =
        amount === undefined ? null : Math.round(Number(amount) * 100);
      fail(
        fixed === null || (fixed > 0 && fixed <= 10_000_000),
        400,
        "INVALID_PAYMENT_QR",
      );
      const hash = createHash("sha256").update(original).digest("hex");
      await db.transaction(async (sql) => {
        await sql.query(
          "INSERT INTO payment_qr(id,image,sha256,fixed_amount_satang,updated_by) VALUES('promptpay',$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET image=excluded.image,sha256=excluded.sha256,fixed_amount_satang=excluded.fixed_amount_satang,updated_by=excluded.updated_by,updated_at=now()",
          [original, hash, fixed, res.locals.user.id],
        );
        await record(
          sql,
          res.locals.user,
          "payment.qr.updated",
          "payment_qr",
          "00000000-0000-4000-8000-000000000013",
          { sha256: hash, fixed_amount_satang: fixed },
        );
      });
      res.json({ saved: true, fixed_amount_satang: fixed });
    },
  );
  return r;
}
