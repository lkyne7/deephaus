// Historical local migrations are not a deployable production ledger yet.
console.error('Database push is blocked: local and hosted migration histories differ.');
console.error('Run pnpm launch:prepare-migrations for the reviewed four-file release bundle.');
console.error('Refresh the live ledger and apply reviewed migrations individually; see docs/launch-migration-review.md.');
process.exitCode = 1;
