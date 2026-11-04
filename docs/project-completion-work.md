# Remaining project work: authorized items 1–13

User authorized implementation of items 1–13 on 2026-11-04. Preserve existing modules, nine unmarked orders, ten pending-count opening receipts and all research/issued predictions. Commit and push incrementally. No production model promotion based on a different dataset.

1. Approved marked operational cleanup: refresh review, verify fresh backup, remove only reviewed candidates, reconcile retained ledger, verify preserved records.
2. Provisional opening stock: keep pending-count status until actual quantities are supplied.
3. Audited stocktakes and adjustments with conflict checks.
4. Reconcile current release documentation.
5. Real-user acceptance test kit and result recording; actual user trial pending (user confirmed nobody available).
6. Concurrent-user/load benchmark with isolated data and measured report.
7. Prospective genuine-sales forecast evaluation and coverage/readiness; genuine future outcomes pending.
8. Receipt printer setup/test kit; physical device test pending (user has no printer).
9. Authorized atomic branch transfers and traceability.
10. Suppliers, purchase orders and partial receipts.
11. Inventory lots, expiry and consumption/waste integration; preserve unallocated legacy stock explicitly.
12. Lead-time based replenishment planning from saved forecasts and verified inventory, with limitations.
13. Branch valuation and operating-expense reporting without fabricating old costs or calling gross margin net profit.

Use additive migrations and existing role/RLS boundaries. Public dataset planning remains isolated. Items 5,7,8 cannot claim real-world validation without external participants/data/devices. No invented physical stock counts.

Progress: item 1 committed in the database with a verified execution receipt; item 2 retained pending physical count. Additive FK lookup and audited stocktake migrations were validated and applied. Stocktake backend tests cover explicit quantities, signed deltas, idempotent commit and intervening-movement conflicts. User confirmed no real participants or printer are available: items 5 and 8 remain external validation pending, with test kits to be prepared.

Stocktaking is implemented as a draft/review/commit workflow with signed adjustment movements, per-ingredient count timestamps, version-conflict rejection and idempotent confirmation. Committed count records/lines are protected against edits. The existing isolated browser suite passed 29 workflow checks including stocktaking; all 119 tests passed before the additional immutable-history assertions, whose focused test also passed. No physical count was entered into the operational shop. A stale opening-stock banner clears only for ingredients whose counts have actually been confirmed.
