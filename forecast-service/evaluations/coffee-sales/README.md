# Coffee Sales offline evaluation — not deployed

Source: [Coffee Sales by Yaroslav Isaienkov / ihelon](https://www.kaggle.com/datasets/ihelon/coffee-sales). Original publisher metadata declared **CC0: Public Domain**, verified on 2026-11-02. See `provenance.json` for source URLs, checksums and limitations.

`daily.csv` contains de-identified aggregate counts from `index_1.csv`: date, beverage and number of recorded transactions. It contains no card/customer identifiers. The source has no quantity column, so counts are recorded vend events, not independently verified cups. Missing entire machine days are unknown and absent; zero per-product counts on machine-active days have the explicit availability assumption documented in provenance.

`model.json` is the final native XGBoost refit after a frozen chronological validation/holdout evaluation. `manifest.json` records its checksum/features and sets `deployment_approved=false`. The evaluated ML candidate lost to the validation-selected 28-day mean baseline (holdout WAPE 63.97% vs 61.16%). These are external-machine errors, not this shop's accuracy. This folder is not copied into the forecast service's production image or loaded by the running app.

`holdout-model.json` preserves the exact estimator trained before the held-out dates; use it to reproduce the published score. Fresh training across OS/compiler builds can produce different weights and scores. The manifest records the training environment and separate checksums for both estimators. Linux CI separately verifies frozen-estimator scoring and the no-promotion outcome of a fresh training run.

See [the full evaluation and offline reproduction commands](../../../docs/coffee-sales-evaluation.md). The daily aggregate is redistributed under the source's CC0 dedication; source credit is retained for traceability.
