# QR ordering by table

Requested by the user on 2026-11-02: independent QR for every table; customers browse menus, order and see the progress of their own order without backoffice access.

## Domain and authorization

- Owner/manager creates, renames, enables/disables tables and rotates a table's QR. A table has an opaque random 256-bit QR token. Disabling a table or rotating the token blocks new orders from that QR; changing tokens requires reprinting the QR.
- A customer opens `/table/<qr-token>` without login. The public menu includes available, unarchived products with configured recipes, menu options and retail prices. No recipe, stock, ingredient costs, staff identity, user list or business reports are returned.
- New orders are dine-in and bound to the table found by the server, never a table number/price/payment/actor supplied by the customer. Server pricing, option validation, recipe snapshots and request-key deduplication are shared with POS.
- Guest orders have a nullable staff actor, `source=qr` and an explicit dining-table reference. They enter the cashier's order list unpaid, with no stock deduction and no KDS entry until staff confirms actual payment. Existing cash/manual PromptPay and cancellation policies apply.
- Each order has a separate random tracking capability, supplied by the client before submitting and stored as a SHA-256 hash. Knowing a table QR does not allow listing or retrieving other customers' orders. `/track/<tracking-token>` and its API return only that order's retail items, notes, payment state and preparation/handoff status.
- The browser retains the current request key, tracking capability and same-table draft for recovery in sessionStorage. These grant access to the customer's own order, not staff login. A lost response is resolved by the same tracking capability or an identical idempotent retry. Tokens/links must not be included in analytics or third-party QR services. API responses are no-store and no-referrer.
- Public submits are limited to 120 per IP per 15 minutes and at most 10 unpaid pending orders per table; reads have a separate, higher rate limit. Table and request locks bound concurrent submits. This is a single-process IP limiter; a multi-instance deployment needs a shared rate-limit store and correct trusted-proxy settings.
- Closed business days reject new customer orders. Old customer tracking continues after table renaming, disabling or token rotation. The order retains the table name at ordering time.

## Routes

- Admin: `GET/POST /api/tables`, `PATCH /api/tables/:id`, `POST /api/tables/:id/rotate`.
- Public: `GET /api/guest/tables/:qr`, `POST /api/guest/tables/:qr/orders`, `GET /api/guest/orders/:tracking`.
- Public writes accept the configured APP_ORIGIN or PUBLIC_ORIGIN and use no staff session permissions. There is no public order-list endpoint and no customer endpoint to change payment/preparation/handoff states.

## Networking

`PUBLIC_ORIGIN` is the printed QR base URL and an allowed public submit origin. It falls back to `APP_ORIGIN`. A localhost QR works on the server computer only; phones need a reachable LAN address on the same Wi-Fi or an HTTPS deployment. Production public origin must be HTTPS. The Windows firewall/router and Wi-Fi client isolation must permit the connection; URL generation cannot bypass those network settings. Keep this setting in ignored `.env`, not hardcoded in QR source. IP changes require updating PUBLIC_ORIGIN and reprinting links. Existing printed QR capability tokens remain unchanged when only the host setting changes.

## UI ownership

Customer menu/item dialogs share the app's menu item and form components and dark tokens. The customer shell never mounts staff session/navigation components. A QR itself uses a white quiet zone for reliable scanning/printing. Admin changes use shared confirmation dialogs, version checks and list pagination. Customer progress is revalidated automatically while active and when the page becomes visible; network errors preserve the last known state and allow retry. Order status ends at served or cancelled.
