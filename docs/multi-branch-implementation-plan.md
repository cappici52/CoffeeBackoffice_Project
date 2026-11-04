# Multi-branch implementation plan and legacy decision

Forecast experimentation is paused. Preserve Python models, public research and immutable archives.

1. Audit every operational table and explicit demo sources; create a snapshot backup and verify restoration without deleting any database data. Audit candidates are not approval to delete.
2. Add branches, employee memberships, independent ingredient balances and optional product overrides. Bootstrap three editable branch records, with no limit on future branches.
3. The existing application represents one undivided workspace. Retain all existing operational records in an explicitly named `LEGACY` branch, not a guessed physical shop. New branches start empty; do not spread old records among them. Preserve immutable archives by adding metadata columns with a legacy default, not rewriting archived forecasts. Record this mapping in migration documentation.
4. Reuse existing domain services with transaction-local branch context and PostgreSQL row policies under a dedicated non-owner, non-superuser execution role. Never depend on RLS while executing as a superuser. Scope children and enforce branch-consistent foreign keys. Aggregate scope is read-only and authorized by current user memberships.
5. Keep products, recipes and ingredients as central master data; central edits require the owner. Branch managers control assigned inventory, availability and optional prices. New branch balances start at zero, never copied from another branch.
6. Add backend-validated branch selection, branch management and reports using stored ledgers. Switching scope discards stale loaded operations/cart state with unsaved-change confirmation. All-branch scope is for reporting, not order/payment creation.
7. Guest table capabilities resolve their branch on the server; reject inactive branches. Forecast API and background jobs operate one branch at a time, retaining the same model. Never pool operational histories across branches.
8. Gate explicit demo scripts to isolated databases. Preserve safe empty states. Generate cleanup candidate manifests, affected FK counts, stock reconciliation and a read-only dry-run. Preserve unmarked/uncertain data, accounts, masters, migrations, research and immutable archives.
9. Test branch permissions and isolation, concurrent stock deductions, inherited/default versus override pricing, reports, legacy migration, empty states and existing workflows. Browser-check the minimal dark interface.
10. Stop before any destructive cleanup and request explicit approval against a concrete backup/audit/dry-run. No automatic deletion or demo regeneration.

Initial read-only audit: 10,515 orders, of which 10,506 explicitly marked simulation and nine unmarked; 10,042 marked payments, 35,634 marked movements and 211 marked closings. Preserve all four user accounts and research datasets. Full private record manifest remains under `.local/cleanup-audit`; do not commit credentials, QR capabilities, bank images or database dumps.

User review decisions: preserve all nine unmarked orders and their relationships; retain ten legacy opening receipts with pending-count labeling. No deletion approval has been given. The final dry-run proposes only removal of confirmed generated operational rows and restoration of reviewed retained-ledger balances, preserving all forecasting data.
