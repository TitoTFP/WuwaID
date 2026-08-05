# Dumper-7 (vendored)

This directory is a **frozen vendored copy** of the upstream
`CallMeDangDev/WuwaVH` Dumper-7 tooling, imported into the WuwaID monorepo
during the `dac0626b` restructure (2026-07).

## Provenance

- **Upstream repo:** `https://github.com/CallMeDangDev/WuwaVH` (Dumper-7
  subproject) — **since deleted; no longer fetchable.**
- **Relation:** WuwaID's `src/` (export_localization_db, pakbypass) is derived
  from the same upstream WuwaVH codebase; `sdk/` is generated output of
  Dumper-7 against the game.
- **Import date:** 2026-07 (commit `dac0626b`), before the upstream removal.

## Policy

- Because upstream is gone, this copy cannot be a git submodule and cannot be
  re-synced. Treat it as **vendored, frozen, best-effort**.
- **Do not delete or rename** unless the SDK pipeline is rebuilt from scratch.
- Prefer keeping local patches here; note them in this file.
- The `tools/Dumper-7/.github/` workflow files are upstream's own CI and are
  inert in this monorepo (root workflows under `.github/workflows/` are
  canonical).

## Current upstream state (as of 2026-08)

- `https://github.com/CallMeDangDev/WuwaVH` → **404 / deleted**.
- No archived fork is known; the vendored tree here is the surviving copy.
