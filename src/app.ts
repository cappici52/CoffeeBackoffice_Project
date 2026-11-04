import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { authentication } from "./auth.js";
import { usersRouter } from "./users.js";
import { ApiError } from "./security.js";
import { catalogRouter } from "./shop/catalog.js";
import { inventoryRouter } from "./shop/inventory.js";
import { stocktakesRouter } from './shop/stocktakes.js';
import { lotsRouter } from './shop/lots.js';
import { purchasingRouter } from './shop/purchasing.js';
import { transfersRouter } from './shop/transfers.js';
import { replenishmentRouter } from './shop/replenishment.js';
import { ordersRouter } from "./shop/orders.js";
import { reportsRouter } from "./shop/reports.js";
import { forecastsRouter } from "./shop/forecasts.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { guestRouter } from "./shop/guest.js";
import { tablesRouter } from "./shop/tables.js";
import { imagesRouter } from "./shop/images.js";
import { paymentQrRouter } from "./shop/payment-qr.js";
import { branchDatabase } from './branch-context.js';
import { branchMiddleware, branchesRouter } from './branches.js';
import { branchProductsRouter } from './shop/branch-products.js';

export function createApp(db: Database, config: Config) {
  db = branchDatabase(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginOpenerPolicy:
        config.NODE_ENV === "production" ? { policy: "same-origin" } : false,
      originAgentCluster: config.NODE_ENV === "production",
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "512kb" }));
  app.get("/api/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ error: "DATABASE_UNAVAILABLE" });
    }
  });
  const auth = authentication(db, config);
  app.use("/api/guest", guestRouter(db, config));
  app.use("/api", auth.router);
  app.use('/api', branchesRouter(db,auth.authenticate,auth.requireRoles('owner')));
  app.use('/api/users',usersRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  app.use('/api',imagesRouter(db,auth.authenticate,auth.requireRoles('owner')));
  app.use('/api',auth.authenticate,branchMiddleware(db));
  app.use('/api',branchProductsRouter(db,auth.requireRoles('owner','manager')));
  app.use(
    "/api",
    paymentQrRouter(
      db,
      auth.authenticate,
      auth.requireRoles("owner", "manager", "cashier"),
      auth.requireRoles("owner", "manager"),
    ),
  );
  app.get("/api/shop-context", auth.authenticate, async (_req, res) => {
    const row = (
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM orders WHERE simulation_run_id IS NOT NULL) AS contains_simulation,EXISTS(SELECT 1 FROM stock_movements m JOIN branch_stock s ON s.branch_id=m.branch_id AND s.ingredient_id=m.ingredient_id WHERE m.reason='ยอดตั้งต้นข้อมูลตัวอย่าง' AND s.counted_at IS NULL) AS contains_demo_stock",
      )
    ).rows[0];
    res.json(row);
  });
  app.use(
    "/api",
    tablesRouter(
      db,
      config,
      auth.authenticate,
      auth.requireRoles("owner", "manager"),
    ),
  );
  app.use(
    "/api",
    catalogRouter(
      db,
      auth.authenticate,
      auth.requireRoles("owner", "manager"),
      auth.requireRoles("owner", "manager", "cashier"),
    ),
  );
  app.use(
    "/api",
    inventoryRouter(
      db,
      auth.authenticate,
      auth.requireRoles("owner", "manager"),
    ),
  );
  app.use(
    "/api",
    ordersRouter(
      db,
      auth.authenticate,
      auth.requireRoles("owner", "manager", "cashier"),
    ),
  );
  app.use(
    "/api",
    reportsRouter(
      db,
      auth.authenticate,
      auth.requireRoles("owner", "manager"),
      auth.requireRoles("owner"),
    ),
  );
  app.use(
    "/api",
    forecastsRouter(
      db,
      config,
      auth.authenticate,
      auth.requireRoles("owner", "manager"),
    ),
  );
  app.use('/api',stocktakesRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  app.use('/api',lotsRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  app.use('/api',purchasingRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  app.use('/api',transfersRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  app.use('/api',replenishmentRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  const frontend = resolve("dist/client");
  if (existsSync(frontend)) {
    app.use(express.static(frontend));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res
        .set("Cache-Control", "no-store")
        .sendFile(resolve(frontend, "index.html"));
    });
  }
  app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        issues: error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
      return;
    }
    if (typeof error === "object" && error !== null) {
      if ("code" in error && error.code === "23505") {
        res.status(409).json({ error: "ALREADY_EXISTS" });
        return;
      }
      if ("code" in error && error.code === "23503") {
        res.status(409).json({ error: "REFERENCE_IN_USE_OR_MISSING" });
        return;
      }
      if ("code" in error && error.code === "23514") {
        res.status(400).json({ error: "INVALID_VALUE" });
        return;
      }
      if ('code' in error && error.code === 'P9001') {
        res.status(409).json({error:'EXPIRED_OR_INSUFFICIENT_LOT_STOCK'});return;
      }
      if ('code' in error && error.code === '42501') {
        res.status(403).json({error:'BRANCH_PERMISSION_REQUIRED'});return;
      }
      if ("type" in error && error.type === "entity.too.large") {
        res.status(413).json({ error: "BODY_TOO_LARGE" });
        return;
      }
      if ("type" in error && error.type === "entity.parse.failed") {
        res.status(400).json({ error: "INVALID_JSON" });
        return;
      }
    }
    // Do not log request bodies, cookies, SQL parameter values or password validation inputs.
    console.error(
      "Unhandled API error",
      error instanceof Error ? error.name : "UnknownError",
    );
    res.status(500).json({ error: "INTERNAL_ERROR" });
  };
  app.use(handleError);
  return app;
}
