# Forecast implementation assessment

Target: user-supplied CoffeeBackoffice_Forecasting_Codex_Plan.md. Reviewed before refactoring on 2026-11-03.

## 1. Already matches
- React/Vite -> authenticated Node/Express -> FastAPI; PostgreSQL business data.
- Menu/day fulfilled quantities, separated simulation/demo cohorts, closed-day zero handling.
- Append-only forecast_runs / forecast_run_points, frozen input SHA, manual generation.
- Baselines, SES, direct shop-history XGBoost, prior-only rolling validation, empirical ranges.
- Recipe conversion and current-inventory subtraction already in GET /forecasts.

## 2. Reuse
- src/shop/forecast-data.ts, forecast-metrics.ts, forecast-snapshot.ts and forecasts.ts.
- Existing migrations 002/003/007/010/011/012, quality annotations and audit logs.
- forecast-service/engine_v4.py algorithms and leakage tests, existing /forecast service.
- Frontend controls, chart, CSV, saved-round selector; POS/KDS/Orders/Recipes untouched.
- Nightly locking and replay guard in src/forecast-worker.ts.

## 3. Refactor
- Default mean28 bypasses selection: change to auto with consistent XGBoost promotion guard.
- Add Last Value, lag14/mean14/std7/std28/calendar features, selection Bias and short-history fallback.
- Exclude cancelled order status explicitly, expand quality statuses, keep unknown dates unknown.
- Extract recipe/inventory recommendation service, configurable safety factor, discrete-unit rounding, shared-stock status.
- Worker currently generates only 7 days and does not require yesterday closing: schedule 1/7/30 idempotently and atomically.
- Separate stored-forecast accuracy from selection diagnostics; add per-model comparisons and concise dashboard.

## 4. Remove only after reference verification
- Interrupted, uncommitted monthly duplicate: monthly.py, test_monthly.py, monthly-forecasts.ts, migration 014_monthly_forecasts.sql and incomplete wrapper. DB inspection confirms 014 was NOT applied. Existing /forecasts and archive tables replace it.
- Legacy generation entry point can be removed only after removing its callers. Offline historical benchmark tools remain referenced research utilities, not a second production service; inspect/relabel or consolidate rather than blindly deleting data.
- Mutable forecasts remains a compatibility cache referenced by old reports/fixtures; archive is the authoritative source. Preserve cache/data until callers migrate.

## 5. Missing
- LOW_HISTORY fallback and OUTLIER/UNKNOWN quality categories.
- All-horizon closed-day scheduler and repeatable scheduling tests.
- Configurable safety allowance, preparation/product stock status, understandable unit display.
- Per-model evaluation over auditable saved predictions and full dashboard summaries.
- New genuine operational outcomes: current database mostly contains marked simulation. They cannot satisfy the specification's real-data research evidence requirement; report this limitation.

## Reference inventory
Production: src/app.ts -> src/shop/forecasts.ts -> src/shop/forecast-data.ts -> FastAPI app.py -> engine_v4.py; src/forecast-worker.ts uses generateForecasts; ingredient joins use recipe_ingredients and ingredients. Frontend Forecast.tsx / ForecastData / ForecastMonitor / forecast-view.ts. Tests forecast*, reports.test.ts, shop-replay.test.ts; scripts/browser-test.mjs, check-main-shop-replay.mjs, replay-shop-sales.mjs; Docker/CI start app:app. Offline legacy chain: evaluate_shop -> model/selection; evaluate_rolling -> coffee_demand/selection; train_external/import_projecta and their tests. Documentation: forecast-v2/v4/integration/data-review/evaluation-plan, system-design/domain-decisions, simulations and README. Applied DB migrations stop at 013; 10515 orders observed before changes.
