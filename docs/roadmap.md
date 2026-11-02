# Core release roadmap

Requirements: [source specification](coffee-shop-backoffice-spec.md). Operational authorization comes from the user. Core phases 1–7 are implemented with the permitted mock forecast; each task is checked, committed and pushed separately.

- [x] Foundation: TypeScript API, PostgreSQL, sessions, roles and user administration
- [x] Categories, menus, images, options, availability, station and target prep times
- [x] POS, unpaid orders, cash/manual PromptPay, idempotent checkout and browser receipts
- [x] KDS, timers, selected recipes, per-item progress, station filter, notifications and reconnecting SSE
- [x] Recipes, ingredient substitutions, transactional stock deduction, receipts, waste and low stock
- [x] Sales, menu/hourly/preparation-time reports, owner-only gross margins and day closing
- [x] Separate FastAPI mock, persisted/versioned predictions, charts, base-recipe replenishment, metrics and nightly worker
- [x] Thai minimal dark-only React UI; shared design/interaction contracts
- [x] Local PostgreSQL 18 connection and a separate coffee_backoffice database
- [x] Table QR extension requested by user: printable/manageable QR, public menu, unpaid guest orders, private order tracking and staff queue badge
- [x] Unit/integration/browser checks and CI including Docker runtime smoke checks

## External inputs still needed

- Real model artifact, dependencies, sample input/output and training-data format. Loading and retraining the actual model cannot be completed before these are supplied. The mock adapter is fully runnable.
- A payment provider, actual printer model or IoT hardware only if the user later requests those direct integrations. Initial scope records payment manually and prints via browser.

## Optional later phase 8

Membership/points, shifts, suppliers/purchase orders, expenses, multiple branches and IoT remain optional extensions. Table QR ordering has now been implemented as explicitly requested.

## Maintained decisions

- Single branch and Asia/Bangkok dates; money in integer satang.
- Minimal dark UI as requested; see ../DESIGN.md.
- PostgreSQL transactions, auditable writes, immutable order snapshots and request-key deduplication.
- Manager manages cashier/kitchen only; kitchen has KDS-only domain access.
- Forecast recommendations use base recipes and label mock/demo data explicitly.
