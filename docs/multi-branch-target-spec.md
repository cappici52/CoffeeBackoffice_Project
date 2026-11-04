# CoffeeBackoffice — Multi-Branch System & Demo Data Cleanup

We are pausing all forecasting experimentation for now.

The next development priority is to transform CoffeeBackoffice from a single-branch application into a scalable multi-branch coffee shop management system.

We also want to remove synthetic/demo operational data from the actual application database so the application can start with clean, real user-created operational data.

Repository:
https://github.com/cappici52/CoffeeBackoffice_Project

## Part 1 — Multi-Branch Architecture

Implement support for multiple coffee shop branches.

The initial system should support 3 branches, but the architecture must allow unlimited branches in the future.

Do not hardcode exactly 3 branches.

### Branch Management

Create a branch management module with:

- Create branch
- Edit branch
- Activate/deactivate branch
- View branch details
- Assign employees to branches
- Assign managers to branches
- View branch-specific operational information

Suggested fields:

```text
branches
- id
- name
- code
- address
- phone
- status
- created_at
- updated_at
```

Reuse existing tables and naming conventions where appropriate.

### Branch Selector

Add a branch selector to the Backoffice interface.

Example:

```text
Current Branch:
[ Branch 1 ▼ ]

Options:
- All Branches (authorized users only)
- Branch 1
- Branch 2
- Branch 3
```

Changing the selected branch should update branch-specific operational data.

The All Branches option should display aggregated information for authorized managers/owners.

Do not allow branch selection alone to bypass backend permissions.

### Orders and POS

Each order must belong to a specific branch.

Requirements:

- Branch-specific orders
- Branch-specific POS transactions
- Branch-specific order history
- Branch-specific KDS queues
- Branch-specific sales totals
- Correct branch assignment for every new order
- No accidental cross-branch order access

### Inventory

Inventory must be managed independently for each branch.

Example:

Branch 1:
- Coffee beans: 10 kg
- Milk: 20 L

Branch 2:
- Coffee beans: 5 kg
- Milk: 12 L

Selling products at Branch 1 must deduct inventory from Branch 1 only.

Use branch-scoped stock balances and movements.

Preserve existing recipe and stock deduction logic.

Design for future inter-branch stock transfers, but do not implement complex transfer workflows unless necessary.

### Products and Recipes

Products and recipes may be shared centrally.

However, the system should support:

- Branch-specific product availability
- Branch-specific product pricing when needed
- Branch-specific stock availability
- Shared default recipes

Avoid duplicating every product and recipe unnecessarily.

### Employees and Permissions

Support these roles conceptually:

SUPER_ADMIN / OWNER:
- Manage all branches
- View consolidated reports
- Manage users and permissions

BRANCH_MANAGER:
- Manage assigned branches
- View assigned branch reports
- Manage assigned branch inventory

STAFF:
- Access authorized branch operations
- POS and order management according to permissions

Reuse the existing authentication and authorization system.

Enforce branch permissions on the backend, not only through frontend filters.

### Dashboard and Reports

Add support for:

- Sales by branch
- Orders by branch
- Revenue by branch
- Inventory by branch
- Consolidated total revenue
- Branch comparison
- Date range filtering

All totals must use actual stored operational data.

No hardcoded sample metrics.

### Database Migration

Inspect the existing database schema first.

Add branch relationships where required.

Likely affected entities:

- Orders
- Order items through their parent orders
- Inventory
- Stock movements
- Employees
- POS transactions
- Reports
- Operational settings

Use proper database migrations.

Preserve relational integrity.

Do not assign arbitrary branches to existing records.

If legacy records require branch assignment, create an explicit migration strategy and document it.

---

## Part 2 — Remove Demo Data from the Actual Application

The current application contains synthetic/demo operational records created during development.

I want the actual application to use clean operational data.

IMPORTANT:

Do not immediately execute DELETE, TRUNCATE, DROP, or destructive migration operations.

First audit all existing data.

### Step 1 — Data Audit

Identify:

- Synthetic orders
- Demo transactions
- Fake customer records
- Fake employees
- Demo inventory movements
- Simulated sales history
- Seeded reporting data
- Hardcoded frontend dashboard numbers
- Mock API responses
- Development-only demo data

Determine which records are definitely synthetic and which may be real.

Never classify records as synthetic solely because they are old or have unusual values.

### Step 2 — Preserve Important Data

Do not remove:

- Real user accounts
- Real operational transactions
- Required system configurations
- Production master data unless explicitly approved
- Existing database migrations
- Forecast experimental datasets
- Historical Replay datasets
- Forecast evaluation reports
- Model artifacts
- Research results

Keep public dataset experiments separate from the production application.

### Step 3 — Safe Cleanup

Before any destructive operation:

1. Create a verified database backup.
2. Generate an audit report listing candidate records.
3. Show record counts and affected relationships.
4. Identify which records are safely removable.
5. Prepare a dry-run cleanup.
6. Stop and request explicit approval before executing destructive deletion on any database, including development, staging, or production.

Do not assume that all existing records are synthetic.

Do not delete data with uncertain provenance.

### Step 4 — Clean Application Experience

After approved cleanup, the application should display proper empty states.

Examples:

```text
Orders:
No orders yet.

Revenue:
฿0.00

Inventory:
No inventory records yet.

Reports:
No sales data available.

Customers:
No customers found.
```

Do not display fake sales numbers or placeholder records as if they were real.

Do not automatically regenerate demo transactions on application startup.

Separate optional demo seed scripts from production startup and migrations.

Development demo data should only be generated through explicit developer commands in isolated environments.

---

## Part 3 — Forecasting Compatibility

Do not continue model experimentation.

Keep the current forecasting architecture and production model unchanged.

Ensure the system remains compatible with multi-branch operational data.

Future forecasting should support:

```text
Branch 1 -> Branch 1 Forecast

Branch 2 -> Branch 2 Forecast

Branch 3 -> Branch 3 Forecast
```

Consolidated forecasting may be added later.

Do not combine sales histories across branches without explicitly designed evaluation and model logic.

Keep existing historical replay and public dataset research results.

---

## Part 4 — Testing

Add tests for:

- Creating branches
- Branch selection
- Branch-scoped permissions
- Branch-specific orders
- Branch-specific stock deduction
- Product availability by branch
- Branch-specific reporting
- Consolidated reporting
- Prevention of cross-branch data access
- Legacy data migration
- Empty dashboard states
- Absence of automatic demo-data seeding
- Existing single-branch workflows

Do not break existing POS, KDS, Recipe, Inventory, authentication, or reporting functionality.

---

## Part 5 — Implementation Process

1. Inspect the complete repository.
2. Audit current schema and demo-data sources.
3. Create a multi-branch implementation plan.
4. Implement database and backend branch support.
5. Implement authorization and branch isolation.
6. Implement frontend branch selector and branch management.
7. Update inventory, POS, KDS, and reports.
8. Prepare demo-data cleanup audit and dry-run.
9. Implement empty states and remove automatic mock-data generation.
10. Run automated tests and regression tests.
11. Update technical documentation.

Preserve all working code where possible.

Do not rewrite the entire application.

Do not perform destructive database operations without explicit approval.

## Expected Deliverables

Provide:

1. Multi-branch architecture summary
2. Database schema changes and migrations
3. List of modified files
4. Branch management functionality
5. Branch-specific POS, inventory, KDS, and reporting
6. Role-based branch permissions
7. Demo-data audit report
8. Safe cleanup plan and dry-run results
9. Testing results
10. Remaining limitations

The final goal is a production-oriented multi-branch CoffeeBackoffice application with clean operational data, while preserving all existing forecasting research and evaluation work.