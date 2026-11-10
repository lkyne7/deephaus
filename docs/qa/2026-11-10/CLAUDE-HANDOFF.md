# Claude bug-fix handoff

Read [QA-REPORT.md](QA-REPORT.md) first. It reviews commit `09b584ea56fb6a2eb1cbe05637874bc2c3f918ea` and includes evidence, reproduction steps, root-cause locations and acceptance checks.

Please fix the eight confirmed product findings F01–F08, then update the official regression tests described in T01. Prioritize Quizlet data integrity. Preserve valid quoted CSV/multiline imports while fixing raw TSV quotes, and explicitly account for skipped rows. Validate deck creation and rename consistently; return safe errors for invalid bodies and unexpected server failures. Treat the three narrow-layout defects as independent checks. Preserve the interrupted current path in desktop Retry.

The sources under `regression/` are temporary QA adaptations, not product fixes. The four network-only recovery/account tests and the two production media/offline journeys passed with current UI selectors. Use them to update the official tests; avoid reducing their assertions. Original failing tests were blocked by obsolete selectors and cleanup errors, not demonstrated review/draft loss.

For each fix, add focused regression coverage, run the appropriate existing checks, and state remaining coverage limits. Do not present the follow-up observations as confirmed bugs without verification. iOS and Android native UI testing remains blocked by the device-tool failures documented in the report; repair those prerequisites and finish native journeys before claiming full release readiness.

No application fixes have been applied in this QA deliverable.
