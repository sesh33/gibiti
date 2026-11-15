# RIVOX visual refresh — 15 November 2026

The existing dark blue identity is retained across the workspace. This release
adds a consistent visual system to every operational and access screen, without
changing Seller API contracts, financial rules, database policies or credentials.

## What changed

- Locally served Manrope variable typography, with its Open Font License.
- A clearer color and surface hierarchy, consistent inputs, buttons, tables,
  status badges, dialogs, empty states, errors and keyboard focus indicators.
- Reordered module navigation, stronger active states, sticky workspace header,
  direct command-search shortcuts for importing and creating offers.
- A mobile navigation drawer with Escape handling, focus containment and return,
  inactive background content and a keyboard skip link.
- Individual visual treatments for Overview, Orders and order details, Offers,
  offer creation/editing, batch changes, import, Inventory, Team, Approvals,
  Activity, Automation/pricing, Seller center, Reports, Reply library, Inbox
  and Settings.
- Refined login, MFA, Owner setup and account invitation screens.
- Compact operational guides, report cards, file-import surfaces, product and
  customer identities, pricing assumptions and evidence, integration health
  and permission-profile cards.
- Responsive layouts and reduced-motion support. No financial chart, account
  statistic, live status or marketplace capability was fabricated for the design.

Presentation styles are separated into the base refresh and scoped commerce,
operations, settings and access/overview stylesheets. Existing operational
logic, authorization checks, approvals and API requests remain in place.

## Verification

- ESLint, TypeScript and the Webpack production build passed.
- The existing suite passed: 398 tests; four opt-in live-read tests skipped.
- Firefox 157 rendered the real components for 22 routes at 390, 768, 1024 and
  1440 pixels: 88 layout checks, plus eight final focused recaptures.
- No horizontal page overflow or JavaScript errors were recorded.
- Mobile drawer focus/Tab/Escape, command search and local font loading passed.
  Login fields, form validity and submit reachability were checked without
  submitting credentials.
- The visual harness used isolated local fixtures, blocked external requests
  and commercial writes, and made no production backend calls. Its screenshots
  are design evidence, not actual account data.

Production publication is checked separately through the Vercel deployment API,
exact source commit, canonical alias, HTTPS login and anonymous private-route
denial. Environment records are compared privately before and after deployment;
their values never enter the report. The release receipt contains the final
deployment identifiers and verification outcome.
