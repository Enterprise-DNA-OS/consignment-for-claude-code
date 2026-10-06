# Validation

Local Linux Node 22 checks are recorded after the final test run. The GitHub Actions matrix also runs Windows and Linux with Node 20 and 22. The remote workflow passed all four operating-system and Node combinations and the PostgreSQL 17 job at code commit 6943df7.

Initial validation, 2026-10-06: npm install (zero dependency audit findings), npm test (81 assertions), npm run demo, npm run view (four reports), and npm run docs (14 documents) passed on Linux Node 22. Chromium screenshots of the week report and consignor statement were inspected. The page gate passed with four sourced price figures and zero brand errors. The three page examples were captured from real demo command output. Import fixtures are synthetic; no live vendor account or customer export was used.

The inherited workflow includes PostgreSQL 17. TEST_DATABASE_URL now selects a temporary schema and passes that schema to child-process CLI and renderer checks. The default local run remains isolated embedded mode. The duplicate workflow added during authoring was removed in favour of the template workflow.

Remote proof: https://github.com/Enterprise-DNA-OS/consignment-for-claude-code/actions/runs/37542222727. All five jobs passed, including 81 assertions against PostgreSQL 17. Later documentation-only commits do not change the tested code.
