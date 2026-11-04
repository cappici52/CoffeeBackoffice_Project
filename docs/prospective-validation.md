# Prospective operational forecast validation

Current status: awaiting sufficient new, verified genuine operational sales. The user confirmed no real participants are available. Nine retained unmarked orders are preserved evidence of app activity, not independent verification that nine customers purchased goods. Public-data Replay, synthetic workflow tests and prospective operational performance remain separate.

The existing Forecast dashboard already stores immutable issued snapshots and matches future observations only under its prospective timing/source/quality rules. No second evaluation API or duplicate prediction table is added. The product/lead-day table now includes RMSE alongside MAE, WAPE, Bias and sample counts. Public Replay scores are not inserted into these operational scores.

## Collection protocol

1. Establish verified prices, recipes and counted branch stock. Record opening/closed days and product availability accurately. Avoid recording a stockout as observed unconstrained demand.
2. Use the normal POS/QR → acceptance → fulfilment → payment workflow. Fulfilment is demand history; payment dates serve cash reporting. Retain cancellation/refund provenance.
3. Complete a business-day review. Use existing day-quality annotations for incomplete business days, closures, stockouts and outliers; missing dates remain unknown rather than automatic zeros.
4. Let the normal scheduler issue 1/7/30-day predictions before target outcomes. Save timestamps, snapshots, model selection evidence and source cohort. Do not edit the system clock, backdate predictions or insert synthetic sales as genuine.
5. After target days finish, inspect the Forecast dashboard's genuine/non-simulation evaluation and product/lead-day sample counts. Report MAE, RMSE, WAPE, signed Bias and interval coverage where calibrated. Undefined metrics stay undefined.
6. Compare methods using identical observed target pairs and time-based folds. Keep the original prediction/model decision when reviewing its score. Different horizons and datasets require separate results.
7. Accumulate multiple complete origins before considering model promotion. A minimum data threshold is not a guarantee of statistical reliability; report sample counts, missingness and data limitations.

## Evidence to collect privately

- Branch, target business dates and day-quality decisions.
- Issued run ID/time, original input snapshot/hash, forecast horizon, method, cohort and calibration.
- Target fulfilment counts, stockout/incomplete flags, matched/excluded pair counts.
- MAE/RMSE/WAPE/Bias, baseline on the same pairs and reasons for retaining/changing a method.

Do not silently replace missing actuals with predicted values, optimize on the test period, or describe the public vending-machine dataset as this shop's prospective validation. Until actual observations exist, report **awaiting operational validation**, not a made-up accuracy figure. See the existing `forecast-evaluation-plan.md` for chronological model evaluation.
