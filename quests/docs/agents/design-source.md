# Design source

## Scope map

- Repository root: `WuwaID/`
- Application root: `WuwaID/quests/`
- Frontend root: `WuwaID/quests/web/`
- Backend/API root: `WuwaID/quests/app/`
- Shared UI sources: `WuwaID/quests/tokens.css`, `WuwaID/quests/web/src/index.css`, and `WuwaID/quests/web/tailwind.config.js`
- Delivery surface: browser SPA

## Scope

This document governs the frontend at `WuwaID/quests/web/`.

## Source precedence

When sources conflict, use this order:

1. Current explicit task, issue, or written requirement.
2. `PRODUCT.md` for product behavior, route behavior, data meaning, and constraints.
3. `design.md` for visual identity, interaction grammar, responsive behavior, and accessibility expectations.
4. `tokens.css` for design tokens.
5. `web/src/index.css` and existing components for implementation patterns.
6. `README.md` and repository convention for operational context.

No production URL, Figma file, screenshot fixture, Storybook, or browser support matrix was found in this checkout.

## Canonical sources

- [`PRODUCT.md`](../../PRODUCT.md): product truth and workflow constraints.
- [`design.md`](../../design.md): Sentinel visual and interaction system.
- [`tokens.css`](../../tokens.css): palette, typography, spacing, shape, motion, and z-index tokens.
- [`web/src/index.css`](../../web/src/index.css): shared CSS implementation.
- [`web/src/__manual__/`](../../web/src/__manual__/): manual UI and performance verification.

## Sentinel rules

- Near-black blue ground; never generic gray or purple.
- One cold cyan signal accent for focus, active, selected, links, and primary action.
- Status colors are sparse and must not be the only state signal.
- Manrope is used for interface and reading text.
- JetBrains Mono is used for IDs, counts, source references, and statuses.
- Small radii, hairline structural rules, and flat panels.
- Avoid gradients, glassmorphism, emoji icons, decorative looping animation, and generic card grids.
- Motion explains route or state; reduced motion removes translation and shimmer.

## Responsive and accessibility rules

- Preserve global search on every viewport.
- Preserve every route and role-gated action in the mobile menu.
- Support narrow screens from 320px without horizontal page overflow.
- Wrap long multilingual strings safely.
- Keep technical IDs selectable and visually distinguishable.
- Preserve keyboard flows, focus visibility, semantic labels, and existing shortcuts.
