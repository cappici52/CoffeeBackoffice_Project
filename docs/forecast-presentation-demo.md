# Forecast demonstration with public coffee sales

This extends the existing [forecast specification](forecast-target-spec.md), [dataset addendum](forecast-dataset-addendum.md) and [Historical Replay](public-dataset-replay.md). No forecasting engine, production model policy, operational recipe/stock calculation, earlier evaluation or database table was replaced.

## Presentation flow

1. Start the existing Node application and FastAPI service with `npm run local`, and sign in as an owner or authorized manager.
2. Open `http://localhost:3001/forecast/replay` (also linked from the shop Forecast page).
3. Coffee Sales / ihelon is preferred when already imported. Click **ตั้งค่าสาธิต 30 วัน · ช่วงท้ายชุดข้อมูล**. This chooses the last 30 calendar days of the selected stream, 180 days of prior history and fixed-origin forecasting. It is a deterministic date rule, not a search for the best test score. The stream is a source file, not a verified physical branch.
4. Click **สร้างพยากรณ์**. The chart shows the previous 30 calendar days and the subsequent forecast, separated by a marked cutoff. All history used for fitting and internal model selection is strictly before that cutoff. The execution timestamp remains the actual current timestamp; the system clock and operational scheduler are unchanged.
5. Select a menu to inspect its empirical target-80% prediction interval. At total-demand level no 80% band is shown: summing product interval endpoints would not establish aggregate coverage. Missing observations stay missing, and insufficient calibration produces no band.
6. Optionally enable the clearly labeled baseline line. A flat selected forecast remains flat; the app does not inject oscillations or silently promote the baseline because it looks better.
7. Click **เปิดยอดขายจริง**. The application separately requests held-out outcomes and reports MAE, RMSE, WAPE, signed Bias, product scores, total-daily scores, sample counts and empirical interval coverage. Predictions and hashes are unchanged by revealing outcomes.
8. Expand **แผนเตรียมวัตถุดิบ · สูตร ราคา และสต็อกสมมติ**. Choose a 1/7/30-day preparation window. Inspect or edit each product-to-illustrative-recipe mapping, assumed THB selling price and assumed ingredient stock. This explains the transition from forecast quantities to planning, not the source shop's real recipe or finances. A 30-day requirement is not an instruction to buy a month's perishable stock at once.
9. Download the Replay JSON as evidence. Earlier saved rounds can be reopened; a page reload conceals actuals again. Assumption edits are a local, temporary planning preview and are not written to the operational database or included in the Replay prediction archive.

Public data must already be imported following [the coffee dataset guide](coffee-sales-v5-evaluation.md). Do not import it as operational POS orders. A different source may contain non-coffee products: unmapped products remain visible in the forecast but are explicitly excluded from recipe/revenue calculations. Recipes are illustrative, not evidence about the dataset's origin. Never describe recorded vending-machine events as independently verified cups sold by the user's shop.

## Architecture and preservation

* Node remains the main authenticated API and PostgreSQL research-data layer; FastAPI remains the unchanged model service. Public forecasting uses the existing prior-only baseline/SES/XGBoost selection and calibration pipeline.
* `POST /api/forecasts/backtest` accepts `reveal_actual: false`. The UI always sends this. Prediction snapshots and points commit before returning the forecast-only view. No held-out-demand SQL is executed by this path for a fixed-origin forecast.
* `GET /api/forecasts/replays/:id?reveal=false` returns prior input history, immutable predictions and prior-only baseline values, without target actuals or scored errors. `?reveal=true` is the explicit comparison read. Legacy callers retain their previous revealed-response default; this is a presentation reveal mechanism, not an access-control boundary.
* Benchmark predictions are frozen in the existing run metadata before any outcome read. They repeat the latest observed matching weekday available before the origin; if none exists, they use observed prior-28-day mean (or available prior observations). No synthetic zero or recursive forecast is used as an observation. Earlier fixed runs derive the same benchmark from their original stored history without updating those archives; legacy rolling runs without frozen benchmark inputs have unavailable baseline scores.
* Rolling remains available as an advanced, different protocol: every child run uses its own exclusive cutoff, commits before comparison, and carries its own frozen baseline and original input snapshot. The parent links those children. Do not equate rolling 1-day accuracy with fixed 30-day accuracy.
* The historical preview uses the saved input snapshot, not a mutable live POS query. The benchmark is a held-out comparator, never a reason to reselect a model after seeing test actuals.
* All-model and baseline scores use the same observed product/day pairs for newly generated runs. Aggregate scores require all selected products to have actuals for the day. Product errors are volume-weighted in WAPE; total-daily errors are calculated after summing products and answer a different question. WAPE is undefined when the actual total is zero.
* `client/replay-demo.ts` contains labeled synthetic recipe/price/stock assumptions. The UI has no stock-write endpoint, bank action, business transaction or operational master edit. Fractional expected sales are retained; discrete cup requirements round up. Shortages cannot be negative. Unknown mappings are excluded and disclosed.
* No migration is needed: new immutable metadata lives in the existing research tables. There is no duplicated forecasting API/service/table or deletion of older records.

## Verification and measured example

The preserved ihelon stream `index_1`, cutoff **2025-02-22**, fixed 30-day target through **2025-03-23**, with 180-day prior window produced the following observed results in the presentation browser check. These are a single historical test period, not the earlier multi-origin rolling evaluation and not a production-shop accuracy claim:

| Level/method | MAE | RMSE | WAPE | Bias | Samples |
|---|---:|---:|---:|---:|---:|
| Selected models, product/day | 1.3333 | 1.7629 | 76.56% | +0.6065 | 240 |
| Frozen weekday benchmark, product/day | 1.2875 | 1.8131 | 73.92% | +0.3208 | 240 |
| Selected models, total/day | 5.8997 | 7.4834 | 42.34% | +4.8517 | 30 |
| Frozen weekday benchmark, total/day | 3.1667 | 3.8079 | 22.73% | +2.5667 | 30 |

The benchmark wins MAE/WAPE in this particular period; selected product models have lower pooled RMSE. The app shows both rather than choosing retrospectively or modifying predictions. No model promotion, retraining experiment or claim of improved accuracy follows from this UI change. Sparse-data limitations from the earlier reports remain relevant.

Commands:

```powershell
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:coffee-replay-ui
npm run test:public-replay-ui
$env:QA_KEEP_SCHEMA='1'
npm run test:e2e
```

Critical tests check exclusive cutoffs, real zeros, unknown dates, frozen weekday fallback, initial generation without actual reads, reveal without prediction/hash mutation, matching scores, source isolation, scenario windows, mapping exclusions, inventory shortages and discrete units. Browser checks cover forecast-only/reveal states, baseline and product bands, assumptions, errors/retry, existing saved rounds, JSON download, keyboard, mobile layout and automated accessibility. Browser plugin was unavailable, so existing Playwright checks use installed Edge. Evidence is saved in timestamped `.local/forecast-demo/` directories without overwriting older evaluation reports. The existing full end-to-end suite uses an isolated retained schema.

## Deliberate limits

* This demonstrates retrospective unseen-history prediction and its measurable error, not prospective accuracy at the user's own shop.
* A flat forecast is allowed when prior-only selection chooses a constant estimator. The UI states that explicitly; no cosmetic variation is added.
* Target-80% product intervals are empirical estimates, not guaranteed coverage, and are not shown as aggregate intervals. Observed coverage is reported after reveal.
* No hourly forecasts, workforce optimizer, supplier lead-time dates, expiry/lot simulation, causal promotion uplift, weather effects or automatic model promotion is claimed.
* Operational inventory/recipes/reports and existing forecasting behavior remain separate. This task does not execute the pending operational simulation cleanup.

## Changed areas

`src/shop/forecast-replay.ts`, `src/shop/replay-baseline.ts`, `src/shop/forecasts.ts`: forecast-only/reveal reads and frozen benchmark evidence.

`client/pages/HistoricalReplay.tsx`, `client/pages/Forecast.tsx`: presentation flow, chart, coverage/benchmark comparisons, saved rounds and entry link.

`client/pages/ReplayPreparation.tsx`, `client/replay-demo.ts`: isolated illustrative planning.

`tests/forecast-replay.test.ts`, `tests/replay-demo.test.ts`, `scripts/check-public-replay.mjs`: leakage/reveal, planning and browser regressions.

This guide, `docs/public-dataset-replay.md`, `DESIGN.md`, `UX-CONTRACT.md` and `README.md`: current behavior, presentation instructions and limitations.

## Completed validation (2026-11-04)

* Typecheck and production build passed.
* All **118 automated tests in 22 files** passed.
* Full existing application browser suite passed **28 workflow checks**, including POS/payment, KDS, recipes, stock, reports, table ordering, permissions, branches and live FastAPI forecasting. Schema `e2e_ce88130f9c1145a2ab1b84897669595f` was retained; no operational cleanup ran.
* Final coffee demonstration browser check passed: run `9e26cd77-68bf-47ba-b1d4-a57b4e09d626`; timestamped evidence `.local/forecast-demo/2026-11-04T12-17-25.656Z/coffee`.
* Retained Mendeley demonstration browser check passed: run `96cef1e4-d839-4736-9934-eef050e08aac`; evidence `.local/forecast-demo/2026-11-04T12-17-25.661Z/mendeley`. Its fixed-period total WAPE **9.34735%** and product WAPE **80.91012%** reproduce the existing results. These must not be compared against coffee WAPE as proof of model improvement.
* Both source checks verified no changes to operational order, payment, movement, closing, forecast archive/cache counts or stock balances during the public-data demonstration.
* Desktop/mobile accessibility checks and the strict static UI audit passed without findings.
* No differences in `forecast-service`, migrations or earlier research reports against the pre-task baseline. The model engine SHA-256 remains `3b635cf93c0c19af2a4ea6cac0dc0dec4389a05d8ae31ce25e8d9031d967be7b`.
