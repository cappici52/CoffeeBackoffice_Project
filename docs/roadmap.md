# Roadmap

Source requirements: [project specification](coffee-shop-backoffice-spec.md). Operational authorization comes from the project owner.

## Current milestone: Foundation

- [ ] TypeScript API, PostgreSQL migrations, development Docker Compose
- [ ] Login/logout, password change, server-side roles and user administration
- [ ] Integration tests, CI and setup documentation

Each completed task is checked, committed and pushed separately.

## Next milestones

1. Menu, category and option CRUD
2. POS, order transitions, manual cash/PromptPay confirmation and browser-printable receipts
3. KDS, timers, recipes and reconnecting real-time updates
4. Recipes, transactional stock deduction, movements and low-stock alerts
5. Sales, profit, preparation-time reports and closing
6. Mock forecasts, seed sales and replenishment suggestions

## Decisions

- Begin with Foundation; introduce domain tables with their implemented modules.
- PostgreSQL, parameterized SQL and versioned migrations; Express/TypeScript API.
- Server-side sessions in HttpOnly cookies.
- Owners control all roles. Managers manage cashier/kitchen staff only.
- Single branch, Thai UI and Asia/Bangkok business dates in subsequent milestones.
- Manual PromptPay confirmation and browser printing initially.
- Forecast remains a mock until the actual model, dependencies and input/output examples are supplied.
