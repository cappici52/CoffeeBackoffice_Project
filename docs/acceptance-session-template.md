# User acceptance session — awaiting real participants

Status on 2026-11-04: **NOT RUN — no real participants available**, confirmed by the user. Automated browser tests are separate evidence, not a substitute for user acceptance.

Copy this template to private `.local/acceptance/<date>-<participant-code>.md`. Do not commit names, credentials, bank images, customer identities or private order links. Use a participant code and role. Record actual observations without filling results in advance.

- Session date/time:
- Participant code / role:
- Prior POS experience:
- Build / commit:
- Device / browser / network:
- Branch / isolated data source:
- Observer:

| Task | Role | Expected result | Actual observation | Pass / fail / not run | Evidence / issue |
|---|---|---|---|---|---|
| Sign in and choose assigned branch | Staff | Assigned data only; forbidden branch rejected | | Not run | |
| Enter a sale with menu options | Cashier | Correct menu/price/ingredients; no duplicate stock deduction | | Not run | |
| Recover a repeated payment submission | Cashier | Same order and payment, no duplicate charge | | Not run | |
| Order via table QR and track | Customer | Correct table; only own order visible | | Not run | |
| Prepare and deliver a paid/unpaid order | Kitchen | Correct recipe and transitions; no payment disclosure | | Not run | |
| Collect payment after dining | Cashier | Served order can be paid once | | Not run | |
| Receive/waste an ingredient | Manager | Signed movement and correct branch balance | | Not run | |
| Draft and confirm a physical count | Manager | Review delta; stale count rejected; immutable confirmation | | Not run | |
| Receive a PO partially | Manager | Remaining amount correct; no over-receipt or duplicate receipt | | Not run | |
| Handle an expired lot | Manager | Excluded from sale; explicit waste records disposal | | Not run | |
| Transfer between assigned branches | Manager | Linked outgoing/incoming; expiry/cost retained | | Not run | |
| View valuation and record/void expense | Owner | Unknown costs visible; void retained in history | | Not run | |
| Review delivery-time replenishment | Manager | Arrival date, urgent shortage and incomplete-coverage caveats understood | | Not run | |
| Close a business day | Manager | Pending/unpaid orders block closing; final summary retained | | Not run | |
| Interpret future forecast and public Replay | Owner | Can distinguish forecast, held-out actuals and uncertainty | | Not run | |

For each task, record completion time, assistance required, misleading labels, accidental actions and recovery. Ask the participant to explain the result in their own words before helping.

Questions (1–5, leave blank until answered): clarity, ease of completing the task, error recovery, confidence in stock/report figures. Collect free-text improvements. Describe participant count and limitations; do not generalize from a single session.

Acceptance criteria: no unreviewed money/stock duplication, no cross-branch or role exposure, no unexplained critical workflow failure, and unresolved findings listed with severity. Link issues to corrective commits and retest affected tasks. A browser check passing does not automatically mark any row above as passed.
