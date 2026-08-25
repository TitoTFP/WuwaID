# WuwaID production-readiness runbook

This runbook covers release readiness for the WebUI/SQLite service on Linux and the
Windows x64 DLL/exporter toolchain. It does not perform a deployment.

## Support matrix and release gates

| Surface | Supported gate | Evidence |
| --- | --- | --- |
| WebUI and Express server | Node.js 22 on Ubuntu | `.github/workflows/test-webui.yml` |
| Python exporters | Python 3.x | `npm run test:python` |
| Native tooling | Windows Server 2025, MSVC v143, x64 | `.github/workflows/build-windows-dlls.yml` |
| Structured text ZIP export | Host with the `zip` executable | Integration export test |

Run these checks from the repository root before release:

```bash
npm run check
npm --prefix webui run test:qa
npm run test:integration
npm run test:python
npm run build
git diff --check
```

The QA suite and all deterministic integration tests must report zero failed and
zero skipped tests. The committed fixture under
`webui/server/test-fixtures/export-data/` keeps exporter, authorization, job, and
version coverage available in a clean checkout. Reader pagination/search checks
that require the full game corpus are conditional when that corpus is not present;
they must run and pass whenever the release data bundle is available.

## Environment and secrets

Production must set all of the following before starting the server:

- `NODE_ENV=production`
- `PORT` (or the platform-provided port)
- `WUWAID_EDITOR_PASSWORD` — a dedicated strong editor credential
- `WUWAID_ADMIN_PASSWORD` — a different strong admin credential
- `WUWAID_TELEMETRY_TOKEN` — credential for remote log ingestion

The server fails closed when production credentials are missing. Never put these
values in the repository, client bundle, workflow YAML, or logs. Rotate them through
the deployment secret manager and restart the service after rotation.

The service account also needs controlled read/write access to the canonical data
and state paths: `data/quests/`, `data/version_history.db`,
`data/translation_qa.db`, and `webui/data/database_jobs/`.

## Authorization policy

- Anonymous and reader sessions may use read-only reader endpoints.
- Editors may create/review drafts, update QA review status, and inspect or create
  text versions and their exports.
- Only admins may apply drafts to canonical data, import/reset/rebuild databases,
  start or poll QA scans, and request operational dataset exports.
- Remote log ingestion requires `X-WuwaID-Telemetry-Token` matching
  `WUWAID_TELEMETRY_TOKEN` in production. Heartbeat acknowledgement is stateless.
- Missing or invalid bearer credentials return `401`; a valid session with an
  insufficient role returns `403`.

These checks are server-side; UI role state is only a convenience for disabling
controls.

## Backup/restore

1. Quiesce the service and confirm no database job is `running` or `queued`.
2. Capture an immutable, timestamped backup of `data/quests/`,
   `data/version_history.db*`, `data/translation_qa.db*`,
   `data/translation_qa_reviews.json`, and `webui/data/database_jobs/`.
3. Record the release commit and Windows artifact checksums beside the backup.
4. To restore, stop the service, restore canonical JSON and SQLite state together,
   remove stale temporary job artifacts, and run:

   ```bash
   npm --prefix webui run build:reader-index
   npm --prefix webui run qa
   ```

5. Start the service and verify `/api/health`, `/api/reader/metrics`, an authenticated
   job query, and one read-only export before reopening traffic.

The database job processor keeps transaction/backups inside each job directory and
rolls back source JSON and the previous index on a failed rebuild. Do not manually
delete a non-terminal job until its backup has been preserved.

## Rollback and operations

- Keep the previous application build and data backup available for every release.
- If a migration or import fails, stop new writes, inspect the job record and error,
  restore the last known-good backup, rebuild the reader index, and rerun the gates.
- Database mutation jobs are serialized by a filesystem writer lock per job root;
  run one backend writer per canonical data directory. Do not horizontally scale
  writers without replacing this lock with a shared lease.
- Monitor health, metrics, job status/progress, failed-job count, QA scan failures,
  disk space, and backup age. Alert on repeated job failures, stale transaction
  directories, or missing telemetry.
- Retain job records and release evidence according to the operator's retention
  policy; redact credentials and user-provided log content from incident reports.

## Compatibility and limitations

Existing `/api/<area>` and short `/api` aliases, response shapes, and data formats
remain available. Changes in this hardening pass are additive and do not introduce
breaking API or data migrations.

Known limitations that must remain visible during release review:

- Sessions are process-local and are invalidated by a server restart; persistent
  identity/session storage is a separate security project.
- The filesystem lock protects one canonical writer directory, not a distributed
  multi-replica deployment.
- Structured ZIP export requires `zip` on the host.
- Reader integration checks requiring the full game corpus are not a substitute
  for validating the release data bundle; they are skipped only when that bundle
  is absent from a clean checkout.
- Windows CI validates x64 PE build outputs; game-runtime behavior, code signing,
  and live deployment are outside this gate.

## Release checklist

- [ ] Required production secrets are present in the secret manager.
- [ ] Backup and restore evidence is timestamped and readable.
- [ ] Linux WebUI workflow is green; QA and deterministic integration tests have
  zero skipped tests, and corpus-dependent reader checks ran when data was present.
- [ ] Windows x64 DLL workflow is green and both PE artifacts are present.
- [ ] `npm run check`, QA, integration, Python, build, and diff hygiene gates pass.
- [ ] Health, metrics, job recovery, telemetry, and rollback owner are verified.
- [ ] Compatibility and known limitations were reviewed and accepted.
