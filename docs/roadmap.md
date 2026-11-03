# Core release roadmap

Requirements: [source specification](coffee-shop-backoffice-spec.md). Operational authorization comes from the user. Core phases 1–7 are implemented, and the supplied ProjectA forecast model is connected; each task is checked, committed and pushed separately.

- [x] Foundation: TypeScript API, PostgreSQL, sessions, roles and user administration
- [x] Categories, menus, images, options, availability, station and target prep times
- [x] POS, unpaid orders, cash/manual PromptPay, idempotent checkout and browser receipts
- [x] KDS, timers, selected recipes, per-item progress, station filter, notifications and reconnecting SSE
- [x] Recipes, ingredient substitutions, transactional stock deduction, receipts, waste and low stock
- [x] Sales, menu/hourly/preparation-time reports, owner-only gross margins and day closing
- [x] Separate FastAPI model adapter with shop-history training/selection, persisted/versioned predictions, charts, base-recipe replenishment, metrics and nightly worker
- [x] Thai minimal dark-only React UI; shared design/interaction contracts
- [x] Local PostgreSQL 18 connection and a separate coffee_backoffice database
- [x] Table QR extension requested by user: printable/manageable QR, public menu, unpaid guest orders, private order tracking and staff queue badge
- [x] Unit/integration/browser checks and CI including Docker runtime smoke checks
- [x] Own-photo uploads with decoded/metadata-free WebP storage, permission checks and mobile preview
- [x] Snapshot database backups, SHA-256 manifests, restore into new databases only, recovery drill and read-only operations check
- [x] Original CC0 Coffee Sales data: reproducible offline training, chronological holdout, de-identified daily dataset and native model. Candidate was not promoted after losing to the validation-selected baseline; see coffee-sales-evaluation.md.

## External inputs still needed

Technical handover is documented in `system-design.md`, `operations.md`, `acceptance-plan.md` and `forecast-evaluation-plan.md`. Automated checks cover implementation and recovery. Actual-device acceptance and user evaluation are explicitly pending rather than presented as fabricated results.

- Sufficient real coffee-shop daily sales history for independent accuracy evaluation. The supplied model and new shop-history training are connected; demo-backed results are labeled and cannot establish operational accuracy.
- A payment provider, actual printer model or IoT hardware only if the user later requests those direct integrations. Initial scope records payment manually and prints via browser.

## Optional later phase 8

Membership/points, shifts, suppliers/purchase orders, expenses, multiple branches and IoT remain optional extensions. Table QR ordering has now been implemented as explicitly requested.

## Maintained decisions

- Single branch and Asia/Bangkok dates; money in integer satang.
- Minimal dark UI as requested; see ../DESIGN.md.
- PostgreSQL transactions, auditable writes, immutable order snapshots and request-key deduplication.
- Manager manages cashier/kitchen only; kitchen has KDS-only domain access.
- Forecast recommendations use base recipes and retain method/version and demo/actual history provenance; no invented confidence bounds. See forecast-integration.md.
