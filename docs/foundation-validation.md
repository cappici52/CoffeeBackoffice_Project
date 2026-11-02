# Foundation validation

Historical record of the initial Foundation delivery. The core application and frontend have since been implemented; see README.md and docs/roadmap.md for current scope and verification commands.

Local validation on 2026-11-02:

- TypeScript strict typecheck and production build passed.
- 16 integration/configuration tests passed using PGlite: migration replay, health, production origin requirements, cookie/token handling, invalid input, CSRF origin checks, role restrictions, user pagination, privilege escalation prevention, session revocation/expiry, password changes, rate limiting, safe bootstrap, audit data and transaction rollback.
- UI design-document lint: zero errors; warnings for seed tokens not yet referenced by components. These are planned frontend tokens; no UI is implemented.
- Premium static design audit: zero findings. This is not browser or visual verification.
- Docker and PostgreSQL server are unavailable on this workstation. Container execution, real PostgreSQL behavior and concurrent request behavior are not verified locally.

The GitHub workflow runs the tests on PGlite and PostgreSQL 18, then builds the API and Docker image. Workflow configuration alone does not imply a successful remote run.

## Delivery boundary

Foundation provides a runnable API, migrations, owner bootstrap, sessions, password changes, role restrictions and user administration. It does not yet provide frontend pages, menu/order/stock tables, POS/KDS, payment processing, reports or forecasts. Those remain subsequent milestones in the roadmap. The dark minimal UI preference is recorded in DESIGN.md.
