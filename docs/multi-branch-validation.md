# Multi-branch validation — 2026-11-04

## Results

| Check | Result |
|---|---|
| TypeScript backend/client checks | Passed |
| Production build | Passed |
| Automated API/domain regression | 114 tests in 21 files passed |
| PostgreSQL restored-copy migration | 32 original table-content fingerprints unchanged; legacy 10,515 orders visible, other branch zero; runtime role verified |
| Application migration | All 32 original non-migration tables preserved, excluding only new branch metadata |
| Backup verification | Pre-migration 33 tables; post-migration 37 tables; row counts and migration checksums match restored copies |
| Browser regression | 28 workflow checks passed, including live unchanged FastAPI integration |
| Browser console | No relevant runtime exceptions/errors/warnings in the successful full run |
| Responsive/accessibility | 390px and desktop checks; no horizontal document overflow; automated axe checks passed |
| UI contract audit | Strict audit: zero findings |
| Cleanup | READ ONLY dry-run only; no deletion approval or execution |

Browser plugin was not available; the existing Playwright workflow used headless installed Edge on Windows. All browser transactions use a generated isolated PostgreSQL schema, not operational tables. `QA_KEEP_SCHEMA=1` retains that schema after testing. Screenshots are private local evidence under `.local/multi-branch/browser`.

## Covered workflows

* Login, account/password/session lifecycle and owner/manager/cashier/kitchen authorization.
* Branch bootstrap, fourth-branch creation, editing/status, assignment changes, no-membership/cross-branch rejection and read-only consolidated scope.
* Independent stock receipts and concurrent deductions, branch prices/availability, shared recipes and inherited defaults.
* POS payment/receipt, lost-response idempotency, option substitutions, cancellation/refund rules and KDS transitions.
* QR table binding, anonymous mobile ordering, delivery-before-payment and tracking. Forged branch headers cannot change the table's branch/price; inactive branches reject new orders while preserving tracking.
* PromptPay image URLs retain branch context without custom image headers and reject unassigned staff access.
* Per-branch/consolidated reports use stored amounts; a newly created branch has zero orders/revenue and empty charts.
* Legacy migration preserves stock, actors and immutable forecast payloads. Privileged legacy forecast-history calls cannot pool other branches; branch-scoped history/cohort tests use deliberately different quantities.
* Public Historical Replay immutability/leakage regressions, existing model/service UI, source disclosures, snapshot export and recipe/replenishment integration.
* Normal startup contains no demo invocations; explicit demo targets are isolated and operational targets are rejected.

No new forecasting method experiments, hyperparameter tuning or production model promotion were performed. `forecast-service/engine.py` SHA-256 remains `3b635cf93c0c19af2a4ea6cac0dc0dec4389a05d8ae31ce25e8d9031d967be7b`; earlier research/evaluation files have no changes.

## Reproduction

```powershell
npm run typecheck
npm test -- --maxWorkers=1
npm run build
$env:QA_KEEP_SCHEMA='1'
npm run test:e2e
```

Start the existing FastAPI service before browser integration tests; its health endpoint and the API health endpoint must both return 200. A controlled restart initially stopped FastAPI through the old supervisor, which was diagnosed and corrected by relaunching the existing local supervisor; the successful final browser run includes live service verification. A browser-invalid branch-code pattern was fixed before the successful run. The test now waits for the actual forecast response using the API's longer operation budget instead of a shorter toast-only timeout.

Native backup/migration evidence is under `.local/multi-branch`; private snapshot inventories and verification proofs accompany each dump under `.local/backups`. Cleanup manifests, retained-stock comparisons and preservation exports are under `.local/cleanup-dry-run`. No database credentials, bank images, guest capabilities or private dumps are committed.

## Scope and limits

Automated accessibility checks supplement the exercised native controls/keyboard flow, not a complete accessibility certification. No external deployment, large-scale load benchmark, stock-transfer workflow or physical inventory count is claimed. Cleanup awaits explicit approval against [the reviewed plan](operational-data-cleanup.md); nine unmarked orders and ten provisional opening receipts remain preserved. Legacy stock keeps its pending-count warning. All verification/QA databases remain retained pending separate cleanup approval.
