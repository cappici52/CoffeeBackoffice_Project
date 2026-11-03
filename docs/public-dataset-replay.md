# Public dataset Historical Replay

This extends [Forecast v5](forecast-v5.md), the [original target specification](forecast-target-spec.md), and the [dataset addendum](forecast-dataset-addendum.md). The existing operational engine, scheduler, POS and synthetic workflow replay are retained.

## What was already implemented, and what was missing

V5 already had baselines/SES/direct XGBoost, prior-only rolling selection, empirical ranges, immutable operational archives, quality/source separation, recipes, inventory plans, monthly history/CSV, and an operational retrospective diagnostic. Reuse those algorithms, metrics, snapshot serializer, authentication, chart and shared UI controls.

Missing parts were a verified public-data importer, external provenance/product/outlet identities, immutable **research** replay records, exclusive public cutoff semantics, and a dedicated presentation screen. The addendum adds these without importing external sales into the operational ledger or creating a second ML service. The existing `POST /api/forecasts/backtest` dispatches to the research path only when `dataset_id` is supplied.

## Selected source and suitability assessment

Selected **Anonymous Transactional Dataset, Mendeley Data V2**, DOI **10.17632/kcgf45y24m.2**: [publisher page](https://data.mendeley.com/datasets/kcgf45y24m/2). The deposit describes internal POS records from an Indonesian F&B business. This is publisher-described provenance; we have not independently audited that business. License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution is stored with the import and available in the UI/export:

Engel, Mychael Maoeretz; Gaol, Ford Lumban; Kurniawan, Aditya; Budiharto, Widodo (2026), *Anonymous Transactional Dataset*, Mendeley Data, V2, doi:10.17632/kcgf45y24m.2. Changes: validation, item-token mapping, outlet/day aggregation and explicitly identified inferred zero rows.

Actual downloaded files were inspected **before** writing the importer. Both SHA-256 values matched Mendeley's public file metadata; verified file hashes and inspection counts are in [mendeley-verification.json](research/mendeley-verification.json). Raw/prepared data stays under ignored `.local/public-datasets/`, outside Git. No account, payment or customer identifiers are included in normalized data.

| Observed file | Actual columns |
|---|---|
| Transactions.csv | Outlet, Date, Time, NetSales, Tax, TotalAmount, ReceiptNumber, Items, TotalItem, PaymentMethod, UseLoyaltyCard |
| Products.csv | ProductId, ProductName, Variant, Category, Price, Description |

Observed coverage: **53,820 unique receipts**, **61,973 reconciled item occurrences**, **96 metadata products** (94 observed), **3 outlets**, **272 receipt-active days per outlet**, **2025-01-02–2025-09-30**. No missing full outlet dates within that range. No duplicate receipts, null fields, unmatched item tokens, negative amounts, or list-length/TotalItem discrepancies were found in the adopted files. Prepared output: **76,435 product/outlet/day rows**, including **35,646 inferred zeros**.

The source is suitable for predicting **recorded item occurrences**: every item token maps exactly to ProductName plus Variant, and each receipt's token count equals TotalItem. The source has no separate per-item quantity column, so we do not claim independently verified physical cups. Products retain their original names/variants; they are never relabeled as CoffeeBackoffice menus.

The French Bakery fallback was not needed because the preferred source passed schema/linkage/access checks. It was not downloaded, imported or benchmarked. If a different source becomes necessary, verify its actual schema/license/provenance and add a separately versioned adapter; never silently substitute bakery articles for these products. Maven's fictitious shop data is not used as real POS evidence.

## Reproducible ETL and import

From the repository root, with Python, Node and the existing `.env` configured:

```powershell
npm run db:backup
npm run db:migrate
npm run dataset:prepare -- --download
npm run dataset:import -- .local/public-datasets/mendeley-kcgf45y24m-v2/prepared.json
```

ETL uses only Python's standard library. `--download` uses Mendeley's public file-list links, verifies pinned publisher hashes, and does not overwrite existing raw files. If access is unavailable, download **Transactions.csv** and **Products.csv** manually from the publisher into `.local/public-datasets/mendeley-kcgf45y24m-v2/raw/`, then run `npm run dataset:prepare` without `--download`. A custom directory is supported with `--directory C:/path/to/dataset`; place raw files in its `raw/` subdirectory and pass its `prepared.json` to the import command. Changed raw hashes require inspection and an explicit new version, not bypassing validation.

Transformation:

1. Validate exact headers, dates/times, required values and finite nonnegative numeric money fields. Currency is not stated by the files, so no currency conversion is assumed.
2. Identify receipts by outlet+ReceiptNumber. Skip exact duplicates with a recorded count; reject conflicting duplicate receipts.
3. Split Items by the observed separator, match exact product+variant names, and reconcile with positive TotalItem. Reject ambiguous quantities/unmapped products rather than guessing or silently dropping them.
4. Derive stable external UUIDs from source DOI and ProductId. Keep outlet identity. Aggregate item occurrences by date/product/outlet.
5. After the first recorded occurrence of a product at an outlet, a receipt-active date without that product gets `inferred_zero`. A full outlet date without receipts stays missing. These zeros describe recorded sales, not proven stock/menu availability. Future product introductions cannot create earlier training observations.
6. Exclude static catalogue prices and basket money from model inputs (`unit_price=0`); they are not historical item prices and could leak later metadata.
7. Store hashes, transformation version, source, license, attribution, coverage, quality assumptions and import timestamp. The dataset identity derives from raw hashes plus transformation version. Node checks normalized keys, counts and quantity conservation, inserts atomically, and refuses a changed prepared payload under an existing identity. Reimporting the same payload returns `imported:false`.

## Isolation and architecture

| Data purpose | Existing/new representation |
|---|---|
| SYNTHETIC | Existing `simulation`/`demo` cohorts and marked end-to-end workflow replay |
| PUBLIC_DATASET | New `research_datasets`, `research_daily_demand`, `research_replay_runs`, `research_replay_points` |
| REAL_OPERATIONAL | Existing genuine, unmarked completed CoffeeBackoffice order deliveries and prospective forecast archive |

Migration **015_public_dataset_replay.sql** only adds the four research tables and indexes/triggers. External products have **no foreign key to operational products**, and the public path never invokes recipe planning or writes orders, payments, movements, closings or operational forecasts. Dataset metadata/demand and replay runs/points are append-only. The normalized dataset is immutable; a transformation change creates a new import identity.

Node remains the authenticated business/API layer and PostgreSQL the stored source. Shared `forecast-client.ts` validates FastAPI requests/responses for both paths. FastAPI still runs the same `engine.py`, with a distinct `public_dataset` cohort in diagnostics. No second engine, external retailer predictor or scheduler is introduced.

## Exact train/test and replay behavior

In **public replay**, `cutoff` means **first held-out target date, exclusive for training**. A value of **2025-09-01** means:

```text
Training window:   2025-03-05 ... 2025-08-31 (up to 180 calendar days)
Internal rolling selection/calibration: only within that earlier period
Held-out targets:  2025-09-01 ... 2025-09-30 (30 days)
Run timestamp:    actual execution time, never backdated
```

Do not confuse this with the preserved operational diagnostic's “ใช้ข้อมูลถึงวันที่” inclusive last-training-day field. Their UI labels and response kinds identify the different contract. The public API requires `dataset_id` and `outlet_id`; its optional product filter uses external UUIDs. Menus with no observations before the cutoff are explicitly excluded, not assigned invented forecasts.

Only rows with `date < cutoff` enter feature generation, fitting, rolling selection and calibration. The original baseline/SES/XGBoost promotion guards stay unchanged; ML does not automatically win. Limited history uses a baseline. Generation stores the complete past input snapshot/SHA-256, parameters, actual execution timestamp, simulated cutoff, source/dataset/outlet, pipeline, chosen methods, diagnostics and prediction ranges in an immutable research round. **Only after that transaction commits** does a separate query retrieve target actuals from the same immutable dataset/outlet/product/date keys.

Missing outcomes stay null and are excluded from scores. Inferred zero outcomes remain distinctly labeled. The API returns MAE/RMSE/WAPE/Bias, optional MAPE, matched/missing counts and per-product results. `score` measures **product/day** errors. `aggregate_score` separately measures complete-day **totals of the selected products**, matching the chart. A partial day is excluded from total scoring. Aggregation can cancel item-level errors; a good total does **not** establish accurate menu-level forecasts or ingredient quantities.

Reopening a saved round recomputes metrics against the frozen imported dataset; predictions and input history are not retrained or overwritten. Normal GET/export needs no model fitting. Starting another replay creates a new run. No system clock change, fake POS transaction or production-scheduler alteration is involved.

## APIs

- `GET /api/forecasts/datasets`: imported dataset/source/license/coverage metadata.
- `POST /api/forecasts/backtest`: existing endpoint, with `{dataset_id, outlet_id, cutoff, horizon:1|7|30, history_days:30|90|180, product_id?}` for research.
- `GET /api/forecasts/replays`: latest 100 research rounds.
- `GET /api/forecasts/replays/:id`: saved prediction, past input/hash, held-out actuals, scores and provenance.

All use existing owner/manager authorization. Import is a local CLI operation, not an anonymous upload API. Existing operational generation, quality controls, CSV/month browsing and run endpoints remain unchanged.

## Presentation walkthrough

The current machine already has the verified dataset imported. For a repeatable presentation:

1. Run `npm run local:lan`, sign in as owner/manager, open **พยากรณ์ → Historical Replay · ข้อมูลสาธารณะ**, or `/forecast/replay` directly. Local PC: `http://localhost:3001/forecast/replay`; same-network devices use the current LAN link printed by the launcher.
2. Select Anonymous Transactional Dataset V2, **SHOP001**, all eligible products, **2025-09-01**, **30 days**, **180 training days**. Click **เริ่ม Historical Replay**. Full-outlet generation took about 25 seconds on this machine; inputs and saved-round switching are disabled while generation completes.
3. Explain the displayed train period ends **August 31**, and all September outcomes are withheld from the models. Open **Model selected** to show rolling validation results from training, separately from held-out scores.
4. Show the chart and product/day MAE, RMSE, WAPE and Bias, the daily table, inferred-zero labels and match counts. Open **คะแนนยอดรวมรายวัน** to explain total-volume performance as a different question. Do not replace a poor product score with the better aggregate score.
5. Select an individual product/outlet or a 1/7-day horizon to demonstrate scope; results may be worse and remain honestly displayed. Download JSON to show cutoff, actual run timestamp, input hash, chosen methods and immutable results. Use the saved-round dropdown to reopen the exact round without refitting. Once imported, viewing runs works without internet access.
6. Return to **พยากรณ์ร้าน** to demonstrate the distinct synthetic end-to-end workflow and recipe/stock recommendations. State that those recipes/stock belong to the CoffeeBackoffice demo, not the Indonesian shop. Prospective genuine-shop accuracy is a separate future experiment.

Required narrative: Experiment 1 uses marked synthetic sales for POS→KDS→payment→closing integration; Experiment 2 uses the public chronological holdout for model performance; Experiment 3 uses explicitly marked CoffeeBackoffice recipes/inventory for business recommendations. Genuine prospective validation is optional and remains pending.

## Observed results and limitations

Fixed SHOP001 September holdout, 94 eligible products, 2,820 product/day pairs, no missing outcomes, 955 inferred zeros. Machine-readable results, issue timestamp, training hash and selected-method counts: [mendeley-results.json](research/mendeley-results.json).

| Scope | Samples | MAE | RMSE | WAPE | Bias |
|---|---:|---:|---:|---:|---:|
| Product/day | 2,820 | 0.887716 | 1.130677 | 80.9101% | +0.026505 |
| Selected-product total/day | 30 | 9.640233 | 12.420501 | 9.34735% | +2.491433 |

The same forecasts produce both rows. Small, intermittent per-variant sales make item-level prediction weak, despite reasonable overall volume. These are retrospective measurements on this publisher's dataset, **not live CoffeeBackoffice validation**, independently audited physical demand, or a promise of future accuracy. Thresholds/hyperparameters were not adjusted after looking at September outcomes. Now that this holdout has been viewed, future method tuning needs a separately predeclared evaluation protocol and untouched outcomes.

No source recipes, stockouts, cancellations, open/closed completeness flags, promotions or historical unit prices are available; do not claim their effects were modeled. There is no public-to-shop recipe mapping. French Bakery was not needed. Genuine new operational sales and an untouched prospective evaluation remain future evidence. Intermittent-demand methods or menu-family aggregation can be evaluated later with a new protocol; they were not tuned against this revealed test period.

## Verification and changed files

Commands: `npm run typecheck`, `npm test`, `npm run test:postgres`, `python -m unittest discover -s forecast-service`, `npm run build`, `npm run test:e2e`, `npm run test:public-replay-ui`. The public browser command requires the imported dataset and an existing owner account configured privately in `.env`; it creates only research runs and asserts operational order/payment/stock/closing/forecast counts and stock rows remain identical. Screenshots/downloads/evidence stay in ignored `.local/public-datasets/evidence/`.

Verified: **101 tests passed on both PostgreSQL 18 and PGlite; 45 Python tests passed; typecheck/build passed; 27 whole-app browser workflow groups passed; public replay desktop/mobile WCAG, keyboard, invalid-period/retry, saved-scope restoration, JSON download and empty-state checks passed. Strict UI audit reported zero findings.** Operational counts/stock snapshots were identical before and after the public replay UI check. Existing orders remain 10,515, payments 10,049, stock movements 35,672, operational forecast runs 37 and day closings 211. Only research records were added.

The tests cover real column mapping, quantity reconciliation, duplicates/nulls/bad prices/returns, zero versus unknown dates, outlet isolation, idempotent import, strict cutoff, future sales not affecting selection, immutable replay results, correct outcome matches/metrics, absence of operational writes, and public endpoint authentication. Existing engine guard/metrics and whole-app workflow tests are retained.

| Files | Addition/change |
|---|---|
| `forecast-service/public_dataset.py`, `test_public_dataset.py` | Verified reproducible ETL and schema/quantity/zero tests |
| `forecast-service/app.py`, `test_engine.py` | Public cohort and explicit future-leakage regression |
| `src/research-dataset.ts` | Atomic idempotent CLI import into isolated research tables |
| `migrations/015_public_dataset_replay.sql` | Additive immutable research storage |
| `src/shop/forecast-client.ts`, `forecasts.ts` | Extract/reuse existing service validation; extend existing backtest route and add dataset/archive reads |
| `src/shop/forecast-replay.ts`, `tests/forecast-replay.test.ts` | Exclusive cutoff, saved replay, held-out scoring and isolation tests |
| `client/pages/HistoricalReplay.tsx`, `Forecast.tsx`, `App.tsx` | Separate replay screen, navigation, compact source disclosure and saved-scope restoration |
| `client/forecast-view.ts`, `client/lib.ts` | Reuse chart with minimal structural inputs; replay timeout/error messages |
| `scripts/check-public-replay.mjs`, `package.json` | Presentation UI/isolation QA and prepare/import/test commands |
| `docs/forecast-dataset-addendum.md`, `docs/research/mendeley-verification.json`, this guide, README, DESIGN, UX contract | Requirements, verified source facts, presentation instructions and final limitations |
