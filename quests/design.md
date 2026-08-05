# Design — WuwaID Quests

Sentinel visual system (ADR-0002, ADR-0003). Product truth lives in `PRODUCT.md`. This file replaces the former Resonance Atlas identity and its "Impeccable" attribution.

## Concept: Sentinel

Dark, minimalist, rooted in Wuthering Waves' own visual language. A near-black blue ground carries a single cold-cyan signal; everything else is monochrome. The UI is an instrument, not a decoration: every element earns its place, and motion explains state rather than decorating it. This design rejects the "AI slop" pattern — no purple/indigo gradients, no glassmorphism, no emoji icons, no card grids everywhere, no looping animation. "Is this AI slop?" is the standing rejection test.

The design serves readers, translators, and editors equally. Reading surfaces are calm and spacious; work surfaces tighten into precise instruments; operations surfaces read like control panels. All three are one product, one identity, three moods.

## Visual Grammar

- **Ground:** near-black blue `#0A0E14`, with a sparse coordinate grid. Never gray, never purple.
- **Signal:** a single cold cyan `#22D3EE`. Reserved for focus, active navigation, selected records, links, and primary action. Everything else is monochrome.
- **Status:** `#34D399` success · `#F87171` error · `#FBBF24` warning — used sparingly, always with a text/shape label, never color alone.
- **Type:** Manrope for interface and reading; JetBrains Mono for IDs, counts, source references, and status. No separate display font — headings are Manrope bold with tight tracking.
- **Shape:** small radii (4px control, 6px card), angular clip-path corners on hero/brand/status, hairline 1px rules for structure. Avoid pill overuse.
- **Lines:** fine rules are structural. A cyan edge marks the active route or selected record.

## Composition

### Global shell

A flat masthead over the signal field: brand left, browse routes next, global search dominant, work controls right. Mobile collapses browse/work links into the native details menu while search remains first-class.

### Index routes

Editorial atlas: a large orientation header followed by ledger rows. Rows behave like coordinates — hairline-bounded, hover gains a cyan route edge and slight horizontal movement. No floating card grids.

### Quest viewer

Long-form dialogue is the quietest surface. Preserve readable measure, explicit speakers, language distinction, choice structure, and scene separators. Signal color annotates content; it does not compete with it.

### Translator and editor

Workbench surfaces use compact controls, clear sticky tool regions, strong selected-row state (cyan), and explicit status colors. Line types are distinguished by mono text tags and a monochrome rail — not by a rainbow of colors.

### Admin logs

Instrument-like: compact dense tables, mono data, tabular numbers, status as text+shape chips. Charts, when present, use the signal cyan on the monochrome ground.

## Components

- `.btn`: dark panel control with hairline border. Hover lifts border and text; `.btn-active` uses cyan signal fill.
- `.input` / `.select` / `.textarea`: inset dark fields with visible cyan focus ring. Inputs remain at least 44px high.
- `.card`: flat translucent panel, hairline rule. Use only for grouped content.
- `.chip`: compact mono state label. Status must never rely on color alone.
- `.sn-*`: the shell namespace (masthead, brand, browse, search, menu, footer).
- Dialogue and diff colors preserve semantic roles and AA contrast.

## Motion

Motion explains route and state, nothing else:

- hover route shift: 120–190ms;
- page/content reveal: opacity plus small vertical movement, one pass;
- loading shimmer: slow horizontal scan;
- no looping decoration, parallax, or blur-heavy animation;
- `prefers-reduced-motion` removes translation and shimmer while retaining state changes.

## Responsive Contract

- No horizontal page overflow at 320px.
- Global search stays available on every viewport.
- Desktop masthead exposes browse and work controls.
- Mobile menu preserves every route and role-gated action.
- Multi-pane workbenches may scroll internally or collapse according to existing behavior; actions cannot disappear.
- Long multilingual strings use safe wrapping; technical IDs remain selectable.
- Touch targets are at least 44px where controls are primary.

## Accessibility

- WCAG AA contrast minimum.
- Cyan focus outline visible against every surface.
- Semantic landmarks and existing labels remain intact.
- Selected, loading, error, success, pending, approved, rejected, and disabled states use text/shape in addition to color.
- Keyboard flows and existing shortcuts remain unchanged.

## Canonical Sources

- `PRODUCT.md`: product and behavior truth
- `design.md`: visual and interaction system
- `tokens.css`: implementation tokens (Sentinel oklch palette)
- `web/src/index.css`: shared implementation (Sentinel component classes)

Route-local styling must use this grammar. Do not reintroduce the former Resonance Atlas vocabulary (`archive-*`, `--color-brass`, `accent-gold`), the former navy/brass editorial archive, generic dashboard card grids, glassmorphism blur stacks, or ornamental game artwork.
