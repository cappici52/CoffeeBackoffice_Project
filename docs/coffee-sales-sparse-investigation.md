# Coffee Sales: sparse-demand root-cause investigation

Research completed 2026-11-04. **Production forecasting is unchanged.** No sales, inventory, historical actuals, earlier predictions or previous evaluation reports were edited. This investigation uses the existing ihelon V21 input, not another dataset.

## Findings and recommendation

The best fixed experimental method on these periods is **weekday total forecast × past 28-calendar-day product shares**. Product WAPE improves from 75.50/75.37/83.59% to 68.11/67.53/71.95% for 1/7/30 days. Errors remain substantial. Against the strongest existing fixed statistical baseline (weekday average), the relative product WAPE reductions are only **4.37%, 3.01%, 2.00%**. Its total forecasts are identical to that baseline, so hierarchy adds **no aggregate accuracy gain over weekday average**.

Keep this as a research candidate, alongside the direct weekday baseline. Do not promote it to production from these already examined public outcomes. It underforecasts total demand, regresses for one product at longer horizons, and has only three monthly origins. Confirm it on a newly reserved chronological period or future operational sales with a fixed protocol before promotion. No numerical promotion threshold was preregistered in this experiment.

## 1. Missing dates and observed zeroes

The source is [ihelon Coffee Sales](https://www.kaggle.com/datasets/ihelon/coffee-sales), publisher-described vending-machine transactions; provenance is not independently audited. One row is one recorded event, with no quantity field. Forecast units are recorded events, not verified cups or unconstrained customer demand.

The audit reconciles normalized quantities with `index_1.csv` event counts. It finds 3,636 events, no exact duplicate rows, 388 calendar days (2024-03-01–2025-03-23), and 381 active dates. Daily density on active dates: mean **9.54**, median **9**, standard deviation **5.10**, range **1–26**.

| Situation | Evidence | Treatment |
|---|---|---|
| Whole stream absent | 2024-05-01, 05-04, 05-05, 11-27; 2025-01-01, 01-19, 01-23 | Unknown; not filled with zero; excluded from scoring |
| Verified full-day zero sales | None: no opening, outage or machine-availability log | Cannot establish genuine full-day zeroes |
| Product absent on an active date after its first appearance | 1,327 of 3,038 product/date observations (43.68%) | Inferred zero **recorded sales**, not proof of zero demand or availability |
| Before first product appearance | Ten product/date cells absent | Remain unobserved |

Croston/TSB skip unknown periods rather than treating them as no-demand observations. Their intervals therefore count observed periods, not elapsed calendar days. This is an explicit research approximation; availability evidence would be needed for a stronger demand interpretation. Unknown target dates retain the original common scoring mask for every candidate.

## 2. Per-product demand statistics and causes

Full source period, observed dates only. ADI = observed periods / positive periods; CV² uses positive event sizes; standard deviation is population standard deviation. These describe sparsity without asserting availability or assigning a hard demand-class label.

| Product | Observations | Zero % | Mean/day | Std/day | ADI | Positive-size CV² | Pre-evaluation mean → evaluation mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| Americano | 381 | 34.65 | 1.517 | 1.816 | 1.53 | .591 | 1.112 → 2.885 |
| Americano with Milk | 381 | 17.06 | 2.163 | 1.891 | 1.21 | .463 | 2.112 → 2.333 |
| Cappuccino | 376 | 30.59 | 1.332 | 1.306 | 1.44 | .361 | 1.273 → 1.529 |
| Cocoa | 381 | 62.99 | .638 | 1.062 | 2.70 | .397 | .473 → 1.195 |
| Cortado | 379 | 54.35 | .770 | 1.026 | 2.19 | .266 | .846 → .517 |
| Espresso | 378 | 72.49 | .354 | .652 | 3.63 | .205 | .333 → .425 |
| Hot Chocolate | 381 | 58.01 | .740 | 1.107 | 2.38 | .360 | .701 → .874 |
| Latte | 381 | 19.42 | 2.052 | 1.743 | 1.24 | .387 | 2.102 → 1.885 |

Pre-evaluation means use observations before 2024-12-24; evaluation means use that date onward. These retrospective descriptions were not fed into fitting or parameter selection. [Statistics CSV](research/coffee-sales-sparse-demand-statistics.csv) includes positive counts, totals, CV, Fano ratio and all three periods.

The evidence points to several causes, rather than a missing ML algorithm:

* Very low per-product counts make a one-event error large relative to actual demand. Product WAPE pools absolute errors before aggregation; aggregate WAPE permits errors between products to cancel. Their difference is expected and not proof of a broken metric.
* Product mix changes over time: Americano and Cocoa rise while Cortado falls. Longer fixed-origin forecasts cannot observe subsequent changes.
* Many zeroes and variable positive sizes make independent per-product weekday estimates noisy. Pooling total demand and estimating shares from more observations helps here.
* Model selection has little evidence per product, particularly at 30 days. Inspecting it reveals unstable choices, rather than proof that XGBoost is needed.
* Missing availability records limit interpretation of demand. More model complexity cannot recover unrecorded sales reliably.

## 3. Selected-model audit

[Complete selection-count tables](research/coffee-sales-sparse-comparison.md) show every product at every horizon; [machine-readable evidence](research/coffee-sales-sparse-results.json) retains each origin's chosen model. Counts are one vote per origin, not one per forecast day. Detailed inner validation scores remain in the local reproducible `results.json`.

The existing selector uses 14/4/2 inner origins at 1/7/30 days. At 30 days Espresso selected last-value at all three outer origins; Cappuccino selected mean-28 twice and last-value once; Cocoa selected SES twice and last-value once. Such choices can perform well on a tiny inner sample yet poorly later. This is a plausible source of selection variance, not a causal proof from a controlled ablation.

An additional prior-only batch selector compares existing statistical, intermittent and hierarchical candidates using earlier inner targets, with the v5 calibration separation retained. It produces product WAPE **71.10/70.46/75.13%**, failing to identify the best held-out fixed method consistently. At 30 days it selects SBA at all three origins. Adding candidates alone does not solve selection uncertainty.

## 4. Experimental methods and leakage controls

`sparse_candidates.py` and `investigate_sparse.py` are isolated research modules; neither is imported by FastAPI serving or the production engine.

* Croston uses alpha=.1, first positive size and observed elapsed interval initialization; SBA multiplies the result by .95. TSB uses size alpha=.1 and occurrence beta=.1, initializes probability as 1/(observed index+1), and updates probability on observed zeroes. All-zero histories return zero. Future multi-step forecasts hold the estimated rate constant; future zero observations are never fabricated. These methods follow the intermittent-demand distinction described by [Teunter, Syntetos and Babai (2011)](https://www.sciencedirect.com/science/article/pii/S0377221711004437).
* Top-down controls use total mean-28 or the mean of the last four observed matching weekdays. Shares are product event sums / total event sums on complete dates in the past 28 calendar days. A separate variant conditions shares on matching weekdays over 56 days. All inputs end at the common historical origin. Three-decimal allocations preserve the rounded total using a deterministic residual, never actual outcomes. [Hierarchical forecasting background](https://otexts.com/fpp3/hierarchical-forecasting.html).
* Mean-28 total × mean-28 shares equals direct product mean-28 on the same complete dates, apart from rounding. Its unchanged performance is a useful control: hierarchy alone is not an accuracy improvement.
* Existing `direct` XGBoost already pools training rows across products. The experiment replaces its ordinal product index with one-hot indicators while preserving other features, lead construction, Poisson objective and hyperparameters. ML is evaluated independently and is not forced into the selector.

Every candidate uses the **same original 105 outer origins**, training windows of at most 180 calendar days, and unchanged actuals:

| Horizon | Origins / first–last cutoff | Scored dates | Product/date pairs |
|---|---|---:|---:|
| 1 day | 90 / 2024-12-24–2025-03-23 | 87 | 696 |
| 7 days | 12 disjoint / 2024-12-30–2025-03-17 | 81 | 648 |
| 30 days | 3 disjoint / 2024-12-24, 2025-01-23, 2025-02-22 | 87 | 696 |

Cutoff is the first target date; fitting uses only earlier observations. The runner verifies frozen input, production engine and every original prediction hash; reconstructs and checks each training-history hash; saves new predictions before reading held-out actuals for scoring; checks equal coverage; and reproduces **all earlier baseline metrics** within floating-point tolerance. Existing prediction files are read-only. New predictions use exclusive file creation and a separate directory. These are retrospective, known-public-data experiments, not newly blind tests. No post-test hyperparameter search was performed.

## 5. Accuracy comparison

WAPE is percent; Bias = mean(predicted − actual), so negative means underforecasting. MAE, RMSE and Bias use events per product/date or events per total/date. “30-day” means daily forecasts at a 30-day horizon, not error on one monthly summed quantity.

| Horizon | Method | Product MAE | RMSE | WAPE % | Bias | Total MAE | RMSE | WAPE % | Bias |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Existing auto | 1.0989 | 1.5487 | 75.5022 | -.1344 | 4.1601 | 5.2905 | 35.7284 | -1.0755 |
| 1 | Existing weekday | 1.0366 | 1.4301 | 71.2241 | -.1674 | 3.4598 | 4.7682 | 29.7137 | -1.3391 |
| 1 | Top-down weekday/share28 | .9914 | 1.3546 | 68.1143 | -.1674 | 3.4598 | 4.7682 | 29.7137 | -1.3391 |
| 7 | Existing auto | 1.1258 | 1.5952 | 75.3656 | -.3165 | 4.6715 | 5.8608 | 39.0900 | -2.5322 |
| 7 | Existing weekday | 1.0401 | 1.4469 | 69.6281 | -.1836 | 3.5185 | 4.8485 | 29.4421 | -1.4691 |
| 7 | Top-down weekday/share28 | 1.0088 | 1.3935 | 67.5329 | -.1836 | 3.5185 | 4.8485 | 29.4421 | -1.4691 |
| 30 | Existing auto | 1.2167 | 1.6912 | 83.5948 | .0868 | 5.0343 | 6.6820 | 43.2366 | .6943 |
| 30 | Existing weekday | 1.0686 | 1.5201 | 73.4205 | -.2611 | 3.8592 | 5.5097 | 33.1441 | -2.0891 |
| 30 | Top-down weekday/share28 | 1.0472 | 1.4939 | 71.9508 | -.2611 | 3.8592 | 5.5097 | 33.1441 | -2.0891 |

[Full comparison](research/coffee-sales-sparse-comparison.md) reports all metrics for every candidate. [Product metrics CSV](research/coffee-sales-sparse-product-metrics.csv) contains all methods/products/horizons. Croston/SBA/TSB beat weak auto results but do not consistently beat weekday average. TSB's 7-day product WAPE (69.6140%) is almost identical to weekday average (69.6281%), with worse aggregate WAPE (37.8192% vs 29.4421%). One-hot global XGBoost improves over ordinal XGBoost modestly but remains worse than top-down, especially at 30 days (80.0321% vs 71.9508% product WAPE).

| Product | 1-day WAPE auto → top-down | 7-day | 30-day |
|---|---:|---:|---:|
| Americano | 57.17 → 50.85 | 57.09 → 51.00 | 73.28 → 58.99 |
| Americano with Milk | 66.27 → 58.37 | 55.22 → 57.00 | 53.79 → 56.78 |
| Cappuccino | 68.01 → 67.09 | 78.49 → 66.23 | 77.61 → 67.66 |
| Cocoa | 96.13 → 86.12 | 93.73 → 83.63 | 113.16 → 89.88 |
| Cortado | 118.16 → 115.10 | 132.02 → 131.13 | 211.13 → 139.19 |
| Espresso | 138.22 → 121.48 | 146.32 → 122.95 | 124.32 → 119.21 |
| Hot Chocolate | 104.74 → 92.22 | 103.76 → 92.09 | 98.50 → 91.71 |
| Latte | 68.58 → 59.90 | 73.50 → 59.34 | 71.29 → 64.40 |

Top-down beats auto product MAE on 57/87 scored daily origins, 9/12 weekly origins, and 3/3 monthly origins. It improves 8/8 products at one day, 7/8 at seven and thirty days. Americano with Milk regresses at longer horizons. The rarer drinks still exceed 100% WAPE. Negative total bias of 1.34/1.47/2.09 events/day matters for preparation: minimizing MAE or WAPE is not the same objective as minimizing stockouts or waste. No bias correction was fitted using held-out outcomes.

## 6. Reproduction, preservation and limitations

From the repository root, with the existing downloaded archive and frozen baseline evaluation files:

```powershell
.venv/Scripts/python.exe forecast-service/investigate_sparse.py
.venv/Scripts/python.exe -m unittest discover -s forecast-service -p 'test_*.py'
```

The runner defaults to `.local/public-datasets/ihelon-coffee-sales/evaluation` and writes only `.local/public-datasets/ihelon-coffee-sales/sparse-investigation-v1`. Re-running resumes unchanged frozen predictions; altered protocols require a new output directory. The existing dataset adapter and `evaluate_research.py` generate the prerequisite baseline; see [prior evaluation instructions](coffee-sales-v5-evaluation.md). Old frozen predictions must match the committed reference, not an arbitrary newly generated benchmark.

Tracked evidence includes the protocol, code/prediction hashes, all candidate scores, fold scores, per-product metrics, demand statistics and compact per-origin selections. The local full `results.json` additionally retains verbose inner selection diagnostics. Historical Replay, the Forecast Dashboard, operational Node/FastAPI APIs, recipe conversion, inventory recommendations and production model selection remain unchanged. Experimental candidates are CLI research results, not new production or Replay choices.

All **57 Python tests pass**, including hand-calculated intermittent states, coherent allocation, unknown-date handling, future-data invariance, frozen-history checks and existing forecasting regression tests. No database migration or write was required.

Remaining work: independent chronological confirmation; verified availability/closure/stockout data; more monthly origins and outlets; business-cost validation of bias and preparation decisions. Better scores on these known public periods do not establish accuracy for an untested real shop.
