# Multi-branch architecture and operations

Implemented against [the supplied target specification](multi-branch-target-spec.md) and [implementation plan](multi-branch-implementation-plan.md). Forecast experimentation is paused. Node remains the application backend, FastAPI remains the forecasting service, and PostgreSQL remains the business source.

## Schema and legacy mapping

Migration `016_branches.sql` adds `branches`, `user_branches`, independent `branch_stock` balances and optional `branch_products` overrides. Three editable records bootstrap the system; no branch-count limit exists. Creating a fourth is tested.

The formerly undivided workspace is explicitly retained as **LEGACY / สาขาเดิม**, not attributed to a guessed physical address. Existing IDs, timestamps, quantities, payments, stock and relationships stay there. Existing non-owner employees retain access through explicit legacy memberships. Two new branches start without transactions and with zero stock; no historical sales or balances are distributed among them.

Branch columns cover orders/children, payments, movements, dining tables, closings, sales summaries, operational forecast archives/points/cache/jobs/quality, audit logs and simulation provenance. Defaults backfill metadata without UPDATEs to append-only forecast payloads. Composite foreign keys reject cross-branch parent references. Date/product/job/table-name/PromptPay uniqueness becomes branch-specific where needed. Existing migrations and data are preserved.

Products, recipes/options, ingredient units/costs and photos remain central. Security-invoker views `branch_catalog` and `stock_ingredients` apply price/availability overrides and branch balances/reorder levels. New branches/ingredients initialize zero balances, except preserved legacy stock. The old `ingredients.current_stock` remains a mirrored legacy compatibility field, not the multi-branch source. New branches' forecast start dates cannot precede branch/product creation.

## Permission model

| Role | Branch scope | Administration |
|---|---|---|
| owner | All branches and consolidated reports | Branch metadata/status, memberships, users and central masters |
| manager | Assigned branches; consolidated over assignments only | Assigned inventory/thresholds, menu overrides, existing staff-management permissions |
| cashier | Assigned active branches | POS/orders/payments according to existing permissions |
| kitchen | Assigned active branches | KDS without financial fields |

Branch creation/membership assignment remain owner-controlled. Managers view details/rosters and manage operations. A manager cannot alter staff assigned outside that manager's scope. Newly created non-owner accounts receive the creator's selected authorized branch; additional assignments are explicit. An unassigned employee can authenticate but cannot access operations.

The frontend sends `X-Branch-Id`; EventSource and PromptPay image URLs use `branch_id` when headers are unavailable. Backend membership validation is authoritative. Missing selection preserves the first authorized active branch for old clients. All-branch operational scope is read-only reporting, not checkout, stock mutation, day close or operational forecast generation; global owner administration is separate.

`branchDatabase` uses AsyncLocalStorage, transaction-local settings and `SET LOCAL ROLE coffee_branch_runtime`. That role is a non-owner/non-superuser without BYPASSRLS. Transactions reset scope on commit/rollback and recheck activation/access, including SSE polling. Aggregate IDs come from current permissions. Central master writes require owner authority. [PostgreSQL documents that superusers bypass RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html); tenant queries explicitly change execution role rather than assuming an administrative connection is protected.

Guest table tokens resolve their branch server-side, ignoring forged branch headers/body fields. Tracking resolves the stored order branch. Inactive branches reject mutations/new QR orders; authorized owner/manager historical reads and existing guest tracking remain available. PromptPay recipient images/settings do not fall back to another branch.

## Interface and workflows

* Sidebar branch selection confirms discarded drafts/cart state, prevents switching during a pending mutation, aborts stale resources and remounts operational pages/SSE.
* **สาขา** manages details/status and employee assignments. Deactivation retains history; no branch-delete action exists.
* **เมนูประจำสาขา** overrides prices/availability. Blank/inherited settings use central defaults. Central recipe/menu editing remains owner-controlled; managers view recipes read-only.
* Orders retain idempotency, price/recipe snapshots, payment-after-dining, KDS transitions, refunds and stock-return rules. Shared advisory catalog locks preserve snapshots without locking nullable views, while allowing simultaneous sales across branches. Atomic deductions update only the order's branch balance.
* Reports use stored orders/payments and date filters, with per-branch placed/paid counts, revenue/low-stock counts and consolidated totals. Existing profit permissions remain. Empty branches display zero revenue/orders and empty charts, not sample transactions; shared ingredient definitions may exist at zero stock.

## Forecast compatibility

The Python production model, selection rules, artifacts and research results are unchanged. Operational histories, quality, closings, stock planning, caches and archives are branch-scoped. Explicit current-branch SQL filters also protect privileged legacy history callers against accidental pooling. The worker iterates active branches independently and job keys include branch. New branches cannot borrow legacy history/stock/closings.

Historical Replay/public datasets remain separate research tables and issued archives stay immutable. Consolidated operational forecasting is intentionally absent: select one branch. No public/synthetic history is relabeled as genuine outcomes.

## Rollout and safety

The migration was tested on a restored PostgreSQL copy. Fingerprints of all 32 original non-migration tables matched before/after, excluding only new branch metadata. The same check passed on the application database, now at migration 16. Actual cleanup has **not** run; see [the audit and approval gate](operational-data-cleanup.md).

```powershell
npm run db:backup
npm run db:verify-backup -- .local/backups/<snapshot>.dump
npm run db:migrate
npm run build
npm run local
```

Migration requires an administrator able to provision the runtime role/schema grants. Verification creates a new isolated database and compares every row count and migration checksum, without deleting rows/schemas or changing source privileges. Because archives use `--no-acl`, an explicitly approved actual recovery separately reinstalls runtime grants and revokes restored sessions. The verifier deliberately does neither. Do not use the destructive recovery command as a verification shortcut.

Normal server/local/Docker startup never invokes demo creation. Optional demo/replay commands are restricted to isolated targets, including generated E2E schemas. Branch metadata/zero balance initialization is system configuration, not fabricated transactions.

## Modified areas

* Schema: `migrations/016_branches.sql`.
* Backend: branch context/management, app/auth/users, branch-product settings; existing catalog/inventory/orders/guest/shared/reports/PromptPay/forecast data-planning routes; worker and operational checks.
* Frontend: branch provider/selector, branch and branch-menu pages; shell/API client, inventory/users/reports, types/styles.
* Safety: demo-isolation guard, audit/read-only cleanup scripts, backup verification/recovery grants, native migration check; optional replay, retained-schema browser QA and Docker CI configuration.
* Tests: branch operations, legacy preservation, demo isolation; explicit fixture memberships, stronger Replay instrumentation and browser branch flows.
* Documentation: target/plan, this guide, cleanup report, README, DESIGN.md and UX-CONTRACT.md. No Python engine/artifact/evaluation files changed.

## Current extension and limits

The authorized warehouse extension now implements immediate atomic stock transfers, suppliers/partial purchase receipts, expiry-aware lots, branch valuation and operating expenses. See [current completion status](project-completion-status.md) for permissions, preservation checks and limits. Account roles and menu/recipe units remain central; per-branch role variation and in-transit shipping are not implemented.

The separately approved operational simulation cleanup is complete. Nine unmarked orders, ten pending-count opening receipts and all forecasting/research evidence remain. Physical counting, actual user acceptance and physical printer validation are still pending because participants/devices/counts were not supplied. Verification databases and QA schemas remain retained. Local concurrency measurements exist, but no external deployment or production-scale capacity certification is claimed.
