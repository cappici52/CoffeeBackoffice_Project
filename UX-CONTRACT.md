# Coffee Backoffice UX contract

Thai operational product for a single coffee shop: owner/manager desktops, cashier tablets and bar/kitchen touch displays. Language: Thai, currency: THB, business timezone: Asia/Bangkok. Accessibility target: WCAG 2.2 AA; automated browser checks supplement keyboard and visual checks, not a claim of a complete accessibility audit.

## Business-context sources

| Domain | Source | Reviewed |
|---|---|---|
| Roles and product workflows | docs/coffee-shop-backoffice-spec.md sections 3–7 | 2026-11-02 |
| Price snapshots, payments, refunds, inventory and day close | docs/domain-decisions.md | 2026-11-02 |
| Dark-only minimal appearance | User request; DESIGN.md | 2026-11-02 |
| Manual PromptPay and browser receipts | Initial development recommendation; docs/roadmap.md | 2026-11-02 |
| Account authorization | src/security.ts, src/users.ts; tests/auth.test.ts | 2026-11-02 |
| Table QR / customer ordering | User request; docs/table-ordering.md | 2026-11-02 |

## Visual contract

DESIGN.md explains intent. `client/styles.css :root` is the canonical runtime token source; the document mirrors its accepted values. Shared controls live in `client/ui.tsx`. Fonts are self-hosted. Dark is the only theme; printed receipts use black on paper. No theme switch or bright application panels.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | client/ui.tsx Select | This contract | native | browser selection + keyboard |
| Date | client/ui.tsx Input type=date | This contract | native | browser range forms |
| Form | client/ui.tsx Form, Input, Secret, Textarea | This contract | create/edit/filter | browser CRUD + validation |
| Scrollbar | client/styles.css global rules | DESIGN.md | geometry exceptions | computed style + responsive QA |
| Toast | client/ui.tsx ToastProvider, Notice | This contract | status/error/warning | browser live-region checks |
| CRUD | feature routes + client/lib.ts | Domain decisions | modal save returns to owning list | scripts/browser-test.mjs |
| Menu browser | client/components/ProductBrowser.tsx | DESIGN.md | POS / anonymous customer | browser ordering checks |
| Menu item editor | client/components/ItemEditor.tsx | Shared form contract | staff / customer action labels | browser options + keyboard |
| Menu photograph | client/components/MenuPhoto.tsx | DESIGN.md | catalog / item preview / compact admin | local image loading, failed-image fallback and mobile browser checks |
| Menu photo upload | Menu ProductEditor + shared Input/Form | docs/menu-photographs.md | single image, saved with menu | image API security tests + mobile upload browser check |
| Cart rows | client/components/CartLines.tsx | docs/table-ordering.md | staff / customer | quantity, notes and recovery checks |

Native select/calendar popup geometry and platform language are intentionally accepted. Labels and app-owned messages remain Thai; no authored calendar/listbox is required. There is no bulk table selection in this release.

## Flow ledger

| Operation | Pending | Success | Failure/recovery | Focus/source |
|---|---|---|---|---|
| Create/edit menu, category, stock or user | disable form; fixed-size busy action | close modal, reload owning list, shared toast | retain values and inline error | return to trigger; source specification modules |
| Change permission/deactivate | explicit confirmation naming consequence | invalidate affected account sessions | keep editor | src/users.ts |
| Remove/archive | explicit dialog with object and consequence | refresh same list | retain current context | domain-decisions.md |
| POS checkout | confirm actual payment; disable duplicate submit | clear cart, show order number and receipt link | preserve exact request key/body if result uncertain; retry same request | domain-decisions.md payment contract |
| KDS action | disable transition until response | refresh board and keep oldest first | inline error and reload latest state | specification KDS module |
| Close day | explicit final form and warning | immutable closing summary | show pending-order/already-closed reason | domain-decisions.md |

## Forms, navigation and feedback

- Forms use `noValidate`; shared validation checks constraint metadata and displays Thai field errors, associated help and first-invalid focus. Server errors remain inline. Passwords are masked with accessible toggles; paste and password managers work.
- Modal dialogs use native `dialog.showModal()` for focus isolation, Escape and focus restoration; dirty form dismissal asks before discarding. Route navigation and browser unload are guarded for dirty editors. Recipe changes ask before switching to a different menu. Busy modal mutations cannot be dismissed using the close control.
- Native buttons/links keep hover, focus, active, disabled and busy states. KDS actions are at least 56px high. Important labels remain visible rather than relying on icons or colors.
- Non-modal data-entry forms use natural document scrolling. Tables own horizontal overflow. The desktop navigation rail becomes a horizontally scrollable navigation row on narrow screens; it does not widen the page.
- Create/edit returns to the current list. Search/filter/page state lives in URL parameters. Server-paged admin lists use 25 rows; catalog categories, report products and forecast tables use shared client pagination. POS is an intentionally browsable menu grid; KDS is a live active-order board. Charts and bounded date-summary tables are read-oriented.
- Errors, loading, empty and no-results states use shared primitives. Notifications use one polite live region. No browser alert/confirm/prompt flows.

## Async and recovery

- A selected menu photo is previewed locally and uploaded only on save. Canceling selection restores the existing image; unsaved editor dismissal uses the shared guard. Upload/save failures retain the form and allow retry; content hashing deduplicates an uncertain upload response. Only owner/manager can upload. Photos are public catalog content, never private documents. JPEG/PNG/WebP only, 5 MiB and 25 million input pixels; stored WebP has no original EXIF/GPS metadata. Uploaded photos are stored in PostgreSQL and included in database backups.

- Mutations are pessimistic; no automatic retry for money or stock writes. Duplicate submit is disabled. After a network error on stock entry, inspect movement history before retrying.
- POS draft/request key is kept in sessionStorage per user. No password or session token is stored there. A lost checkout response locks the draft until an identical idempotent retry resolves the result.
- GET resources abort stale requests; search is debounced and IME-safe. Clearing is immediate. Sessions use HttpOnly cookies. Expired/revoked sessions return to login; safe POS drafts remain available only under the same account identifier.
- EventSource reconnects automatically, with a visible disconnected state. KDS actions are disabled while disconnected. Server-synchronized timers update locally once a second; they do not request each second. New-order sound is user-enabled because browsers require a gesture.
- Product, recipe and ingredient edits use versions; conflicts require reloading rather than overwriting another person's changes. Stock and order transitions are serialized in PostgreSQL transactions.
- Permissions are checked by the server; hiding navigation is only a UI convenience. Direct forbidden routes show an access message. Kitchen receives no money/cost fields.
- Customer routes never mount staff session/navigation. They expose public menu data and a separate per-order tracking capability only. Table managers use the existing modal/version/confirmation patterns. Customer submissions create unpaid orders and retain the exact request key/body on uncertain completion; a tracking read precedes an identical retry. A changed price quote is rejected for customer review.
- Customer tracking refreshes active orders every five seconds and when visible/online again, and stops periodic requests after served/cancelled. Failed reads leave the last known state visible with a retry message. Same-table draft and own tracking links are retained in sessionStorage, with a maximum 20-entry history. Tracking links are capabilities and must not be shared or logged to analytics. Closed/rotated QR codes block new orders, not existing tracking.

## Verification

`npm run typecheck`, `npm test`, `npm run build`, `python -m unittest discover -s forecast-service` and `npm run test:e2e`.

`scripts/browser-test.mjs` covers the order-to-report workflow, lost payment responses, menu/category/recipe/stock/user forms, password/session lifecycle, permissions, screenshots, runtime errors, keyboard focus and automated desktop/mobile POS accessibility checks. It uses a disposable PostgreSQL schema. The app's shop tables are not used for test writes. Browser plugin is absent; local validation uses Playwright with installed Edge, CI uses Chromium. Screenshots are stored outside source control.

`scripts/qr-browser-checks.mjs` additionally decodes the generated PNG, verifies QR printing, tests anonymous 390px customer pages, lost-submit-response recovery, cashier/KDS status propagation, separate-device privacy and customer accessibility. `E2E_PUBLIC_HOST` can test an actual LAN HTTP origin; development headers do not force HTTPS asset upgrades while production headers retain them.

- Dine-in ordering defaults to payment after dining: staff confirms before KDS, handoff may finish while unpaid, and the customer keeps seeing the outstanding amount until staff records actual payment. Confirmation and payment retries never consume stock twice. Served unpaid orders remain in the queue summary and block day closing.

- Forecast generation evaluates the imported ProjectA XGBoost model, a newly trained shop-history XGBoost candidate and weekly seasonal demand. With 84 consecutive observed days, selection uses a strictly earlier training window and a 28-day recursive validation window; 28–83 observed days use the explicitly labeled weekly method. Missing/old observations show an actionable error. Each stored forecast retains its method/version and actual/demo/mixed history provenance. New point forecasts have no invented interval; legacy mock ranges are labeled separately. Accuracy uses real observations matched to forecasts generated before the target day, never demo data or backcasts.
