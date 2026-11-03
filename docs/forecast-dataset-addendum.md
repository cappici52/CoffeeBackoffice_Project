# CoffeeBackoffice — Forecast Data & Presentation Addendum

## Purpose
This file **extends**, and does not replace, `CoffeeBackoffice_Forecasting_Codex_Plan.md`.

The current CoffeeBackoffice project is already being implemented according to the original forecasting plan. **Continue that work. Do not wipe, restart, or rewrite working forecasting components.** Inspect the current working tree and implementation before changing files.

## Dataset sources

### Preferred research dataset — Mendeley Data: Anonymous Transactional Dataset
- URL: https://data.mendeley.com/datasets/kcgf45y24m/2
- DOI: 10.17632/kcgf45y24m.2
- Source description: Real-world transaction and product metadata collected by the POS system of a multi-outlet Indonesian food-and-beverage business, January–September 2025.
- License: CC BY 4.0, attribution required.
- Files listed by the source: `Transactions.csv` and `Products.csv`.
- **Before adoption, inspect actual downloaded file columns and verify that transaction date, product identity, quantities, and shop/outlet identifier (if available) support daily menu-level demand forecasting. Do not assume a field exists.** If items cannot be linked to transaction dates and quantities, explain why the dataset is unsuitable and evaluate the fallback.

### Fallback — French Bakery Daily Sales
- Primary dataset URL: https://www.kaggle.com/datasets/matthieugimbert/french-bakery-daily-sales
- A public file mirror: https://github.com/Juli27co/French-bakery-daily-sales
- Approximately 234,005 rows of bakery transactions dated January 2021–September 2022, with date, time, ticket number, article/product, quantity, and unit price.
- This is a real-world-style historical sales dataset but the original collection provenance is not independently verified. Do not call it independently verified live POS evidence. Check license and attribution before copying or redistributing the dataset.
- Bakery items are not coffee menu items. Do not silently relabel historical bakery products as coffee sales.

### Not a real-shop dataset — Maven Analytics Coffee Shop Sales
- URL: https://www.mavenanalytics.io/data-playground
- The source identifies Maven Roasters as a **fictitious** coffee shop. This dataset may be used for demo/testing, but must not be described as verified actual coffee shop transactions.

## Data modes
Implement or reuse a clear distinction between:
- `SYNTHETIC`: generated demonstration data.
- `PUBLIC_DATASET`: externally sourced historical sales used for research/evaluation.
- `REAL_OPERATIONAL`: sales actually recorded through our own CoffeeBackoffice POS.

Track source, dataset name/version, provenance, license, date coverage and import batch. Avoid changing existing enum names or database structures unless necessary. Maintain compatibility and proper migrations.

## Separate evaluation from operational sales
- **Never** import public data into production `orders` / `order_items` by default.
- Prefer an isolated research dataset import + evaluation path (separate tables/schema/storage or a documented isolated testing database).
- Avoid public dataset sales changing live inventory, payment totals, business reports or real operational metrics.
- Keep POS → daily demand → forecast → recipe → inventory recommendations intact for future `REAL_OPERATIONAL` data.
- If products lack usable recipe/ingredient mappings, display forecast and evaluation only. Recipe/stock demos should use explicitly labeled synthetic recipes or separately maintained CoffeeBackoffice data.

## Public dataset ingestion
1. Build an import/ETL script using the real CSV schema after inspection, not invented columns.
2. Normalize to business date, stable external product ID, product name, quantity and source metadata.
3. Validate date parsing, duplicates, nulls, returns/negative quantity, currency/price parsing, and store/outlet separation as relevant.
4. Aggregate daily demand by product (+ store where applicable), distinguish confirmed open-day zero sales from days with missing records, and document assumptions.
5. Record dataset provenance, source URL, original date range and transformation steps.
6. Make the importer reproducible and idempotent. Do not modify original raw data.
7. Respect original data license; do not add data files to Git unless permitted and appropriate.

## Historical replay / presentation demo (critical feature)
Create a **Historical Backtest / Replay** mode suitable for a final-project presentation:

1. Select imported external dataset, optional product, outlet, historical cutoff date and horizon (1, 7 or 30 days).
2. Build all model training and feature inputs using **only information available strictly before the forecast target period**. For example, a cutoff of `2025-09-01` means the model sees sales through `2025-08-31`, not 1 September onward.
3. Use chronological/rolling validation *within that training period* to select among baseline methods, SES and XGBoost if justified.
4. Generate and store immutable predictions with run timestamp (actual execution time), simulated cutoff (as-of date), chosen model, horizon, data source and dataset identifier.
5. Retrieve the subsequent held-out actuals **only after predictions are generated**, for scoring and graphical comparison; ensure actual future values are never included in feature generation, validation, model fitting, tuning, or model selection.
6. Show forecast vs actual chart, a per-product daily results table and MAE/RMSE/WAPE/Bias. Mark that these are **retrospective/backtest** results, not prospective live operational validation.
7. Where records for the held-out period are missing or questionable, flag or exclude appropriately; do not treat all missing days as zero.
8. Allow a complete, repeatable demo without editing the system date or altering the actual production scheduler.
9. If there is too little historical data to train XGBoost, use baselines and explain the limitation.
10. Do not manufacture high accuracy or hardcode model evaluation scores.

Suggested UI labels:
- `Historical Backtest (Public Dataset)`
- `Dataset / Source`
- `Forecast cutoff (as-of)`
- `Target date range`
- `Training window`
- `Model selected`
- `Actual vs Forecast`
- `MAE / RMSE / WAPE / Bias`
- `Limitations and data coverage`

## Separate live operational workflow
Maintain a distinct path for future genuine coffee shop sales:
- POS records completed sales.
- Forecasts for future calendar days are generated before actuals happen and saved.
- When target days are complete, saved predictions are matched against actual completed sales.
- Show `REAL_OPERATIONAL` accuracy separately, **never merge** these results with public-dataset backtests in a way that suggests they measure the same shop.
- Low-history operational mode should fall back gracefully to baseline forecasting or show insufficient-data status.

## Required experiments / presentation narrative
- **Experiment 1 — End-to-end functionality:** synthetic data to test POS, orders, daily demand, forecast, recipes, inventory and shortages.
- **Experiment 2 — Model performance:** public historical dataset with rolling validation and held-out test periods. Label it retrospective evaluation of that dataset.
- **Experiment 3 — Business scenario:** synthetic, explicitly marked recipes/inventory to show useful ingredient recommendations.
- **Optional Experiment 4 — Prospective live validation:** only if genuine new CoffeeBackoffice POS transactions become available. Never claim an external dataset is live sales from this shop.

## Tests and documentation
Test at least:
- column mapping, aggregation and zero-vs-missing days
- no future leakage at the forecast cutoff
- chronological validation and honest model selection
- immutable replay results + correct actual matching
- public/live/synthetic data isolation
- correct metrics with zeros/empty test sets
- no changes to operational orders and inventory during a public backtest

Update project documentation and presentation notes: dataset provenance, limitations, training/test dates, results and why this is a backtest rather than live proof for a newly deployed store.

## Instructions for Codex now
1. Read both this addendum and the original plan.
2. Inspect current uncommitted changes and already implemented forecast features.
3. **Do not discard current work.** Reuse the existing architecture, validation, and API endpoints.
4. Verify dataset suitability and download/access where possible. If access needs credentials or direct download is unavailable, document a manual download location and support import from a local path. Do not pretend to have loaded it.
5. Implement missing dataset ingestion / Historical Replay / provenance features incrementally.
6. Run existing and new tests and report what passes/fails.
7. Summarize file changes, how to run the demo, exact chosen data source, observed data coverage, and any unverified assumptions.

**Final goal:** Demonstrate a genuinely leakage-safe out-of-sample forecast against withheld historical transactions, while preserving the real CoffeeBackoffice POS forecasting pipeline for future live sales.
