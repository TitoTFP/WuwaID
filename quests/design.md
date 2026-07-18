# Design — WuwaID Quests

Locked Hallmark design system for the WebUI. Future page work reads this file
first and defers to it; amend the system here instead of adding route-local themes.

## System

- Genre · editorial with a technical workbench register
- Mood · Archivist Workbench
- Theme · custom dark
- Axes · dark paper / roman serif display / brass and signal-teal anchors
- Enrichment · none; the archive content and tools carry the interface

## Macrostructure families

- Index routes · Index-First ledgers with hairline rows and compact metadata
- Quest viewer · Long Document transcript rhythm with scene dividers
- Editing routes · Workbench toolbar, navigation pane, and focused detail pane

Pages share the theme, type, shell, component voice, and motion stance. Structure
may vary only within the three families above.

## Canonical tokens

`tokens.css` is the source of truth.

```css
:root {
  --color-ink-navy: oklch(15% 0.012 250);
  --color-brass: oklch(78% 0.12 78);
  --color-signal-teal: oklch(74% 0.1 185);
  --color-paper: var(--color-ink-navy);
  --color-accent: var(--color-brass);
  --color-link: var(--color-signal-teal);
  --color-focus: var(--color-signal-teal);

  --font-display: "Newsreader", serif;
  --font-body: "Inter Tight", sans-serif;
  --font-mono: "IBM Plex Mono", monospace;

  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 240ms;
  --radius-sm: 2px;
  --radius-md: 6px;
  --radius-lg: 10px;
}
```

## Typography

- Display · Newsreader 600, roman; headings and the archive wordmark
- UI and prose · Inter Tight 400–600; running body copy stays at 16 px or larger, while dense transcript previews, source references, diffs, and metadata may use 12–14 px
- Metadata · IBM Plex Mono 400–600; IDs, timestamps, counts, and technical labels
- Headings use tight leading and never italic; running prose stays within 45–75 ch

## Space, shape, and hierarchy

- Spacing uses the named 4 px scale in `tokens.css`; no route-local spacing scale
- Radius is limited to 2 px, 6 px, and 10 px
- Panels use surface lightness plus one hairline; no glass, glow, or card-in-card
- Accent colour marks active state and focus, never broad decorative surfaces

## Component voice

- Masthead · compact archive register with browse, global search, role tools, language
- Buttons · 44 px minimum target, 6 px radius, hairline boundary, single-line labels
- Inputs · 44 px height, stable border width, instant signal-teal focus outline
- Rows and tables · ledger rules, tabular figures, restrained hover surface
- Dialogs · opaque raised paper and a single boundary; backdrop only communicates depth
- Feedback · silent success; warning and error always include text or icon, not colour alone

## Motion stance

- State changes use 120 ms, 180 ms, or 240 ms and the named easing tokens
- Animate only opacity and transform; no hover scale or ornamental page reveals
- Focus rings are instant
- Reduced motion collapses animation to an opacity change of at most 120 ms

## Responsive contract

- Root uses `overflow-x: clip` and viewport layouts use `100dvh`
- The archive masthead becomes a complete native disclosure below 64 rem
- Workbenches show one pane below 64 rem; list/detail switching preserves selection
- Interactive labels never wrap and touch targets remain at least 44 px

## Behaviour guardrails

Routes, API payloads, React Query keys, auth and role gates, query parameters, hash
navigation, storage keys, virtualization, drag/drop, and import/export formats are not
part of the visual system and must remain unchanged.

## Exports

`tokens.css` is canonical. The current Tailwind v3 app consumes it through
`web/tailwind.config.js`; the portable mappings below are copies, not new sources.

### `tokens.css`

```css
/* Hallmark · genre: editorial · tone: technical-austere · macrostructure: Index-First / Long Document / Workbench · theme: custom · anchor hue: ink-navy 250 · design-system: design.md · designed-as-app */
/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 · contrast: pass (40–41) · nav: N6 · footer: Ft2 · slop: 58/58 pass · mobile: pass (34, 49, 50–57) */
:root {
  color-scheme: dark;

  /* Core palette */
  --color-ink-navy-channels: 15% 0.012 250;
  --color-brass-channels: 78% 0.12 78;
  --color-signal-teal-channels: 74% 0.1 185;
  --color-ink-navy: oklch(var(--color-ink-navy-channels));
  --color-brass: oklch(var(--color-brass-channels));
  --color-signal-teal: oklch(var(--color-signal-teal-channels));

  /* Surfaces, ink, and rules */
  --color-paper-2-channels: 18% 0.014 250;
  --color-paper-3-channels: 22% 0.016 250;
  --color-paper-4-channels: 27% 0.018 250;
  --color-rule-channels: 34% 0.018 250;
  --color-rule-strong-channels: 45% 0.022 250;
  --color-ink-channels: 94% 0.012 250;
  --color-ink-2-channels: 80% 0.014 250;
  --color-ink-3-channels: 64% 0.014 250;
  --color-ink-4-channels: 50% 0.012 250;
  --color-paper: var(--color-ink-navy);
  --color-paper-2: oklch(var(--color-paper-2-channels));
  --color-paper-3: oklch(var(--color-paper-3-channels));
  --color-paper-4: oklch(var(--color-paper-4-channels));
  --color-rule: oklch(var(--color-rule-channels));
  --color-rule-strong: oklch(var(--color-rule-strong-channels));
  --color-ink: oklch(var(--color-ink-channels));
  --color-ink-2: oklch(var(--color-ink-2-channels));
  --color-ink-3: oklch(var(--color-ink-3-channels));
  --color-muted: var(--color-ink-3);

  /* Semantic colour */
  --color-success-channels: 72% 0.13 150;
  --color-warning-channels: 80% 0.13 82;
  --color-error-channels: 70% 0.16 25;
  --color-info-channels: 72% 0.11 245;
  --color-violet-channels: 72% 0.1 305;
  --color-success: oklch(var(--color-success-channels));
  --color-warning: oklch(var(--color-warning-channels));
  --color-error: oklch(var(--color-error-channels));
  --color-info: oklch(var(--color-info-channels));
  --color-violet: oklch(var(--color-violet-channels));
  --color-accent: var(--color-brass);
  --color-accent-ink: var(--color-paper);
  --color-link: var(--color-signal-teal);
  --color-focus: var(--color-signal-teal);
  --color-accent-selection: oklch(var(--color-brass-channels) / 0.25);
  --color-accent-surface: oklch(var(--color-brass-channels) / 0.1);
  --color-accent-surface-subtle: oklch(var(--color-brass-channels) / 0.06);
  --color-accent-surface-faint: oklch(var(--color-brass-channels) / 0.08);
  --color-accent-rule: oklch(var(--color-brass-channels) / 0.45);
  --color-accent-rule-strong: oklch(var(--color-brass-channels) / 0.55);
  --color-link-decoration: oklch(var(--color-signal-teal-channels) / 0.45);
  --color-error-surface: oklch(var(--color-error-channels) / 0.16);
  --color-error-decoration: oklch(var(--color-error-channels) / 0.5);
  --color-success-surface: oklch(var(--color-signal-teal-channels) / 0.14);

  /* Legacy Tailwind neutral aliases */
  --color-neutral-50-channels: 97% 0.01 250;
  --color-neutral-100-channels: 94% 0.012 250;
  --color-neutral-200-channels: 87% 0.014 250;
  --color-neutral-300-channels: 79% 0.014 250;
  --color-neutral-400-channels: 68% 0.014 250;
  --color-neutral-500-channels: 64% 0.014 250;
  --color-neutral-600-channels: 64% 0.014 250;
  --color-neutral-700-channels: 64% 0.014 250;
  --color-neutral-800-channels: 27% 0.018 250;
  --color-neutral-900-channels: 20% 0.016 250;
  --color-neutral-950-channels: 15% 0.012 250;
  --color-error-100-channels: 90% 0.05 25;
  --color-error-200-channels: 82% 0.09 25;
  --color-error-300-channels: 75% 0.13 25;
  --color-error-400-channels: 70% 0.16 25;
  --color-error-500-channels: 62% 0.18 25;

  /* Type */
  --font-display: "Newsreader", "Iowan Old Style", "Palatino Linotype", serif;
  --font-body: "Inter Tight", "Arial Narrow", ui-sans-serif, sans-serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", ui-monospace, monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.25rem;
  --text-lg: 1.5625rem;
  --text-xl: 1.953rem;
  --text-2xl: 2.441rem;
  --text-display: clamp(2.75rem, 5vw + 1rem, 5.25rem);
  --leading-tight: 1.15;
  --leading-body: 1.6;

  /* 4 px spacing scale */
  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs: 0.75rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-2xl: 4rem;
  --space-3xl: 6rem;
  --space-4xl: 8rem;

  /* Shape and rules */
  --radius-sm: 2px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-card: var(--radius-lg);
  --radius-input: var(--radius-md);
  --radius-chip: var(--radius-sm);
  --rule-hairline: 1px;
  --rule-double: 3px;
  --control-height: 2.75rem;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 240ms;

  /* Stacking */
  --z-base: 1;
  --z-raised: 10;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
}
```

### Tailwind v4 `@theme`

```css
@theme {
  /* Core palette */
  --color-ink-navy-channels: 15% 0.012 250;
  --color-brass-channels: 78% 0.12 78;
  --color-signal-teal-channels: 74% 0.1 185;
  --color-ink-navy: oklch(var(--color-ink-navy-channels));
  --color-brass: oklch(var(--color-brass-channels));
  --color-signal-teal: oklch(var(--color-signal-teal-channels));

  /* Surfaces, ink, and rules */
  --color-paper-2-channels: 18% 0.014 250;
  --color-paper-3-channels: 22% 0.016 250;
  --color-paper-4-channels: 27% 0.018 250;
  --color-rule-channels: 34% 0.018 250;
  --color-rule-strong-channels: 45% 0.022 250;
  --color-ink-channels: 94% 0.012 250;
  --color-ink-2-channels: 80% 0.014 250;
  --color-ink-3-channels: 64% 0.014 250;
  --color-ink-4-channels: 50% 0.012 250;
  --color-paper: var(--color-ink-navy);
  --color-paper-2: oklch(var(--color-paper-2-channels));
  --color-paper-3: oklch(var(--color-paper-3-channels));
  --color-paper-4: oklch(var(--color-paper-4-channels));
  --color-rule: oklch(var(--color-rule-channels));
  --color-rule-strong: oklch(var(--color-rule-strong-channels));
  --color-ink: oklch(var(--color-ink-channels));
  --color-ink-2: oklch(var(--color-ink-2-channels));
  --color-ink-3: oklch(var(--color-ink-3-channels));
  --color-muted: var(--color-ink-3);

  /* Semantic colour */
  --color-success-channels: 72% 0.13 150;
  --color-warning-channels: 80% 0.13 82;
  --color-error-channels: 70% 0.16 25;
  --color-info-channels: 72% 0.11 245;
  --color-violet-channels: 72% 0.1 305;
  --color-success: oklch(var(--color-success-channels));
  --color-warning: oklch(var(--color-warning-channels));
  --color-error: oklch(var(--color-error-channels));
  --color-info: oklch(var(--color-info-channels));
  --color-violet: oklch(var(--color-violet-channels));
  --color-accent: var(--color-brass);
  --color-accent-ink: var(--color-paper);
  --color-link: var(--color-signal-teal);
  --color-focus: var(--color-signal-teal);
  --color-accent-selection: oklch(var(--color-brass-channels) / 0.25);
  --color-accent-surface: oklch(var(--color-brass-channels) / 0.1);
  --color-accent-surface-subtle: oklch(var(--color-brass-channels) / 0.06);
  --color-accent-surface-faint: oklch(var(--color-brass-channels) / 0.08);
  --color-accent-rule: oklch(var(--color-brass-channels) / 0.45);
  --color-accent-rule-strong: oklch(var(--color-brass-channels) / 0.55);
  --color-link-decoration: oklch(var(--color-signal-teal-channels) / 0.45);
  --color-error-surface: oklch(var(--color-error-channels) / 0.16);
  --color-error-decoration: oklch(var(--color-error-channels) / 0.5);
  --color-success-surface: oklch(var(--color-signal-teal-channels) / 0.14);

  /* Legacy Tailwind neutral aliases */
  --color-neutral-50-channels: 97% 0.01 250;
  --color-neutral-100-channels: 94% 0.012 250;
  --color-neutral-200-channels: 87% 0.014 250;
  --color-neutral-300-channels: 79% 0.014 250;
  --color-neutral-400-channels: 68% 0.014 250;
  --color-neutral-500-channels: 64% 0.014 250;
  --color-neutral-600-channels: 64% 0.014 250;
  --color-neutral-700-channels: 64% 0.014 250;
  --color-neutral-800-channels: 27% 0.018 250;
  --color-neutral-900-channels: 20% 0.016 250;
  --color-neutral-950-channels: 15% 0.012 250;
  --color-error-100-channels: 90% 0.05 25;
  --color-error-200-channels: 82% 0.09 25;
  --color-error-300-channels: 75% 0.13 25;
  --color-error-400-channels: 70% 0.16 25;
  --color-error-500-channels: 62% 0.18 25;

  /* Type */
  --font-display: "Newsreader", "Iowan Old Style", "Palatino Linotype", serif;
  --font-body: "Inter Tight", "Arial Narrow", ui-sans-serif, sans-serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", ui-monospace, monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.25rem;
  --text-lg: 1.5625rem;
  --text-xl: 1.953rem;
  --text-2xl: 2.441rem;
  --text-display: clamp(2.75rem, 5vw + 1rem, 5.25rem);
  --leading-tight: 1.15;
  --leading-body: 1.6;

  /* Source spacing tokens */
  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs: 0.75rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-2xl: 4rem;
  --space-3xl: 6rem;
  --space-4xl: 8rem;

  /* Tailwind spacing namespace mirrors */
  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4rem;
  --spacing-3xl: 6rem;
  --spacing-4xl: 8rem;

  /* Shape and rules */
  --radius-sm: 2px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-card: var(--radius-lg);
  --radius-input: var(--radius-md);
  --radius-chip: var(--radius-sm);
  --rule-hairline: 1px;
  --rule-double: 3px;
  --control-height: 2.75rem;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 240ms;

  /* Stacking */
  --z-base: 1;
  --z-raised: 10;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color-channel": {
    "ink-navy-channels": { "$value": "15% 0.012 250", "$type": "string" },
    "brass-channels": { "$value": "78% 0.12 78", "$type": "string" },
    "signal-teal-channels": { "$value": "74% 0.1 185", "$type": "string" },
    "paper-2-channels": { "$value": "18% 0.014 250", "$type": "string" },
    "paper-3-channels": { "$value": "22% 0.016 250", "$type": "string" },
    "paper-4-channels": { "$value": "27% 0.018 250", "$type": "string" },
    "rule-channels": { "$value": "34% 0.018 250", "$type": "string" },
    "rule-strong-channels": { "$value": "45% 0.022 250", "$type": "string" },
    "ink-channels": { "$value": "94% 0.012 250", "$type": "string" },
    "ink-2-channels": { "$value": "80% 0.014 250", "$type": "string" },
    "ink-3-channels": { "$value": "64% 0.014 250", "$type": "string" },
    "ink-4-channels": { "$value": "50% 0.012 250", "$type": "string" },
    "success-channels": { "$value": "72% 0.13 150", "$type": "string" },
    "warning-channels": { "$value": "80% 0.13 82", "$type": "string" },
    "error-channels": { "$value": "70% 0.16 25", "$type": "string" },
    "info-channels": { "$value": "72% 0.11 245", "$type": "string" },
    "violet-channels": { "$value": "72% 0.1 305", "$type": "string" },
    "neutral-50-channels": { "$value": "97% 0.01 250", "$type": "string" },
    "neutral-100-channels": { "$value": "94% 0.012 250", "$type": "string" },
    "neutral-200-channels": { "$value": "87% 0.014 250", "$type": "string" },
    "neutral-300-channels": { "$value": "79% 0.014 250", "$type": "string" },
    "neutral-400-channels": { "$value": "68% 0.014 250", "$type": "string" },
    "neutral-500-channels": { "$value": "64% 0.014 250", "$type": "string" },
    "neutral-600-channels": { "$value": "64% 0.014 250", "$type": "string" },
    "neutral-700-channels": { "$value": "64% 0.014 250", "$type": "string" },
    "neutral-800-channels": { "$value": "27% 0.018 250", "$type": "string" },
    "neutral-900-channels": { "$value": "20% 0.016 250", "$type": "string" },
    "neutral-950-channels": { "$value": "15% 0.012 250", "$type": "string" },
    "error-100-channels": { "$value": "90% 0.05 25", "$type": "string" },
    "error-200-channels": { "$value": "82% 0.09 25", "$type": "string" },
    "error-300-channels": { "$value": "75% 0.13 25", "$type": "string" },
    "error-400-channels": { "$value": "70% 0.16 25", "$type": "string" },
    "error-500-channels": { "$value": "62% 0.18 25", "$type": "string" }
  },
  "color": {
    "ink-navy": { "$value": "oklch(15% 0.012 250)", "$type": "color" },
    "brass": { "$value": "oklch(78% 0.12 78)", "$type": "color" },
    "signal-teal": { "$value": "oklch(74% 0.1 185)", "$type": "color" },
    "paper": { "$value": "{color.ink-navy}", "$type": "color" },
    "paper-2": { "$value": "oklch(18% 0.014 250)", "$type": "color" },
    "paper-3": { "$value": "oklch(22% 0.016 250)", "$type": "color" },
    "paper-4": { "$value": "oklch(27% 0.018 250)", "$type": "color" },
    "rule": { "$value": "oklch(34% 0.018 250)", "$type": "color" },
    "rule-strong": { "$value": "oklch(45% 0.022 250)", "$type": "color" },
    "ink": { "$value": "oklch(94% 0.012 250)", "$type": "color" },
    "ink-2": { "$value": "oklch(80% 0.014 250)", "$type": "color" },
    "ink-3": { "$value": "oklch(64% 0.014 250)", "$type": "color" },
    "muted": { "$value": "{color.ink-3}", "$type": "color" },
    "success": { "$value": "oklch(72% 0.13 150)", "$type": "color" },
    "warning": { "$value": "oklch(80% 0.13 82)", "$type": "color" },
    "error": { "$value": "oklch(70% 0.16 25)", "$type": "color" },
    "info": { "$value": "oklch(72% 0.11 245)", "$type": "color" },
    "violet": { "$value": "oklch(72% 0.1 305)", "$type": "color" },
    "accent": { "$value": "{color.brass}", "$type": "color" },
    "accent-ink": { "$value": "{color.paper}", "$type": "color" },
    "link": { "$value": "{color.signal-teal}", "$type": "color" },
    "focus": { "$value": "{color.signal-teal}", "$type": "color" },
    "accent-selection": { "$value": "oklch(78% 0.12 78 / 0.25)", "$type": "color" },
    "accent-surface": { "$value": "oklch(78% 0.12 78 / 0.1)", "$type": "color" },
    "accent-surface-subtle": { "$value": "oklch(78% 0.12 78 / 0.06)", "$type": "color" },
    "accent-surface-faint": { "$value": "oklch(78% 0.12 78 / 0.08)", "$type": "color" },
    "accent-rule": { "$value": "oklch(78% 0.12 78 / 0.45)", "$type": "color" },
    "accent-rule-strong": { "$value": "oklch(78% 0.12 78 / 0.55)", "$type": "color" },
    "link-decoration": { "$value": "oklch(74% 0.1 185 / 0.45)", "$type": "color" },
    "error-surface": { "$value": "oklch(70% 0.16 25 / 0.16)", "$type": "color" },
    "error-decoration": { "$value": "oklch(70% 0.16 25 / 0.5)", "$type": "color" },
    "success-surface": { "$value": "oklch(74% 0.1 185 / 0.14)", "$type": "color" }
  },
  "font": {
    "display": {
      "$value": ["Newsreader", "Iowan Old Style", "Palatino Linotype", "serif"],
      "$type": "fontFamily"
    },
    "body": {
      "$value": ["Inter Tight", "Arial Narrow", "ui-sans-serif", "sans-serif"],
      "$type": "fontFamily"
    },
    "mono": {
      "$value": ["IBM Plex Mono", "Cascadia Mono", "ui-monospace", "monospace"],
      "$type": "fontFamily"
    }
  },
  "size": {
    "text-xs": { "$value": "0.75rem", "$type": "dimension" },
    "text-sm": { "$value": "0.875rem", "$type": "dimension" },
    "text-base": { "$value": "1rem", "$type": "dimension" },
    "text-md": { "$value": "1.25rem", "$type": "dimension" },
    "text-lg": { "$value": "1.5625rem", "$type": "dimension" },
    "text-xl": { "$value": "1.953rem", "$type": "dimension" },
    "text-2xl": { "$value": "2.441rem", "$type": "dimension" },
    "control-height": { "$value": "2.75rem", "$type": "dimension" }
  },
  "leading": {
    "tight": { "$value": 1.15, "$type": "number" },
    "body": { "$value": 1.6, "$type": "number" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4rem", "$type": "dimension" },
    "3xl": { "$value": "6rem", "$type": "dimension" },
    "4xl": { "$value": "8rem", "$type": "dimension" }
  },
  "radius": {
    "sm": { "$value": "2px", "$type": "dimension" },
    "md": { "$value": "6px", "$type": "dimension" },
    "lg": { "$value": "10px", "$type": "dimension" },
    "card": { "$value": "{radius.lg}", "$type": "dimension" },
    "input": { "$value": "{radius.md}", "$type": "dimension" },
    "chip": { "$value": "{radius.sm}", "$type": "dimension" }
  },
  "rule": {
    "hairline": { "$value": "1px", "$type": "dimension" },
    "double": { "$value": "3px", "$type": "dimension" }
  },
  "easing": {
    "out": { "$value": [0.16, 1, 0.3, 1], "$type": "cubicBezier" },
    "in": { "$value": [0.7, 0, 0.84, 0], "$type": "cubicBezier" },
    "in-out": { "$value": [0.65, 0, 0.35, 1], "$type": "cubicBezier" }
  },
  "duration": {
    "fast": { "$value": "120ms", "$type": "duration" },
    "base": { "$value": "180ms", "$type": "duration" },
    "slow": { "$value": "240ms", "$type": "duration" }
  },
  "z-index": {
    "base": { "$value": 1, "$type": "number" },
    "raised": { "$value": 10, "$type": "number" },
    "dropdown": { "$value": 100, "$type": "number" },
    "sticky": { "$value": 200, "$type": "number" },
    "modal": { "$value": 400, "$type": "number" },
    "toast": { "$value": 500, "$type": "number" },
    "tooltip": { "$value": 600, "$type": "number" }
  }
}
```

Channel helpers stay string-valued so their raw OKLCH triples remain exact. The
responsive `--text-display` clamp remains CSS-only because DTCG dimensions cannot
represent `clamp()` without changing its meaning.

### shadcn/ui CSS variables

```css
:root {
  --background: 15% 0.012 250;
  --foreground: 94% 0.012 250;

  --card: 18% 0.014 250;
  --card-foreground: 94% 0.012 250;

  --popover: 18% 0.014 250;
  --popover-foreground: 94% 0.012 250;

  --primary: 78% 0.12 78;
  --primary-foreground: 15% 0.012 250;

  --secondary: 22% 0.016 250;
  --secondary-foreground: 80% 0.014 250;

  --muted: 34% 0.018 250;
  --muted-foreground: 64% 0.014 250;

  --accent: 78% 0.12 78;
  --accent-foreground: 15% 0.012 250;

  --destructive: 70% 0.16 25;
  --destructive-foreground: 15% 0.012 250;

  --success: 72% 0.13 150;
  --success-foreground: 15% 0.012 250;
  --warning: 80% 0.13 82;
  --warning-foreground: 15% 0.012 250;
  --error: 70% 0.16 25;
  --error-foreground: 15% 0.012 250;
  --info: 72% 0.11 245;
  --info-foreground: 15% 0.012 250;
  --focus: 74% 0.1 185;
  --focus-foreground: 15% 0.012 250;

  --border: 34% 0.018 250;
  --input: 34% 0.018 250;
  --ring: 74% 0.1 185;
  --radius: 10px;
}
```
