# Operational audit and cleanup approval gate

**No cleanup deletion has executed.** The user explicitly chose to retain all nine unmarked orders. This report is not deletion approval. [The supplied request](multi-branch-target-spec.md), Step 3.6, says: “Stop and request explicit approval before executing destructive deletion on any database, including development, staging, or production.”

## Audit and classification

The post-migration snapshot (2026-11-04 08:43 UTC) contains 10,515 orders, 10,049 payments, 35,672 movements, 211 closings, four accounts and three branches. Previous business rows were preserved exactly, apart from added branch metadata. New branches contain no transactions and zero stock.

Sources audited: `src/demo.ts`, marked shop replay and isolated simulation scripts, migrations, startup scripts, API/report queries and frontend metrics. Normal startup never invokes demo creation. There is no customer entity table; guest capabilities belong to orders. Dashboard/report numbers come from stored ledger queries.

Classification uses explicit simulation-run references, explicit demo source, exact reconciliation to generated payment/item rows and the known opening seed marker. Age, unusual quantities, names or email patterns alone are not deletion evidence. Original demo-created accounts may now be in use: preserve all four accounts without credential resets, as well as all product/recipe/ingredient masters, dining tables, bank QR settings, security audits and migrations.

## Read-only candidate counts

| Generated group | Rows | Evidence |
|---|---:|---|
| Orders | 10,506 | Explicit simulation-run reference |
| Order items | 10,506 | Children of those exact orders |
| Status logs | 61,219 | Children of those exact orders |
| Payments | 10,042 | Explicit marker and matching parent provenance |
| Stock movements | 35,634 | Explicit marker and checked parent/branch references |
| Day closings | 211 | Explicit marker |
| Demo sales summaries | 672 | Explicit demo source |
| Generated actual-source summaries | 1,683 | All inputs marked; quantity/revenue exactly match stored summaries |

These overlap through relationships; they are not independent transaction totals. Four actual-source summaries remain outside the generated candidate set and are retained. Dates overlapping a replay are insufficient grounds to remove them.

Preserve nine unmarked orders, seven unmarked payments and their related movements. The unmarked movement set has 38 rows: 28 operational sale movements and ten opening receipts carrying the known demo seed marker. The nine orders remain intact as explicitly requested.

Preserve **all 37 issued forecast archives and 4,999 points**, including the two explicitly marked runs; finding simulation provenance does not authorize destroying issued evidence. Preserve both research datasets, 79,473 demand rows, 17 Replay runs/20,496 points, model artifacts, evaluation files and simulation provenance. All 488 forecast cache rows and two job records are also excluded from this cleanup.

## Provisional stock policy chosen; deletion still pending

Removing both marked movements and all ten demo opening receipts would leave negative retained-ledger balances for **seven** ingredient/branch pairs, because retained orders consumed those opening quantities. A blanket deletion/reset to zero is invalid while keeping those orders.

The private dry-run records current balances, projections after removing marked movements and projections after also removing opening receipts. Projections are **not physical stock counts**. No inventory quantity has been reset, fabricated or accepted as a real count. The app continues to identify legacy demo opening stock for review, even if marked orders are later removed.

The user subsequently chose to **retain all ten opening receipts with pending-count labeling**. The proposed cleanup restores current balances to sums of retained movements, without changing their quantities or historical snapshots. Every projected balance matches the last retained movement snapshot; mismatch count is zero. Exact proposed values are in the private `review.md`. This is a provisional ledger policy, not verified physical stock. A later count requires an explicit audited inventory action. New branches can begin clean with user-entered receipts.

The read-only command also preserves synthetic completed product/day outcomes, simulation provenance/closings and all original forecast inputs/predictions/cache in `synthetic-workflow-research-archive.json`, explicitly labeled synthetic. Its hash/counts accompany the report. No training or evaluation is performed. Public Replay tables and all forecasting records stay in the database. Future deletion of simulated orders may remove their live actual-value joins; this separate export and existing reports preserve the research evidence.

## Verified backups

Private dumps/manifests/record IDs are excluded from Git:

| Snapshot | Private file | Verification |
|---|---|---|
| Before migration | `.local/backups/coffee-2026-11-04T07-31-48-773Z.dump` | Restored, all 33 table counts and migration checksums match |
| After migration | `.local/backups/coffee-2026-11-04T08-43-53-676Z.dump` | Restored, all 37 table counts and migration checksums match |

SHA-256 respectively: `fa037ce3c3f65559bb017e90f4e622cee15816a1670a23998c232e21620d4071` and `64e6429ae31d6e424174ebb659da5d573bef371f62d057a7101de72d53f31991`. Each has a JSON inventory and `.verified.json` proof.

Verification uses a new isolated database and skips only creation of its already-existing empty `public` schema. It executes no DROP/DELETE/TRUNCATE, retains sessions in the unserved verification copy, and does not provision/grant source or cluster privileges. Existing runtime role metadata is checked read-only. Actual approved recovery has a separate runtime-grant/session-revocation procedure.

## Dry-run and future approval

```powershell
npm run data:audit
npm run db:verify-backup -- .local/backups/<snapshot>.dump
npm run data:cleanup:dry-run
```

The audit writes a private candidate manifest, counts and relationships. The cleanup command runs in a repeatable-read **READ ONLY** snapshot and has **no execute mode**. It lists exact IDs/counts, provenance blockers, projected branch stock and a deterministic candidate hash, and rejects execution arguments. The human-readable `review.md` names proposed resulting balances; JSON contains exact IDs and all checks.

The reviewed candidate hash is `6f03cd2bcfa2565d5e7dd5aa3d70dcdac54dc409d58b06febe5a2fe4e0356269`. The reviewed plan hash, also covering retained counts and stock projections, is `8b59310e026bbea080a290fb20deab9b6285dd54fd653ad7fc481016d63674d8`. Refresh the backup/review if counts, IDs, provenance or business activity change. Final private review: `.local/cleanup-dry-run/2026-11-04T11-14-43-704Z/review.md`.

The separate preservation export includes all 672 legacy demo training rows, 1,683 fulfilled synthetic product-days, 37 issued input snapshots and 4,999 original prediction points. Its verified SHA-256 is `2a7d7dbe91df738130314f7a4c146bb9a9de29672d9ed032eb5b63a9a8767fdd`. Forecast dates remain original calendar-date strings. Evidence resides under `.local/cleanup-audit`, `.local/cleanup-dry-run` and `.local/multi-branch`.

After explicit deletion approval, prepare a transaction naming only approved IDs, recheck provenance/unmarked relationships and remove generated dependent rows before parents. Handle only exactly reconciled generated summaries. Keep all immutable forecast/research data and all unmarked transactions. Restore reviewed retained-ledger balances while keeping opening receipts and their pending-count warning, check FKs/remaining counts and verify remaining-data/empty states.

**Stop and obtain explicit approval before that transaction.** No deletion executor, blanket truncate, dropped table or destructive cleanup migration was created or run. Temporary verification databases and QA schemas are retained; their deletion also requires approval. Cleanup remains blocked pending explicit deletion approval. Retained opening stock stays labeled pending physical verification, not presented as counted real inventory.

## Execution update — 2026-11-04

The user explicitly approved the exact refreshed cleanup plan separately after the automatic review required a dedicated confirmation. Cleanup committed successfully against candidate hash `6f03cd2bcfa2565d5e7dd5aa3d70dcdac54dc409d58b06febe5a2fe4e0356269`. Nine unmarked orders, seven payments, 38 retained stock movements (including all ten pending-count opening receipts), users/masters and all issued forecasting/research archives remain. Retained-ledger stock was reconciled; it is not a physical count.

Fresh backup: `.local/backups/coffee-2026-11-04T12-53-14-382Z.dump`, SHA-256 `35a8f0c2f5dda36da1fc0021446e832e776d6dc5be0ec927b6f26d7e6a4fbe78`, restored to a new verification database with all 37 table counts and migration checksums matching. Private execution receipt: `.local/cleanup-dry-run/2026-11-04T12-53-11-960Z/execution-receipt.json`; committed=true, preserved fingerprints verified for 37 groups. An initial slow transaction was explicitly cancelled and rolled back before adding child-FK lookup indexes; no constraints were disabled. Legacy mirrored stock quantity/version changed only as necessary to reflect retained branch balances.

Earlier approval-pending sections above describe the pre-execution review. This update supersedes their pending status. No physical stock, user/device acceptance or prospective forecasting validation is claimed.
