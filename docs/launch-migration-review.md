# Launch migration review — September 10, 2026

The production and staging migration ledgers were inspected read-only. The snapshot is in `migration-history-snapshot.json`; it contains names, versions, and recorded SQL checksums, with no user records or credentials.

There are 42 local migrations whose names exist in production under different timestamps. Three production names occur twice: `multi_source_preview`, `website_google_drive_sources`, and `community_deck_ratings`. Recorded SQL checksums differ for many historical entries, so matching names alone is not proof of equivalent SQL. Do not repair the ledger by marking all local migrations applied, replay the historical migrations, or merge the staging branch wholesale.

Two older local filenames have no corresponding production name:

- `20260622180000_topic_source_type.sql` is superseded. The actual production `sources_type_check` already allows `topic`, alongside newer `xlsx`, `notion`, and `website` values. Replaying the older migration would narrow that constraint.
- `20260816220000_remove_standalone_notes.sql` deletes every source without a project. A read-only production count found **one such source**. Preserve it. This deletion is excluded from the launch rollout.

The approved implementation scope can be deployed additively using only these four migrations, in order:

1. `20260910153404_launch_account_deletion_and_limits.sql`
2. `20260910153622_launch_review_reconciliation.sql`
3. `20260910163605_launch_active_review_metrics.sql`
4. `20260910172301_launch_trigger_permissions.sql`

Each local SQL file exactly matches its recorded staging SQL checksum. All four names were absent from the production ledger at review time. `pnpm launch:prepare-migrations` verifies these comparisons against the saved snapshot and copies only those files, with SHA-256 checksums, to `test-results/release/`. It does not apply SQL or certify a future production state.

Immediately before production application, refresh the remote ledger and verify these migrations remain unapplied. Apply them individually through the migration tool, then run the SQL acceptance test with isolated accounts and security advisors. Deploy the compatible API and worker together; keep reconciliation and media flags disabled until their respective release gates pass. Preserve all existing source documents, review history, and local queues.

The standalone extraction worker's continuous polling has now completed a real staging deletion and graceful shutdown locally. Deployment configuration and monitoring on its eventual host still require validation.
