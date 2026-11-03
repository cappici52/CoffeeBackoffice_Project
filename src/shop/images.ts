import { Router, raw, type RequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { rateLimit } from "express-rate-limit";
import type { Database } from "../db.js";
import { ApiError, type User } from "../security.js";
import { record } from "./shared.js";

// Public catalog assets only. Never store original filenames or EXIF/GPS metadata.
export function imagesRouter(
  db: Database,
  authenticate: RequestHandler,
  manage: RequestHandler,
) {
  const router = Router();
  router.get("/menu-images/:file", async (req, res) => {
    if (!/^[a-f0-9]{64}\.webp$/.test(req.params.file))
      throw new ApiError(404, "NOT_FOUND");
    const hash = req.params.file.slice(0, -5);
    const result = await db.query(
      "SELECT data FROM menu_images WHERE hash=$1",
      [hash],
    );
    if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND");
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${hash}"`,
    });
    res.type("webp").send(Buffer.from(result.rows[0].data));
  });
  router.post(
    "/menu-images",
    authenticate,
    manage,
    rateLimit({
      windowMs: 60 * 60_000,
      limit: 30,
      keyGenerator: (_req, res) => (res.locals.user as User).id,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "TOO_MANY_REQUESTS" },
    }),
    raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new ApiError(400, "INVALID_IMAGE");
      let image;
      try {
        const decoder = sharp(req.body, {
          limitInputPixels: 25_000_000,
          failOn: "warning",
        });
        const meta = await decoder.metadata();
        if (
          !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
          (meta.pages ?? 1) !== 1
        )
          throw new Error("Unsupported image");
        image = await decoder
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new ApiError(400, "INVALID_IMAGE");
      }
      if (image.data.length > 1_048_576)
        throw new ApiError(413, "IMAGE_TOO_LARGE");
      const hash = createHash("sha256").update(image.data).digest("hex");
      await db.transaction(async (sql) => {
        const inserted = await sql.query(
          "INSERT INTO menu_images (id,hash,data,width,height,created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
          [
            randomUUID(),
            hash,
            image.data,
            image.info.width,
            image.info.height,
            res.locals.user.id,
          ],
        );
        if (inserted.rows.length)
          await record(
            sql,
            res.locals.user,
            "menu_image.upload",
            "menu_image",
            inserted.rows[0]!.id,
            {
              hash,
              bytes: image.data.length,
              width: image.info.width,
              height: image.info.height,
            },
          );
      });
      res.status(201).json({ image_url: `/api/menu-images/${hash}.webp` });
    },
  );
  return router;
}
