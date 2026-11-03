# Forecasting v5 — implementation and operating contract

This is the active contract. [Target specification](forecast-target-spec.md) is the user-supplied specification; [pre-change assessment](forecast-implementation-assessment.md) records the repository audit before edits. Earlier v2/v4 documents and their measured results remain historical evidence, not active instructions.

## Architecture

React/Vite → authenticated Node/Express → PostgreSQL demand extraction → FastAPI `app.py` → `engine.py` → Node validation and append-only PostgreSQL archive → dashboard / recipe and inventory plan.

There is one production ML service and one generation route. FastAPI has no business-database credentials. Node owns authorization, quality/cohort selection, input checksums, persistence, audit, recipe conversion and stock access. Existing POS, Orders, KDS, financial reports and payment behavior remain unchanged.

## Demand and quality

- Target: completed order-item units per product and Bangkok delivery date (`orders.completed_at`, order status `completed`). Cancelled orders are excluded, including orders subsequently marked cancelled. Served but unpaid completed orders still count as demand; reports remain payment based.
- Use at most 180 calendar days ending yesterday. Only closed-day actual observations enter training. Eligible menus with no deliveries on a closed day have a recorded zero; missing/unclosed days remain absent, not zeros. Product eligibility uses `forecast_since` or the preserved replay-product manifest.
- Cohorts are genuine (unmarked), simulation and explicit demo. Never combine them. Auto prefers a mature genuine cohort, then mature simulation, then explicitly enabled demo; with no mature cohort it uses a cohort with recent observations. Explicit genuine never falls back to simulation.
- Existing quality codes map to the spec: `normal` = GOOD, `incomplete` = INCOMPLETE, `stockout` = STOCKOUT, `closed` = SHOP_CLOSED, `outlier` = OUTLIER, `unknown` = UNKNOWN. All flagged days are excluded from fitting/evaluation. Manual edits require owner/manager, reason and audit. This is a quality annotation, not an edit to sales.
- Known future closures override newly generated points to zero, with no invented range. Retrospective analysis only applies future-closure annotations recorded by its cutoff. Unknown, zero-history or stale menus produce an actionable error; 1–27 usable observations use a recent-mean fallback, without fictional validation scores/ranges. Users may select an established menu independently of a menu with no history.

## Models, selection and leakage controls

Candidates: Last Value, Last Matching Weekday, Mean 7, Mean 28, Weekday Mean, SES (alpha .2), and direct Poisson XGBoost. The default is automatic selection; explicit Mean 28 / weekly policies are identified separately in archive metadata.

XGBoost uses product, observed lag 1/7/14/28, observed means 7/14/28, standard deviations 7/28, observation count, matching-weekday mean, target weekday/day/month/week/weekend, lead and latest past positive-sale price. Target calendar is known in advance. Prices and quantities after the origin cannot enter features. Missing calendar lags remain missing. This is direct lead prediction, not recursion using guessed sales as observations.

Selection uses prior-only rolling origins per product and horizon: 14 daily, four weekly or two monthly origins, skipping folds with inadequate history. Each available candidate sees the same observed targets. Statistical candidates need a 1% MAE improvement over weekly repetition. XGBoost additionally needs at least two paired folds, wins on ≥60% of them, and ≥5% MAE improvement over the best statistical candidate. A baseline is allowed to win. Insufficient validation uses a declared basic fallback.

When possible, reserve the final 30 historical target days for calibration, after selection; require ≥28 earlier observations and ≥20 calibration outcomes per menu. Empirical absolute-error 80% ranges use the finite-sample rank. They are not parameter confidence intervals, guaranteed future coverage, or a calibrated shop-total band when endpoints are summed. Otherwise bounds are null. The dashboard reports subsequent realized coverage when enough saved predictions mature.

Hyperparameters remain fixed: Poisson, depth 3, eta .06, min child weight 5, lambda 5, seed 42, 120 rounds, two threads. Features are memoized **within a fixed request** across folds; neither targets nor models are shared across incompatible requests. The small result cache keys the complete serialized input and policy. Standalone tests prove that production imports do not require legacy artifacts.

## Persistence, accuracy and retrospective diagnostics

Reuse `forecast_runs`, `forecast_run_points`, `forecast_day_quality`, `forecast_jobs`; no duplicate monthly tables. Migration **014** expands quality codes, adds `planning_snapshot`, and makes scheduled jobs unique by date+horizon with an optional archived run link. Existing data is retained. Existing triggers keep issued runs/points immutable. The mutable `forecasts` table remains a compatibility cache referenced by existing code; it is not the accuracy authority.

Each new round records issue time, target range, input snapshot/SHA-256, source cohort, quality exclusions, pipeline/policy, per-point method/version/lead, selection diagnostics, ranges and a recipe/stock planning snapshot. Manual targets must be in the future. A new run never rewrites an old run.

Accuracy uses forecasts issued before the target business date, matched to eligible closed-day outcomes in the same cohort. It uses the earliest issued prediction per target/menu/lead/pipeline/cohort/**generated scope**, so repeated clicks cannot multiply samples and 1/7/30-day rounds stay distinguishable. MAE, RMSE, WAPE, Bias and optional nonzero-only MAPE are computed, never hardcoded. Zero-total WAPE and missing samples remain unavailable. Evaluation separates genuine/simulation/demo, pipelines, products, methods, exact generated scopes, and cumulative lead windows. XGBoost hashes remain on points; method comparison groups hashes into their v4/v5 family. Different model rows need not have identical targets and are not a fair leaderboard by themselves.

`POST /api/forecasts/backtest` is an explicitly **retrospective diagnostic**, using the same extraction/service/validation path with a cutoff and 30/90/180-day input window. Outcome rows are fetched separately after prediction. It records an audit event and returns downloadable results; it **does not** create issued runs/points/cache entries, backdate issue times, or inflate prospective accuracy. Rolling selection scores are not independent test scores.

## APIs and scheduler

Existing equivalent APIs are reused rather than duplicated:

| Purpose | API |
|---|---|
| Generate | `POST /api/forecasts/generate` with `{horizon:1|7|30}` or existing future date range |
| Latest/history/accuracy/planning | `GET /api/forecasts?date_from=...&date_to=...` (optional product, run, lead, data mode, safety factor) |
| Archive detail and reproducible input | `GET /api/forecasts/runs/:id` |
| Dataset readiness | `GET /api/forecasts/data` |
| Quality annotation | `PUT /api/forecasts/quality` |
| Retrospective diagnostic | `POST /api/forecasts/backtest` |
| Internal ML | FastAPI `POST /forecast`, `GET /health` |

Worker runs every minute, after 02:00 Bangkok only, requires yesterday's closing, and skips active/unrolled failed sales replays. It creates 1/7/30-day rounds for tomorrow onward in a single transaction under an advisory lock, with date+horizon idempotency. A failed batch rolls back runs/cache/jobs together and retries later. A missing closing waits; the worker never closes the shop on behalf of staff. Run with `npm run forecast:worker`, or `npm run local:lan` starts it with the local stack.

## Dashboard and preparation

- Minimal dark UI retains shared controls; long methodology, data quality and monitoring text is collapsed. Simulation provenance remains visible as a short disclosure with details.
- Tomorrow quantity and change against the immediately preceding seven **complete, closed** business days; no percentage when history is incomplete or its mean is zero.
- Sorted menu plan, daily actual/forecast chart, 1/7/30 choices, menu/model/range details, measured per-product MAE and shared-stock status.
- Calendar-month navigation and UTF-8 CSV preserve unknown quantities as empty cells and source labels. Viewing up to 367 days is independent of the fitting window.
- Base recipe quantities × forecast × configurable safety factor, aggregated across menus, minus current stock. Countable ingredients round up. Millilitres/grams display as litres/kilograms at appropriate sizes. Shortages affect all menus sharing that ingredient; no recipe is explicitly identified.
- `FORECAST_SAFETY_FACTOR=1` by default; allowed range 1–2. A per-view percentage control can override it. Live planning recalculates stock; archived `planning_snapshot` preserves issue-time context. Suggestions do not purchase or deduct stock automatically. Optional recipe substitutions, lead times, expiry and supplier pack sizes are not modeled.

## Verification and evidence limits (2026-11-03)

- Typecheck and production build passed.
- 98 tests passed on PostgreSQL 18 and on the portable PGlite database; 41 Python tests passed. Coverage includes cutoff boundaries, future feature exclusion, cohort/quality separation, insufficient data, immutable history, baseline comparison, recipe conversion, scheduler closing/idempotency/atomic rollback, and complete-day summary arithmetic.
- 27 isolated browser workflow groups passed, including POS, orders, KDS, PromptPay manual payment, pay-after-dining, recipes, inventory, reports, roles and QR customer ordering. Main-shop checks preserve the old 240-pair report and verify month/CSV, new rounds, responsive layout and WCAG checks. Strict UI design audit reported no findings.
- Existing sales/payments were not replayed or regenerated. A verified private database backup preceded migration 014. Only new future forecast rounds and retrospective audit events were added in the main shop.
- A fixed retrospective diagnostic using **marked simulation**, cutoff 2026-10-02, targets October 3–November 1, yielded 240 pairs: MAE **2.9986**, RMSE **3.8136**, WAPE **40.6819%**, Bias **−0.3443**; empirical range coverage **73.75%**. These are measurements, not impressive accuracy claims. The old archive/report remains unchanged. Do not tune selection thresholds against this already observed test window.
- On this machine, first verified full-menu 1/7/30-day generation took about **5.0/2.2/3.3 seconds** after feature memoization; timings are not a performance guarantee.

Remaining evidence/TODOs: collect independent genuine customer sales and future outcomes; pre-register an untouched time period before any further tuning. Current business data is mainly marked simulation and cannot fulfill the spec's real-data research claim. There are no matured prospective v5 outcomes yet, so current-version issued accuracy correctly shows “—”. Historical diagnostics reconstruct sales by delivery date from the current ledger, not a bitemporal database of every past edit; old issue-time snapshots remain the authoritative evidence of what was actually known. Promotions/holidays/weather are optional and not integrated. All-menu generation still requires at least one usable recent observation for each requested menu; a completely new menu must be selected/excluded explicitly rather than assigned invented sales.

## Changed-file map

| Files | Change |
|---|---|
| `forecast-service/app.py`, `engine.py` (renamed from `engine_v4.py`) | Single production engine, feature set, fallbacks, validation/selection and per-request feature memoization |
| `forecast-service/test_engine.py` (renamed), `evaluate_shop.py` | Critical engine tests and offline benchmark import |
| `src/shop/forecasts.ts` | Shared compute path, future archive generation, retrospective diagnostics, accuracy slices and planning/summary response |
| `src/shop/forecast-data.ts` | Completed-only source, quality/cohort and short-history readiness |
| `src/shop/forecast-planning.ts`, `forecast-summary.ts` | Recipe/shared-stock arithmetic and complete-day summary |
| `src/forecast-scheduler.ts`, `forecast-worker.ts` | Closed-day 1/7/30 atomic schedule |
| `src/config.ts`, `.env.example` | Configurable safety factor |
| `migrations/014_forecast_operations.sql` | Additive operations schema migration |
| `client/App.tsx`, `client/lib.ts`, `client/types.ts` | Compact source disclosure, request/errors and typed contract |
| `client/pages/Forecast.tsx` | Automatic defaults, preparation, metrics and concise controls |
| `client/components/ForecastBacktest.tsx`, `ForecastData.tsx`, `ForecastMonitor.tsx` | Cutoff analysis and collapsed quality/evaluation panels |
| `tests/forecast.test.ts`, `reports.test.ts` | Controller, cancellation, protocol and leakage regression tests |
| `tests/forecast-planning.test.ts`, `forecast-scheduler.test.ts`, `forecast-summary.test.ts` | Critical integration/math/schedule checks |
| `scripts/browser-test.mjs`, `check-main-shop-replay.mjs` | Whole-app and main-shop browser regression/analysis checks |
| `README.md`, `DESIGN.md`, `docs/forecast-*.md`, `docs/operations.md` | Current contract, assessment, retained historical-document notices and operating guidance |

## Removal/reference audit

The unused FastAPI `pipeline=legacy` production branch was removed after Node's sole production caller moved to v5; the new standalone test imports only `app.py`, `engine.py`, `forecast_errors.py`. Active engine v4 was **renamed and refactored**, not replaced with a parallel service. Legacy `model.py`, `coffee_demand.py`, `selection.py`, artifact metadata and their tests remain referenced by offline `evaluate_shop.py`, `evaluate_rolling.py`, `train_external.py`, `import_projecta.py`; they are research/parity utilities, not dead production services. Removing them would break those references.

The interrupted, uncommitted monthly service/controller/migration and incomplete page wrapper were removed only after reference inspection and verifying their migration had never been applied. Unified daily generation and cutoff diagnostics replace that duplicate path without new monthly tables. No applied migration, archive or business table was deleted. Read-only compatibility data and historical documentation are deliberately preserved.

## Public dataset extension

The [dataset addendum](forecast-dataset-addendum.md) adds an isolated public POS historical replay using the existing v5 engine. Read [Public Dataset Replay](public-dataset-replay.md) for verified Mendeley source/schema, migration 015, exclusive target-start cutoff, immutable research records, presentation commands, measured outcomes and limitations. The earlier simulation-only evidence limits above describe the initial v5 release; the new public retrospective evidence remains separate from prospective genuine-shop accuracy. Existing operational archives, source cohorts, scheduler and recipe/inventory planning are retained.
