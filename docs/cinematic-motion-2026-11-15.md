# RIVOX atmospheric motion and depth — 15 November 2026

This presentation release extends the workspace redesign with a continuous
blue/cyan/violet atmosphere, a fine-pointer light halo, perspective grid and
small decorative star field. The same atmosphere spans login and operational
pages, without including any account data or status indicators.

The dashboard emblem now floats above an illuminated plane, with slow orbital
rings, bevelled edges and travelling reflections. Cards, navigation, buttons
and focused fields use restrained lighting and depth. Operating surfaces keep
stable geometry; the decorative layers do not intercept input.

Changing pages animates the route surface through the Web Animations API.
The wrapper does not key/remount its children, so filter changes, query refreshes
and clock ticks do not reset forms or restart navigation effects. The loading
surface is shown only through the existing Next.js loading boundary.

## Accessibility and runtime behavior

- The system reduced-motion preference disables decorative loops, pointer
  tracking and route animations, including when the preference changes live.
- Coarse pointers receive no cursor halo. Small screens use fewer ambient layers.
- Background animations pause when the document is hidden. Pointer updates
  coalesce through one requested frame; there is no idle JavaScript loop.
- Mobile drawer focus is established before paint. Tab stays inside, Escape
  restores focus, and opening command search does not lose focus to the drawer.
- No API contract, permission, MFA check, approval, financial rule or environment
  variable changed. No extra external service or graphics dependency was added.

## Verification

ESLint, TypeScript and the production build passed. The existing suite passed
398 tests; four opt-in live-read tests remained skipped.

Firefox checked 22 local fixture views at four viewport widths (88 layout
checks), eight final focused captures, pointer/click-through behavior and route
animations preserving their surface and input state. Reduced-motion tests found
zero decorative loops and route animations. After correcting a drawer focus
timing issue, 24 immediate keyboard cycles passed across normal/reduced motion,
including command search and viewport resizing. There were no page overflows,
JavaScript errors, external requests or commercial writes in these checks.

Two frames and a short WebM demonstrate actual motion using local sample data;
they are not records of the live Seller account. The final Vercel receipt
separately verifies source commit, Ready state, production alias, public styles
and unchanged environment records.
