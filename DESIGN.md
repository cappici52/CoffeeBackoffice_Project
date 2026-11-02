---
version: alpha
name: Coffee Backoffice
description: Minimal dark workspace for a coffee shop counter, bar and back office.
colors:
  background: "#171A1C"
  surface: "#212628"
  raised: "#2B3235"
  border: "#465156"
  text: "#EDF0ED"
  muted: "#B1BDB9"
  primary: "#A7C4B5"
  success: "#9CC7A7"
  warning: "#E2BD7A"
  danger: "#F09D97"
  focus: "#CAE4D7"
  qr-paper: "#FFFFFF"
  qr-ink: "#171A1C"
typography:
  sans:
    fontFamily: "'Noto Sans Thai', Tahoma, system-ui, sans-serif"
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
rounded:
  DEFAULT: "0.5rem"
  sm: "0.25rem"
spacing:
  control-height: "2.75rem"
  touch-height: "3.5rem"
  page-padding: "1.5rem"
components:
  button: {}
  input: {}
  table: {}
  order-card: {}
---

# Coffee Backoffice design direction

## Overview

User requirement (2026-11-02): minimal UI; any palette is acceptable except a light theme. Dark is the only application theme. React/Vite implements the primary POS concept in [docs/design/pos-concept.png](docs/design/pos-concept.png), with the same visual system across the remaining workflows.

The reference is a quiet charcoal coffee bar: matte work surfaces, legible order tickets, little decoration. This is an operational product for shop owners, managers, cashiers and kitchen/bar staff. POS is used on a tablet and KDS on a touch display; administrative screens prioritize readable lists. Thai is the primary UI language, THB the currency and Asia/Bangkok the business timezone, based on the supplied brief and conversation.

The signature is a restrained sage selection marker and large tabular order numbers. Familiar controls and task clarity take priority. Avoid marketing heroes, bright surfaces, gradients, glow, decorative charts and ornamental card grids.

Token ownership: `client/styles.css :root` is the canonical runtime source; this document mirrors the accepted values. `colors.<name>` maps directly to `--<name>`; components in `client/ui.tsx` and feature pages consume those semantic variables. `rounded.DEFAULT` maps to `--radius`; 44px controls and 56px KDS actions implement the spacing roles. Typography maps to the self-hosted Noto Sans Thai and IBM Plex Mono imports in `client/main.tsx`. There is no separate Tailwind/theme adapter. Browser QA compares the concept and desktop screenshot, and checks a 390px viewport. See UX-CONTRACT.md for interaction ownership.

## Colors

Use background for the application canvas, surface for working panels and raised for active/hover layers. Primary is a muted sage accent for the main action and selection, with dark text on filled primary buttons. Text/muted colors carry hierarchy; muted text must remain readable. Border separates controls without boxing every section. Success/warning/danger keep operational meaning and always include a text label or icon. Focus uses a visible outline. Do not interpret the dark-only preference as permission for low contrast. Forced-color modes should retain native system colors.

QR signs use `qr-paper` and `qr-ink` for a standard high-contrast code and quiet zone, including the print preview. This functional scan/print surface is the only new white panel; customer menus and tracking remain dark. `client/table-ordering.css` consumes the root tokens from `client/styles.css`.

## Typography

Use sans for headings, controls and Thai content. Self-host the selected fonts when the frontend is built, with Thai-capable fallbacks. Use mono sparingly for order numbers and numeric data. Default body 16px/1.6, section headings 20–24px, KDS content 20px or larger. Keep Thai line height generous; do not apply uppercase transforms or letter spacing to Thai. Prices and counts use tabular numerals.

## Layout

Use a quiet navigation rail on desktop and a compact menu on narrow screens. Prefer aligned rows and section dividers to nested cards. POS separates menu browsing and order summary; stack them on narrow viewports. KDS uses three clearly titled status columns with large touch actions. Administrative tables own horizontal overflow. Start with a 4px spacing rhythm and 24px page padding, reducing to 16px on mobile. Reserve space for status/loading messages.

Customer routes `/table/:token` and `/track/:token` have their own compact shell without backoffice navigation. On mobile, menu tiles use two columns, the cart follows the menu, and a cart shortcut appears while the cart is outside the viewport. The shared menu browser, item dialog and cart rows are used by both POS and customer ordering. Tracking uses a five-step process and a persistent status heading; no decorative metrics or staff controls are shown.

Menu photography uses real photographs only, as requested by the user. The eight supplied menu pictures are locally hosted CC0/public-domain photos; source records live in `docs/menu-photo-sources.json`. There are no on-screen source/license/credit links. `client/components/MenuPhoto.tsx` owns 4:3 reserved framing, the compact admin thumbnail and an image-error/empty placeholder. Catalog photos are decorative alongside visible product names; product/item previews retain the full photograph inside the frame. No AI-generated menu assets are bundled.

## Elevation & Depth

Convey hierarchy with tonal surfaces and borders. Static panels have no shadows. Reserve a subtle shadow for overlays. Do not use glass or background blur to decorate operational screens.

## Shapes

Controls use 8px corners and badges 4px. Keep geometry consistent across roles and screens. Avoid pill-shaped containers for ordinary data rows.

## Components

Buttons use solid primary for the main action, outline/ghost for secondary actions. Separate danger actions and confirm permission changes. Keep busy button dimensions fixed. Controls are at least 44px high; KDS actions at least 56px. Disabled states remain readable and explain unavailable actions where needed.

Inputs have persistent labels, inline validation and visible focus. Passwords are masked with an accessible show/hide control. Use an app-owned spinner for loading. Feedback must distinguish success, failure, empty data, disconnected state and expired session.

Tables are semantic, paginated and aligned. KDS order cards show status, time, items and emphasized customer notes without relying on color alone. Use one outline icon family, paired with text for important actions. Motion is limited to brief state feedback and respects reduced motion. Charts use a restrained palette with text/table alternatives. No real UI state is simulated by decorative static data.

## Do's and Don'ts

- Keep all application surfaces dark, minimal and readable.
- Use Thai action labels consistently across workflows.
- Preserve touch size, keyboard operation and contrast even on dense screens.
- Do not add a light theme or bright panel backgrounds without a new user request.
- Do not add decorative animation or financial/forecast figures that imply real data.
