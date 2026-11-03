# Demand forecasting v4

This replaces the active pipeline; all v2/v3 archives, snapshots, scripts and native ProjectA parity checks remain available. No order/payment/stock history is rewritten. Migration 012 adds quality annotations and training metadata; it does not modify applied migrations or archived predictions.

## Dataset contract

- Forecast target: fulfilled units per menu per Bangkok business day, including served but unpaid items. Revenue remains payment-based.
- Training cohorts are `genuine`, `simulation`, or `demo`. A run uses exactly one cohort. `actual` still names the order ledger, not proof of real customers.
- Automatic choice prefers genuine data when every requested menu is ready, otherwise a ready simulation cohort, otherwise demo only in explicit mixed mode. The UI discloses the actual choice. An explicit genuine request never falls back to simulation.
- Only closed-day observations enter real/simulation inputs. Closed, stockout and incomplete quality flags exclude that menu/date from training and evaluation. Mixed genuine/simulation deliveries on one menu/day are excluded rather than relabeled. Missing observations never become zero. A zero is inferred only on an eligible closed day with no deliveries.
- Up to 180 calendar days are available. Each menu needs 28 usable observations in the latest 56 days. The common cutoff is the oldest last-observed date across requested menus; the first requested target must be within 7 days of it. Missing calendar lags stay missing; statistical weekday features use dates, not array offsets.
- Quality edits require owner/manager permission, a reason and an audit event. They do not change sales. An explicitly marked future closed menu/day produces a scheduled zero in new rounds, without fabricated uncertainty bounds. Old rounds remain immutable.

## Candidates and selection

Candidates are last observed matching weekday, recent 7/28-day mean, four recent matching weekdays, SES alpha .2, and a new direct Poisson XGBoost. The transferred ProjectA retail estimator is retained only for legacy comparison.

The direct model predicts multiple leads without recursively feeding its own guesses back as sales. Features are product index, observed lags 1/7/28, observed recent means/count, target weekday mean, target weekday/month, lead and last observed unit price. Training uses lead 1/7/14/30 labels only when those targets were observed before the fold cutoff. Parameters are fixed before the retrospective comparison: 120 rounds, depth 3, eta .06, min child weight 5, lambda 5, seed 42, two threads.

The last 30 target calendar days, plus any gap from the common cutoff, are reserved for calibration when all menus have at least 28 prior observations and at least 20 calibration targets. Selection precedes these dates. With insufficient history, no interval is invented.

Selection uses non-overlapping target windows: 14 daily origins for a one-day request, four weekly origins for seven days, two monthly origins for thirty days. Folds without sufficient training are skipped and their actual count is recorded. Every candidate uses identical observed targets. Each fold reproduces the current unobserved gap before scoring the requested window. Statistical methods need at least a 1% MAE gain to replace weekly repetition. XGBoost additionally needs at least two folds, a 5% MAE gain over the best statistical method and wins on at least 60% of paired folds. These are declared stability rules, not parameters tuned against the final test results.

## Prediction ranges

After selection, the selected method is trained before the reserved calibration block. Absolute errors on the observed targets determine an empirical 80% radius using rank ceil((n+1)*.8), with a minimum of twenty errors. The method is then refit on all available history for future predictions.

These are pooled daily empirical ranges, not a formal conditional coverage guarantee, not a confidence interval for model parameters, and not a guarantee of future 80% coverage after refitting or a business change. Per-lead samples are too sparse to claim separately calibrated daily-lead ranges. The dashboard measures subsequent observed coverage and mean width; insufficient observed outcomes remain unavailable. Summing menu endpoints in the chart is not a calibrated 80% interval for shop-total demand.

## Evaluation and monitoring

Saved forecasts are compared only to subsequent closed-day, unflagged outcomes of the matching cohort. The earliest-issued prediction for each target/menu/lead/source/pipeline/cohort is selected. Scores from legacy and v4 are never blended; the displayed round determines the pipeline. Weekly baselines use the original frozen input. MAPE excludes actual zero targets; MAE/RMSE include them; WAPE is undefined when the actual total is zero.

The dashboard recomputes scores when loaded/refreshed after closing. It shows data readiness/staleness, a warning when model MAE is above weekly-baseline MAE on at least fourteen comparable pairs, and a warning when measured range coverage is below 80% on at least twenty bounded pairs. These are in-app status messages, not external notifications. No purchases are automated.

## Reproducible retrospective experiment

`python forecast-service/evaluate_shop.py PRIVATE_DATASET.json PRIVATE_REPORT.json` reads a private export of `/api/forecasts/data`. It does not insert historical forecasts or alter the shop. Fixed outer origins compare v4, legacy v3, weekly repetition and mean28 on identical targets: six one-day origins, four seven-day origins, two thirty-day origins. Selection/calibration use only the history before each outer origin. Targets have already been examined during development, so the report is explicitly posthoc retrospective analysis, never a new blind holdout. Further accuracy claims require new future observations. Parameters must not be changed merely to improve this report.

Methodological background: [Forecasting: Principles and Practice, forecasting toolbox](https://otexts.com/fpp3/toolbox.html), especially time-series cross-validation and prediction-interval evaluation. This reference does not validate the project's custom empirical interval procedure or synthetic sales.

## Deployment choice after the fixed experiment

The initial retrospective v4 auto-selection experiment is retained unchanged. Mean28 was slightly better than auto-selection at all three horizons on the examined synthetic dataset. The shop UI and nightly worker therefore default to the explicitly declared `mean28` policy, with `auto` and `weekly` available as alternatives. This is a conservative deployment choice made after inspecting the experiment, not a newly validated result or proof that mean28 is universally best. No model parameters or selection thresholds were tuned against the report. Each policy has its own pipeline identifier and immutable metadata, so its future outcomes are scored separately. Mean28/weekly skip unnecessary model selection/training and still use the reserved calibration block for empirical ranges when available.

Unmarked-order provenance is a bookkeeping category, not proof of real customers. Earlier manually created test orders may be unmarked. The owner must verify their origin before using these scores as real-customer accuracy evidence; the UI labels them as orders without the simulation marker.

## Fixed retrospective results (synthetic cohort)

| Horizon | Pairs | V4 auto MAE | Legacy v3 MAE | Weekly MAE | Mean28 MAE | V4 auto interval coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 day | 48 | 2.7060 | 3.2174 | 3.8542 | 2.6510 | 81.25% |
| 7 days | 224 | 2.6852 | 2.7596 | 3.2455 | 2.6558 | 81.25% |
| 30 days | 480 | 2.6157 | 2.6396 | 3.2938 | 2.5298 | 79.17% |

Mean28 WAPE was 29.52%, 34.95%, 33.24% respectively, versus v4 auto 30.14%, 35.34%, 34.37%. V4 auto improved over legacy and weekly repetition here, but did not beat mean28. No claim of an improved winner is made by ignoring that comparator. The displayed interval coverage above belongs to the auto policy, not the subsequently chosen mean28 policy. Historical interval performance of the declared baseline policy must be assessed separately or from its future recorded outcomes. Private input/report files remain under ignored .local; no raw sales or account information is committed.

The declared mean28 policy was also checked for interval coverage on the same fixed retrospective windows (not a new test set): 77.08% on 48 one-day pairs, 80.36% on 224 seven-day pairs and 80.21% on 480 thirty-day pairs. The one-day range missed the nominal target in this small sample; no radius was widened after inspecting these results. The dashboard's low-coverage warning and prospective monitoring remain necessary. Rounded issued predictions introduce negligible differences from the unrounded mean28 comparator.

Verification: 87 application/configuration tests passed on PostgreSQL and PGlite, 39 Python tests including standalone v4 startup without legacy artifacts, 26 isolated browser workflow groups and main-shop read-only desktop/mobile checks. The default policy generated 1/7/30-day saved rounds in approximately 0.3-0.6 seconds on this machine. Alternative auto-selection is slower (about 6-17 seconds in the measured run) and has an explicit request timeout/busy state. The new service imports the legacy retail model only when its comparison endpoint is explicitly requested.
