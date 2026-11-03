# Forecast integration and model selection

## Uneven observations and new menus

Forecast batches use the latest **common observed date** across requested products. The common origin must be within seven days of the requested start and each product still needs 28 consecutive observations ending there. Newer observations for only some products are excluded from that batch rather than silently filling unknown days with zero. Close actual operating days to record zero sales for existing menus correctly. Tests cover uneven ends, stale common origins and insufficient overlapping history.

To avoid a new menu with no history blocking an established menu, filter **เมนู** on the forecast page and press **แสดงผล**, then **สร้างพยากรณ์ใหม่**. Generation uses that selected product only. With no menu filter it still explicitly requests all non-archived products and requires valid history for all of them. POST `/api/forecasts/generate` accepts optional `product_id`; server validation rejects extra products/dates from the model service. The nightly batch remains all-menu and reports insufficient history until all products qualify.

Implemented on 2026-11-02 using the user's supplied `C:/ProjectA` project. Source documents were inspected as evidence; operational authorization came from the user's request to connect the model and, if unsuitable, build a replacement.

## Imported model

`forecast-service/artifacts/manifest.json` records the source artifact, SHA-256, XGBoost version and ordered feature schema. The latest supplied v4 artifact selects the unweighted Poisson XGBoost candidate for 7/14/28 days. Its estimator was exported to XGBoost's native JSON format with `import_projecta.py`, using ProjectA's existing environment. Neither ProjectA's source, data nor database was modified or copied into the coffee shop database.

Runtime loads native JSON, verifies its checksum and feature names, and does not unpickle uploaded files. Native model export follows the [XGBoost Model IO documentation](https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html). The optional import script needs ProjectA's joblib/pandas/scikit-learn environment; the serving runtime needs NumPy and XGBoost only, in addition to FastAPI/Uvicorn.

Linux/CI/Docker use the official `xgboost-cpu` 3.0.0 distribution to avoid unnecessary GPU dependencies; other platforms use `xgboost` 3.0.0. Both expose the same CPU inference/training API. See the [XGBoost installation guide](https://xgboost.readthedocs.io/en/release_3.0.0/install.html#minimal-installation-cpu-only).

Two synthetic parity fixtures were computed with the original estimator for 30 recursive days each, crossing a month boundary. The native serving adapter matches all 60 predictions with **zero maximum absolute difference** on the checked Windows environment. This verifies integration, not business accuracy.

The transferred model is not assumed suitable for coffee demand. For example, a synthetic 28-day input of 8–20 units with a ฿65 price leads to some predictions above 100 units. ProjectA's retail validation scores must not be presented as coffee-shop accuracy.

## New shop model and selection

- Input is daily units and per-unit price in baht, grouped by product UUID. Features retain ProjectA's ordered lag-1/7/14/28, mean-7/28, weekday, month and price schema. Training uses the price observed on each training day; forecast recursion carries the last observed price. No retail SKU-to-coffee UUID mapping is invented because neither model uses SKU IDs as features.
- Every requested product needs at least 28 consecutive observed days at the common latest observation date. Missing days remain unknown. Only a closed business day, on/after a menu's recorded `forecast_since` date, supplies an explicit zero for a product without sales. Current Bangkok-calendar-day observations are excluded because the day is incomplete. A missing, incomplete or more-than-seven-day-old history yields an actionable error, not fabricated zero forecasts. A new menu without enough history currently blocks the all-menu generation; previously saved results stay readable.
- With 28–83 observed days, the displayed method is `weekly-naive-v1`: recursively repeat the last observed week. This is a seasonal baseline, not a claim that XGBoost ran for that product.
- With at least 84 consecutive observed days, a new pooled shop-history Poisson XGBoost candidate is trained on dates strictly before the final 28-day validation window. Its hyperparameters follow ProjectA's regularized Poisson settings. Each eligible product's 28-day recursive MAE is compared with the imported model and weekly seasonal baseline. On equal errors, the weekly method is preferred. Validation-window prices are never used to train or drive candidate forecasts.
- If the local candidate wins for any product, it is refit on all eligible observed history, saved in native JSON and identified by `coffee-xgb-v1-<snapshot-hash>`. Other products retain their selected baseline/imported method. No accuracy threshold is claimed from synthetic tests. The selection window is used to choose a candidate, **not an independent test of business accuracy**.
- Selection metadata records per-product validation MAE, methods, source provenance and origin. Local model artifacts and metadata are in ignored `forecast-service/runtime/` (override `FORECAST_MODEL_DIR`). Docker persists this folder in `coffee_forecast_models`. Preserve it alongside database backups if historical local-model reproducibility is required. The in-process four-snapshot cache avoids repeated fitting of identical data; restarting may refit deterministically. Artifacts do not embed raw sales rows.
- Generation occurs on the staff action or existing nightly job. Dashboard GET reads stored PostgreSQL predictions, never retrains. Importing another trusted ProjectA artifact is an explicit maintenance step; this export script rejects formats or selected-method schemas it cannot reproduce.
- Serving supports 1–30 requested days, including recursive bridge days between the observation origin and requested range. Days 29–30 extend the original 28-day evaluation horizon; no separate accuracy claim is made for them.

## Stored results and interpretation

Every forecast retains its selected method/version and `history_source` (`actual`, `demo`, `mixed`, or `unknown` for legacy rows). For a pooled local model, demo participation in other training series also marks provenance conservatively. Existing demo history can exercise model fitting and selection but is never proof of real-world accuracy. The dashboard keeps this disclosure even if the source demo rows are later removed.

The supplied estimator and new point-estimation model provide no calibrated uncertainty interval. New results store `lower_qty`/`upper_qty` as NULL; the UI shows no interval rather than inventing a ±20% band. Legacy mock bounds are preserved and labeled separately. Forecast response validation rejects half-null, nonfinite, incomplete, duplicate and out-of-range outputs before atomic persistence.

MAPE/RMSE include only actual observations matched to predictions generated before the target Bangkok day. Demo rows, current partial days and backcasts are excluded. Zero actuals count for RMSE but not MAPE. Recommendations remain forecast units × base recipe − current stock; options, supplier lead time and safety stock are outside this change.

## Verification

- 14 Python tests cover native parity, batch isolation, date bridging, future/price leakage, missing/duplicate/zero history, real candidate training and both baseline/local selection paths, provenance, API validation and horizon limits.
- 50 backend/configuration tests include isolated sales-history precedence, baht conversion, closed-day zeros, insufficient-history errors, NULL bounds, atomic invalid-response rejection and exclusion of demo/backcast accuracy pairs.
- The browser workflow generates forecasts through live FastAPI, verifies method/source disclosure and absent invented bounds, checks desktop/390px layout and automated accessibility, and continues the existing POS/QR/payment/report regressions in a disposable PostgreSQL schema.

Coffee-shop accuracy still needs enough real daily history and future observations retained after forecasts are made. No new retail data, simulated sales, historical orders or payments are inserted into the shop by integration verification.

### Local activation result

The existing shop has 84 explicitly labeled demo-history days for eight menus, ending 2026-11-01. Activation generated and persisted 56 daily predictions for 2026-11-03 through 2026-11-09. All eight selected the weekly method. The mean of per-menu **selection MAE on this synthetic history** was 0.000000 units for weekly repetition, 91.079863 for transferred ProjectA XGBoost, and 0.699845 for the newly trained local candidate. These numbers describe the seeded periodic pattern, not coffee-shop business accuracy or an independent holdout. The real shop's order count, payment count, stock-ledger count and total stock balance were verified unchanged before/after generation.
