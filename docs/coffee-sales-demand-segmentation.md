# Demand frequency segmentation and controlled density assessment

Research date: 2026-11-04. **No model is promoted to production.** This extends the [sparse-demand investigation](coffee-sales-sparse-investigation.md) using its exact frozen ihelon predictions and actuals. It adds category analysis and a prior-only category selector, not a replacement forecasting service.

## Conclusions

Different categories have different retrospective winners, but the evidence does not support a reliable production routing rule. XGBoost is competitive in medium/fast groups at short horizons; top-down weekday forecasts with stable product shares work well in slow groups; a weekday-conditioned share variant performs best for the single very sparse product. These observations are hypotheses from already examined periods, not deployable model-selection rules learned on unseen data.

The actual prior-only category selector improves product WAPE at one day, slightly worsens it at seven days and defaults to the existing weekday method at thirty days. Its aggregate WAPE is worse than weekday average at both short horizons. **Retain production behavior.** Maven is suitable for a separate denser-data controlled experiment, explicitly labeled fictional/synthetic; it cannot establish accuracy for a real shop.

## Segmentation method: only information known at the origin

Each product is classified separately at each forecast origin, using the same preceding window of at most 180 calendar days as the frozen benchmark. Frequency = positive recorded-sales days / eligible observed days. Mean includes inferred zero-sales observations on active dates. Missing dates are not counted as zeroes. At least 28 eligible observations are required; otherwise the result is `Insufficient history`, rather than an invented demand category.

The following absolute cutoffs were fixed for this category analysis; they are transparent research conventions, not universal retail thresholds or tuned accuracy thresholds. Test them on independently reserved data before using them operationally.

| Order | Category | Rule |
|---|---|---|
| 1 | Very sparse | Positive fraction <35% **or** mean <0.5 events/day |
| 2 | Slow-moving | Otherwise fraction <60% **or** mean <1 |
| 3 | Medium-moving | Otherwise fraction <80% **or** mean <2 |
| 4 | Fast-moving | Otherwise: fraction ≥80% **and** mean ≥2 |

The first origin (2024-12-23, forecasting from December 24) has 179 observed dates per product because one date in its window is unknown:

| Product | Category | Active sales days | Zero recorded-sales % | Mean/day | Std/day | Total events |
|---|---|---:|---:|---:|---:|---:|
| Americano | Slow-moving | 104 | 41.90 | 1.084 | 1.209 | 194 |
| Americano with Milk | Fast-moving | 151 | 15.64 | 2.374 | 2.164 | 425 |
| Cappuccino | Medium-moving | 114 | 36.31 | 1.168 | 1.217 | 209 |
| Cocoa | Slow-moving | 68 | 62.01 | .631 | 1.029 | 113 |
| Cortado | Slow-moving | 90 | 49.72 | .916 | 1.148 | 164 |
| Espresso | Very sparse | 48 | 73.18 | .358 | .673 | 64 |
| Hot Chocolate | Slow-moving | 75 | 58.10 | .810 | 1.241 | 145 |
| Latte | Fast-moving | 149 | 16.76 | 2.425 | 1.971 | 434 |

Across the 90 daily origins, Americano changes from Slow-moving (21 origins) to Medium-moving (69). Other products retain their first-origin category. Labels remain fixed over each forecast window, even if held-out demand changes. Consequently segment populations can differ between horizons; all models **within a horizon** always use the same labels, dates and mask.

[Assignments and statistics CSV](research/coffee-sales-segmentation-assignments.csv) contains all 840 product/origin assignments, positive/zero counts, observed count, mean, standard deviation, CV, positive-size CV², ADI, Fano ratio and total volume. All its features stop at that row's origin. The full-source descriptions from the earlier report are not substituted for these training-only features.

## Evaluation and data quality

All sixteen existing/experimental candidates are retained: weekly and last-value naive, mean-7, mean-28, weekday average, SES, ordinal global XGBoost, v5 automatic selection, Croston, SBA, TSB, three top-down variants, one-hot global XGBoost and the previous batch statistical selector. A seventeenth research policy selects among them by demand category.

The original rolling windows remain unchanged: 90 daily origins / 87 scored dates / 696 product-date pairs; 12 disjoint weekly origins / 81 dates / 648 pairs; three disjoint monthly origins / 87 dates / 696 pairs. Source, original prediction and experimental prediction hashes are verified. Every earlier all-product metric is reproduced exactly before reporting category results. No model is refitted or previous prediction edited for this analysis.

The category selector uses only fully elapsed earlier outer folds, whose last target date is at or before the current origin. It compares pooled product/date MAE for the same historical category, requiring at least three completed origins and twenty observed pairs. Otherwise it uses weekday average. No current or partly elapsed future window is used; ties use deterministic method order. This is an online research policy that learns from earlier completed evaluation windows, not a policy chosen using the final full evaluation scores. At thirty days it has too few earlier monthly origins and therefore uses weekday average throughout. Per-origin choices are retained in the results JSON.

Missing whole-source dates remain unknown. Product zeroes on active dates are still inferred recorded-sales zeroes; they cannot prove zero customer demand or in-stock availability. There are no source stockout, opening/closure or complete-day flags. The analysis utilities exclude explicit `stockout`, `missing` and `incomplete` quality flags, and explicit false completion flags, from feature statistics and apply a common target mask to all candidates. Current frozen source observations have no such availability flags, so scores match the earlier benchmark. **No stockout correction or complete-day verification is claimed.** A future dataset with those flags needs its own frozen protocol; it must not overwrite this benchmark or silently reinterpret earlier sales.

## Accuracy by category

The table shows the **best observed fixed method after evaluation**, for explanation only. Selecting these winners using these same outcomes and then calling the result an out-of-sample selector would be leakage. The separately measured prior-only selector below avoids that error.

| Horizon | Category | Product/date pairs | Actual events | Weekday WAPE % | Best observed fixed method | WAPE % | Lower MAE than weekday: origins |
|---|---|---:|---:|---:|---|---:|---:|
| 1 | Fast | 174 | 367 | 61.92 | Top-down weekday/share28 | 59.06 | 45/87 |
| 1 | Medium | 156 | 364 | 58.45 | Global XGBoost one-hot | 54.38 | 51/87 |
| 1 | Slow | 279 | 245 | 97.24 | Top-down weekday/share28 | 91.57 | 50/87 |
| 1 | Very sparse | 87 | 37 | 116.89 | Top-down weekday/weekday-share56 | 108.96 | 44/87 |
| 7 | Fast | 162 | 352 | 60.94 | Global XGBoost one-hot | 57.59 | 8/12 |
| 7 | Medium | 143 | 351 | 57.55 | Existing global XGBoost ordinal | 55.67 | 9/12 |
| 7 | Slow | 262 | 232 | 93.86 | Top-down weekday/share28 | 91.63 | 9/12 |
| 7 | Very sparse | 81 | 33 | 120.45 | Top-down weekday/weekday-share56 | 111.49 | 8/12 |
| 30 | Fast | 174 | 367 | 62.74 | Top-down weekday/share28 | 60.19 | 3/3 |
| 30 | Medium | 117 | 263 | 53.33 | Top-down weekday/share28 | 51.89 | 2/3 |
| 30 | Slow | 318 | 346 | 96.32 | Top-down weekday/share28 | 94.62 | 2/3 |
| 30 | Very sparse | 87 | 37 | 108.11 | Top-down weekday/weekday-share56 | 107.53 | 2/3 |

Interpretation:

* Medium/fast products offer more positive observations for pooled ML, but XGBoost does not win every horizon. A category name is insufficient evidence to mandate ML.
* Stable-share top-down pooling helps slow demand here. Croston/SBA/TSB remain comparison candidates, not automatic sparse-demand winners.
* Very sparse is **Espresso alone**, with just 33–37 held-out events. Its apparent winner cannot establish a general rule for rare products, and error remains over 100% WAPE.
* Daily fold win rates are modest despite lower pooled WAPE. Thirty-day evidence has only three origins. These are descriptive counts, not statistical significance claims.

[Full category/model tables](research/coffee-sales-segmentation-comparison.md) report product-level **MAE, RMSE, WAPE and Bias**, as well as summed segment/date metrics, for every candidate and horizon. [Product metrics CSV](research/coffee-sales-segmentation-product-metrics.csv) retains individual-menu metrics for every method, including the new category selector. Negative Bias means predicted minus actual is below zero. A thirty-day horizon measures daily errors across that window, not one monthly summed error.

## Volume weighting and the measured category selector

Pooled WAPE = 100 × sum absolute product/date errors / sum actual product/date sales. It is not an unweighted mean of product WAPEs; predictions on zero-actual dates still contribute error. Segment/date total metrics sum predictions and actuals within each segment before scoring, so product errors can cancel.

We additionally report explicitly volume-weighted per-product metrics. For product p, weight w_p is its held-out actual volume divided by the segment's held-out volume; weighted MAE = sum(w_p MAE_p), weighted RMSE = sqrt(sum(w_p RMSE_p²)), weighted Bias = sum(w_p Bias_p). Products with zero total volume have zero weight in these three summaries, but their errors remain in pooled WAPE. The weights are **reporting outcomes only**, never grouping or selection features. Empty/zero-volume groups have undefined weighted accuracy, not fabricated zero error.

| Horizon | Policy | Volume-weighted MAE | RMSE | Bias | Pooled product WAPE % | Total WAPE % |
|---|---|---:|---:|---:|---:|---:|
| 1 | Weekday baseline | 1.2215 | 1.6599 | -.2890 | 71.2241 | 29.7137 |
| 1 | Prior-only category selector | 1.1852 | 1.5891 | -.1758 | 69.3354 | 30.0652 |
| 7 | Weekday baseline | 1.2373 | 1.6944 | -.3314 | 69.6281 | 29.4421 |
| 7 | Prior-only category selector | 1.2399 | 1.6619 | -.2702 | 69.7187 | 31.5018 |
| 30 | Weekday baseline | 1.2680 | 1.8028 | -.4362 | 73.4205 | 33.1441 |
| 30 | Prior-only category selector | 1.2680 | 1.8028 | -.4362 | 73.4205 | 33.1441 |

[Volume-weighted metrics CSV](research/coffee-sales-segmentation-volume-weighted.csv) supplies every method/segment, not just these two policies. The fixed top-down/share28 candidate from the prior experiment still has better overall product WAPE (68.11/67.53/71.95%) than this selector. Neither finding justifies production promotion from known public outcomes.

## Maven Roasters: suitability as a separate controlled experiment

**Label: fictional/synthetic.** The [original publisher](https://mavenanalytics.io/data-playground/coffee-shop-sales) describes a fictitious three-location NYC shop. The [requested Kaggle mirror](https://www.kaggle.com/datasets/agungpambudi/trends-product-coffee-shop-sales-revenue-dataset) credits Maven Analytics and supplies V3 under CC0/Public Domain. The generation mechanism is not documented; dense synthetic records are not independent evidence of real-world demand behavior.

The V3 archive was downloaded and inspected locally, rather than relying on webpage row-count widgets. Its CSV is **pipe-delimited**, despite the `.csv` extension, and contains eleven fields: transaction ID/date/time/quantity, store ID/location, product ID, unit price, category/type/detail. The archive also contains a Parquet representation; these are not two datasets to concatenate. Archive SHA-256: `5203645eeef715e7b8aaf28355bfd62845a9a3ab91d205a2c345f9a2a4e5722f`.

Measured results:

| Property | Maven V3 inspection |
|---|---|
| Date range | 2023-01-01–2023-06-30: 181 calendar days |
| Recorded rows / sold units | 149,116 / 214,470 |
| Products | 80 SKUs; 21 in the `Coffee` category |
| Missing required fields / exact duplicate rows / repeated transaction IDs | 0 / 0 / 0 |
| Store missing whole dates | None in this archive; this does not certify full business-day capture |
| All SKU/store/day observations after first appearance | 42,494; mean 5.05 units; 25.25% inferred zero-sales periods |
| Coffee SKU/store/day observations | 11,222; mean 7.95 units; 2.07% inferred zero-sales periods |

| Store | Rows/day | Units/day | Observed days |
|---|---:|---:|---:|
| Astoria | 279.55 | 392.22 | 181 |
| Lower Manhattan | 263.99 | 396.36 | 181 |
| Hell's Kitchen | 280.30 | 396.34 | 181 |

Demand quantity must **sum `transaction_qty`**, not count rows. SKU detail includes product variants/sizes; a store/SKU is the appropriate initial series key. Product zeroes are inferred only after first appearance on active store dates. No stockout, opening schedule or verified completion flags exist. Do not concatenate stores as extra dates or imply 543 days of historical coverage.

For density context, the existing ihelon stream averages 9.54 recorded events per active day, 1.20 events per observed product/day, with 43.68% inferred zero product periods. Maven coffee series are denser, but the units, outlet setting, time span and SKU definitions differ. This is a density comparison, **not a WAPE comparison or evidence that one forecasting model improved**.

Recommendation: use Maven as a separate fictional dense-data benchmark, initially retaining coffee SKUs by store. Freeze its own protocol, use the first roughly three months for initial history and the final ninety days for chronological rolling evaluation, and evaluate all candidates on identical within-dataset folds at 1/7/30 days. Fit labels, shares, encodings and any selector only on each origin's past. Do not choose future product catalogs or treat unverified missing/stockout days as zero demand. Report results separately by store/product/segment; six months cannot validate annual seasonality. No Maven forecasts were trained in this suitability audit, and none are claimed.

The source remains in an isolated local research folder. Nothing was imported into operational PostgreSQL sales, payments, recipes or inventory, or used to change the production model. [Density inspection JSON](research/maven-roasters-density-inspection.json) includes every store/SKU's descriptive statistics.

## Reproduction and changed files

With the existing frozen baseline and sparse-investigation files present, run from the repository root:

```powershell
.venv/Scripts/python.exe forecast-service/segment_demand.py
.venv/Scripts/python.exe forecast-service/inspect_maven_density.py
.venv/Scripts/python.exe -m unittest discover -s forecast-service -p 'test_*.py'
```

Segmentation writes `.local/public-datasets/ihelon-coffee-sales/segmentation-v2/results.json` and `comparison.md`; re-running must reproduce the same result. A changed protocol requires a new output directory. The local full JSON retains per-fold scores; compact tracked evidence includes a hash of that file and fold win counts. Downloaded Maven V3 lives at `.local/public-datasets/maven-roasters-density-v1/original.zip`, obtained from the public Kaggle API `https://www.kaggle.com/api/v1/datasets/download/agungpambudi/trends-product-coffee-shop-sales-revenue-dataset?datasetVersionNumber=3`; the inspection command also accepts `--archive` and `--output`.

Implementation adds `forecast-service/segment_demand.py`, `inspect_maven_density.py` and their two test modules. Evidence files use the new `docs/research/coffee-sales-segmentation-*` names plus `maven-roasters-density-inspection.json`; this report and the README provide navigation. Earlier reports and prediction files remain unchanged. There are no Node, FastAPI serving, database, frontend, recipe or inventory modifications.

All **63 Python tests pass**, including fixed category boundaries, origin/future invariance, quality exclusions, elapsed-fold selection, volume weighting, quantity semantics and unknown-date handling. Both repeated segmentation runs reproduced identical results. Remaining limitations are the small number of products/monthly origins, arbitrary category cutoffs, absent availability metadata and prior exposure to these outcomes. Production promotion needs consistent improvement on newly reserved outcomes, across horizons/products and business costs; this investigation does not meet that standard.
