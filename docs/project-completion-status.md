# Project completion status — 4 November 2026

This is the maintained current status for the authorized items 1–13. Earlier dated release/research reports remain historical evidence. It distinguishes implemented features from real-world validation, which cannot be fabricated.

| Item | Status | Delivered / remaining |
|---|---|---|
| 1. Operational demo cleanup | Done | Exactly 10,506 marked orders and reviewed dependent records removed after separate explicit approval; nine unmarked orders, ten opening receipts, users/masters and all research/issued predictions retained. |
| 2. Opening stock verification | System ready; physical count pending | Ten provisional receipts retained. Count timestamps remain empty until a real count is explicitly confirmed. No physical count was invented. |
| 3. Stocktaking | Implemented | Draft/review/commit, signed movements, version conflicts, repeat-commit recovery, immutable confirmed documents and pending-count indicators. |
| 4. Documentation consistency | Updated | This status supersedes old pending-cleanup/no-transfer statements; architecture, operations and validation links below. |
| 5. Actual user acceptance | Kit ready; not performed | `/acceptance`, private JSON export and `acceptance-session-template.md`. User confirmed no participants; no real-user pass result is claimed. |
| 6. Concurrent usage measurement | Measured in isolation | Native PostgreSQL/API read burst, last-stock contention, repeated payment requests and competing branch transfers. Local measurements below, not a production capacity certification. |
| 7. Prospective shop forecasting | Instrumentation/guide ready; outcomes pending | Existing immutable operational evaluation retained; per-product table includes RMSE. `prospective-validation.md` defines future collection/quality/timing rules. No sufficient verified new shop sales yet. |
| 8. Physical printer test | Preview/kit ready; hardware pending | 58/80 mm receipt layout, `/printer-test`, manual evidence capture and `printer-acceptance.md`. No device available, so no real print/cutter certification. |
| 9. Branch transfers | Implemented | Authorized source and destination, atomic outgoing/incoming stock, linked records, expiry/cost-preserving lots and repeated-request recovery. Immediate handover only; no in-transit shipping workflow. |
| 10. Purchasing | Implemented | Central suppliers/lead times, branch PO lines, expected date, partial receipts, over-receipt rejection, actual receipt prices, lot creation and cancellation of remaining quantities. No supplier payment ledger is claimed. |
| 11. Lots/expiry | Implemented | FEFO, expired-sale rejection, named-lot waste, original-lot stock returns where allocations exist, legacy unknown-lot/cost/expiry disclosure. |
| 12. Order timing | Implemented as reviewed planning | Genuine/non-simulation saved forecasts × current base recipes, expiry-aware stock projection, expected PO arrivals, order-by/urgent-gap/review-window quantities and readiness warnings. No automatic purchase. |
| 13. Branch valuation/expenses | Implemented | Known lot value versus unknown-cost quantities, expiry/balance discrepancies, owner-only expense entry/void history and cash/known-consumption summaries. Not audited net profit or a complete accounting system. |

## Data preservation and backups

Cleanup proof: private `.local/cleanup-dry-run/2026-11-04T12-53-11-960Z/execution-receipt.json`. It records committed=true and preserved fingerprints for 37 groups. The earlier slow transaction was cancelled and rolled back before FK lookup indexes were added; FK checks were never disabled.

Pre-cleanup verified dump: `.local/backups/coffee-2026-11-04T12-53-14-382Z.dump`, SHA-256 `35a8f0c2f5dda36da1fc0021446e832e776d6dc5be0ec927b6f26d7e6a4fbe78`.

Post-cleanup/pre-warehouse verified dump: `.local/backups/coffee-2026-11-04T13-42-21-801Z.dump`, SHA-256 `1cc1921934c327384752de374079aa1e77b6db36cbb545d25f51c7206d84d0a7`; restored into a new verification database, all 39 counts and migration checksums matched. Both dumps and private research preservation exports stay outside Git.

Warehouse migration proof: `.local/warehouse-preservation.json` verifies all **38 pre-existing non-migration tables** projected onto their original columns are unchanged. Ten initial legacy-unknown lots match retained branch balances, with zero lot/balance discrepancies and zero physical-count entries. No dummy suppliers, POs or expenses were inserted into operational data. Additive migrations 017–024 preserve prior archives and historical costs.

## Architecture and safeguards

* Existing Node API and PostgreSQL remain authoritative for operations. FastAPI/models/research methods remain unchanged.
* New tables reuse branch defaults, RLS runtime role and transaction-scoped branch authorization. A transfer requires both active branches and the actor's destination membership (or owner access); membership/role checks and deterministic stock-row locks precede movement.
* Existing stock movements drive lot allocation. Both a branch balance and a lot allocation must succeed in the same transaction. Expired lots cannot satisfy sales. Explicit waste can remove expired stock.
* Unspecified legacy/ordinary-receipt lots have unknown expiry/cost instead of made-up values. Explicit non-perishable status is separate from an unknown expiry; dated and no-expiry declarations cannot conflict. Aggregate physical counts do not verify the composition of individual lots; negative adjustments use FEFO and require reviewing lot composition. Named-lot disposal is available for known discrepancies.
* Existing order item recipe-cost snapshots are preserved. New known-consumption reporting uses lot allocations; unknown costs are disclosed. Cash receipt/refund dates, lot consumption and operating expenses are distinct measures; no false single net-profit figure is produced.
* Public-data evaluation and illustrative recipe planning remain separate from business stock and replenishment. Source `genuine` means not marked as simulation; it does not independently certify that a test account represented an actual paying customer.
* Replenishment uses calendar-day lead times, current base recipes and provisional unknown-expiry availability. Expected PO arrivals can slip; overdue receipts are not treated as stock. Missing menus/recipes, incomplete predictions, insufficient horizon, uncounted balances and lot discrepancies prevent a ready status. Options, waste and supplier holiday calendars are not forecast.
* Purchase receipts, transfers and expenses have request keys; identical retries recover the existing record and changed payloads are rejected. Cancellation/void keeps received stock and original history.

## Measured local concurrency results

Command: `npm run test:load` (build plus explicit isolated benchmark). It creates and retains a generated QA schema, with source row-count/stock-hash checks. It never loads simulated transactions into operational tables.

Measured 2026-11-04, Windows / Node v22.14.0 / 12 available CPU threads, 10 concurrent clients:

| Scenario | Requests | Result | p95 |
|---|---:|---|---:|
| Read catalog | 100 | 100 successful reads | 208.36 ms |
| Compete for last two units | 30 | Exactly 2 sales; 28 stock-protection rejections | 310.82 ms |
| Repeat same logical payment | 20 | All recovered the same order; one deduction | 118.51 ms |
| Competing branch transfers | 2 | One success; one shortage rejection; quantity conserved | 46.96 ms |

Fixture stock ended at 3 in the source branch and 6 at the destination, total 9; fixture orders=3. The operational shop was unchanged. Evidence: `.local/benchmarks/2026-11-04T13-41-48.970Z/report.json`. This short local test is not a long-duration, internet-network or production-scale benchmark.

## Operation

In **วัตถุดิบ / สูตร** use the new tabs: ตรวจนับสต็อก, ล็อต / วันหมดอายุ, จัดซื้อ, โอนสาขา, แผนสั่งเพิ่ม and owner-only ต้นทุน / ค่าใช้จ่าย. Select a single active branch for mutations. Consolidated valuation/expense reads are read-only. Suppliers are centrally maintained by the owner; managers may perform authorized purchasing/stock operations.

Physical acceptance and actual customer outcomes remain external prerequisites, explicitly confirmed unavailable by the user. Do not replace them with generated pass results. See [user session template](acceptance-session-template.md), [printer kit](printer-acceptance.md), [prospective validation](prospective-validation.md) and [cleanup evidence](operational-data-cleanup.md).

## Validation summary

Final local automated regression: **124 tests / 26 files passed**, TypeScript checks and production build passed. The expanded browser suite passed **37 workflow groups** in a retained isolated native PostgreSQL schema, including stocktakes, FEFO receipts, partial purchasing, transfers, valuation/expenses, lead-time readiness, mobile overflow/accessibility, printer preview and manual acceptance export. Final focused tests additionally cover explicit non-perishable expiry status, immutable posted history, insufficient-history readiness and simulation exclusion. The strict UI audit reports zero findings. No physical-device or independent real-user acceptance result is implied.

Final post-extension recovery verification: `.local/backups/coffee-2026-11-04T14-14-09-962Z.dump`, SHA-256 `ab7f5195a113c3c961e70a402fe51a4bd764553b3de7c3b1e6425ff35d331ca5`, restored into a new verification database with all **48** table counts and migration checksums matching; source unchanged and no verification deletions.

GitHub's Linux browser run caught transient tab contrast during background-color animation when selection changed. The shared tabs/segmented controls now transition border color only, keeping text/background contrast stable throughout selection; the accessibility check remains enabled.
