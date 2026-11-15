# RIVOX optical surfaces and adaptive light — 15 November 2026

This presentation release builds on the existing dark blue workspace and its
atmosphere. It keeps the operational components, data contracts, permissions,
MFA, approvals and financial rules in place.

## Appearance and interaction

- An original liquid-light shader adds three slowly folded blue/cyan/violet
  ribbons and narrow caustic edges behind the workspace. The existing CSS
  atmosphere remains the fallback when graphics are unavailable.
- One delegated pointer response lights card borders and turns the decorative
  dashboard sculpture through a small angle. Reading surfaces and controls stay
  stationary; decorative layers do not intercept clicks.
- Page transitions reveal a bounded set of sections in sequence without
  remounting forms or query state. Only route changes start this sequence.
- The toolbar's **Visual effects** button and the access screen's **Appearance**
  button offer Cinematic and Quiet modes. The choice stays in this browser,
  synchronizes between tabs, and never changes a workspace setting. System
  reduced motion always takes priority.
- Fifteen table scrollports expose a named keyboard target and a scroll hint
  only when their actual contents overflow. Native arrow keys and touch scrolling
  remain available. Mobile navigation and controls retain visible keyboard focus.
- Operational alerts close on outside interaction, Escape and route changes.
  Opening command search cannot stack a second modal over the appearance dialog.

## Runtime bounds

There is no graphics dependency or external service. The optional WebGL1 field
has a fixed fragment cost, a 420,000-pixel maximum drawing surface, a 2,048-pixel
edge limit and a maximum 30 rendered frames per second. Slow drawing reduces
quality and frame rate, then falls back if it remains unsuitable. Context recovery
is bounded, and GPU objects and event listeners are released on cleanup.

Small screens, coarse pointers, data-saving mode, hidden pages, Quiet mode and
reduced motion suppress or pause the GPU field. The delegated optical response
coalesces pointer updates through a single frame and reads one surface rectangle.
Background effects pause when the document becomes hidden.

## Verification evidence

ESLint, TypeScript and the production build passed. The suite passed 402 tests;
four opt-in live-read tests remained skipped. Firefox passed 88 layout checks
across 22 local fixture views at four viewport widths, without JavaScript errors
or horizontal page overflow. Focused checks cover mode persistence, native radio
keyboard interaction, system preference priority, form
identity and values, surface geometry, table keyboard scrolling, modal isolation,
alerts and 24 rapid mobile focus cycles.

Firefox headless returned no native WebGL context. Its real CSS fallback was
checked; browser GPU rendering is not claimed. A separate real Mesa/EGL GLES
check compiled, linked and rendered the exact shader sources, verified readback,
and measured changes between two time samples. This is graphics verification,
not a benchmark on an employee's device.

The full layout report and final publication receipt are separate artifacts.
Browser operational screens use isolated sample data; commercial writes and
external requests are blocked. Production verification checks the exact source
commit, Ready status, canonical domain, public assets, anonymous private-route
denial and unchanged environment records. No database or environment change is
part of this release.
