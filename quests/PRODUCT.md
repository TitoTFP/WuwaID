# Product — WuwaID Quests

## Summary

WuwaID Quests is a web-based multilingual dialogue archive and localization workbench for Wuthering Waves. It combines a public reading and search experience with authenticated translation, editing, draft review, import/export, and version-history workflows.

## Platform

- Web application, responsive from mobile to desktop
- React 18, TypeScript, Vite, Tailwind CSS
- FastAPI and SQLite/FTS5 backend
- Keyboard-friendly, information-dense workflows are important

## Users

### Readers

Browse chapters, side quests, categories, speakers, and multilingual quest dialogue. Search dialogue and move quickly between records and choice points.

### Translators

Translate individual quests or content categories, compare source and target text, preserve local work, submit drafts, and use keyboard-driven navigation.

### Editors

Review submitted drafts and diffs, edit dialogue structures and metadata, import or export translations, inspect version history, and manage publication-quality localization data.

A single person may move among all three modes, so the visual system must make mode and permissions legible without splitting the product into unrelated identities.

## Core Jobs

1. Find a quest, category, speaker, or exact dialogue line quickly.
2. Read Chinese, English, Japanese, and Indonesian dialogue with clear language identity and long-form readability.
3. Translate large sets of lines without losing position, context, or unsaved work.
4. Review changes confidently through explicit status, diff, history, and confirmation states.
5. Move between reading, translating, and editing while retaining context.
6. Operate effectively on both narrow screens and dense desktop workstations.

## Routes and Capabilities

- Home chapter and speaker index
- Chapter and side-quest indexes
- Category browsing and category translation
- Quest dialogue viewer
- Full-text search with language selection
- Quest translator
- Structural quest editor
- Draft queue and review
- Version history
- Authentication
- Shared global language switching, search, import, navigation, and account/session controls

## Product Truth to Preserve

- Existing routes, feature behavior, API contracts, permissions, data flows, draft persistence, keyboard behavior, and safeguards must remain intact during visual redesign.
- The product name is `wuwaid-quests` / WuwaID Quests.
- The interface handles real localization data and must prioritize trust, orientation, and legibility over decorative spectacle.
- Multilingual text can be long and must wrap safely. Technical IDs and source references must remain copyable and distinguishable from prose.
- Empty, loading, error, pending, approved, rejected, unsaved, and permission states are operationally meaningful.

## Experience Goals

- Feel purpose-built for a living game-localization archive rather than a generic admin dashboard.
- Make reading feel immersive while keeping translation and editorial work precise.
- Establish a distinctive visual identity shared across reader, translator, and editor surfaces.
- Increase hierarchy, wayfinding, and confidence without reducing information density or removing functionality.
- Meet WCAG AA expectations, preserve visible focus, respect reduced motion, and keep touch targets usable.

## Constraints

- No dependency on unavailable proprietary game artwork.
- Avoid fabricated statistics, promotional claims, or content.
- Prefer resilient CSS and existing React structure over introducing a heavy component framework.
- Visual replacement may change tokens, layout styling, typography, component presentation, and responsive composition, but not product semantics or workflows.
