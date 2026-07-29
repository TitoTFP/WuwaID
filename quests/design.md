# Design — WuwaID Quests

Impeccable-owned visual system. Product truth lives in `PRODUCT.md`. This file replaces the previous Archivist Workbench identity.

## Concept: Resonance Atlas

The interface is a navigable signal map: quest records form a dark spatial field; acid-chartreuse carries the active route; cyan identifies links and language movement; violet marks editorial intervention. The world feels native to resonance, waveforms, coordinates, and localization without copying game artwork or becoming a decorative sci-fi HUD.

The design serves readers, translators, and editors equally. Reading surfaces open up. Work surfaces tighten into precise instruments. Both remain one product.

## Visual Grammar

- **Ground:** ultraviolet-black, with sparse coordinate-grid and radial signal light. Never flat gray.
- **Primary signal:** electric chartreuse. Reserved for focus, active navigation, selected records, and primary action.
- **Secondary signal:** cyan. Links, language transitions, and informational state.
- **Editorial signal:** violet. Diffs, editor state, and structural intervention.
- **Type:** Syne for identity and headings; Manrope for interface and reading; IBM Plex Mono for IDs, counts, source references, and status.
- **Shape:** clipped/angled brand mark, compact rounded controls, larger irregular-feeling compositions formed through borders and placement. Avoid pill overuse.
- **Lines:** fine violet rules become map tracks. Stronger lines indicate active routes or selected records.

## Composition

### Global shell

A translucent command deck floats over the signal field. Brand left, browse routes next, global search dominant, work controls right. Mobile collapses browse/work links into the native details menu while search remains first-class.

### Index routes

Use an editorial atlas: a large orientation header followed by ledger rows. Rows behave like coordinates, not floating card grids. Active or hovered rows gain a chartreuse route edge and slight horizontal movement.

### Quest viewer

Long-form dialogue is the quietest surface. Preserve readable measure, explicit speakers, language distinction, choice structure, and scene separators. Signal color annotates content; it does not compete with it.

### Translator and editor

Workbench surfaces use compact controls, clear sticky tool regions, strong selected-row state, and explicit status colors. Dense panes retain breathing room through section boundaries rather than excessive cards.

## Components

- `.btn`: dark glass control with map-line border. Hover lifts border and text; `.btn-active` uses chartreuse signal fill.
- `.input` / `.select` / `.textarea`: inset dark fields with visible chartreuse focus ring. Inputs remain at least 44px high.
- `.card`: deep translucent panel, violet rule, subtle directional highlight. Use only for grouped content.
- `.badge`: compact mono state label. Status must never rely on color alone.
- `.archive-brand__mark`: angular coordinate beacon, not a generic rounded app icon.
- Dialogue and diff colors preserve semantic roles and AA contrast.

## Motion

Motion explains route and state:

- hover route shift: 120–190ms;
- page/content reveal: opacity plus small vertical movement, one pass;
- loading shimmer: slow horizontal scan;
- no looping decoration, parallax, or blur-heavy animation;
- `prefers-reduced-motion` removes translation and shimmer while retaining state changes.

## Responsive Contract

- No horizontal page overflow at 320px.
- Global search stays available on every viewport.
- Desktop command deck exposes browse and work controls.
- Mobile menu preserves every route and role-gated action.
- Multi-pane workbenches may scroll internally or collapse according to existing behavior; actions cannot disappear.
- Long multilingual strings use safe wrapping; technical IDs remain selectable.
- Touch targets are at least 44px where controls are primary.

## Accessibility

- WCAG AA contrast minimum.
- Chartreuse focus outline visible against every surface.
- Semantic landmarks and existing labels remain intact.
- Selected, loading, error, success, pending, approved, rejected, and disabled states use text/shape in addition to color.
- Keyboard flows and existing shortcuts remain unchanged.

## Canonical Sources

- `PRODUCT.md`: product and behavior truth
- `design.md`: visual and interaction system
- `tokens.css`: implementation tokens
- `web/src/index.css`: shared implementation

Route-local styling must use this grammar. Do not reintroduce the former navy/brass editorial archive, generic dashboard card grids, glassmorphism blur stacks, or ornamental game artwork.
