# Consignment for Claude Code

Run the consignor desk for a resale store. The database holds intake, agreed splits, expiry decisions, external sale records and external payout records. Your operator supplies the store details in brand.json.

## Workflow

Read the matching recipe in .claude/commands. Every answer starts with data from scripts/consignment.mjs. Run help for syntax. The Monday review combines expiry-pull, payout-run and attention. Read item or statement before a mutation. All commands accept --json. Partial ids and case-insensitive names work; ambiguity lists candidates and exits 1.

## Boundaries

Never send, process a payment, delete a record or invent a transaction. Payout and sale record activity completed outside this system. Confirm external references. Never change historical shares to match new defaults. Keep currencies separate. Use a fresh migration for schema changes. Back up before importing or changing a live database. Never seed a live business database.

Regulated goods need separate dealer records, supplier identity evidence and local checks. Read docs/compliance.md. This is not approved NSW dealer software and does not transmit to Police. Keep signed terms and statutory records in the appropriate system. Missing evidence is a flag, not a legal verdict.

## Routes

- Review stores and currencies: /locations.
- Review consignor balances: /consignors.
- Review all consigned stock: /inventory.
- Read one item and its history: /item.
- Receive a consigned item: /intake.
- Pull expiring stock: /expiry-pull.
- Prepare the consignor payout review: /payout-run.
- Review stock that has sat too long: /stock-age.
- Review item split overrides: /split-check.
- Read recorded sales and refunds: /sales.
- Record an external till sale: /sale.
- Record a full external refund: /refund.
- Record a payment already made outside this system: /payout.
- Record a returned or donated item: /dispose.
- Read a consignor statement: /statement.
- Review missing dealer and agreement evidence: /compliance.
- Find overdue stock and missing records: /attention.
- Prepare the Monday consignment review: /weekly-review.
- Draft a stock collection letter: /draft-expiry.
- Add a consignor: /add.
- Record an item note: /log.
- Bring ConsignCloud opening records across: /import.
- Export a complete portable record snapshot: /export.
- Review recorded sales and retained shares: /metrics.
- Answer ten stock and consignor questions: /questions.
- Custom fields and rules: /customise.
- Read-only HTML report: /new-view.
- Draft paperwork: /documents.

## Files

scripts/consignment.mjs is the one CLI. supabase/migrations holds the schema. scripts/lib/db.mjs selects PostgreSQL via DATABASE_URL or local PGlite via DATA_DIR. documents.json and views.json feed the shared renderer. Drafts and exports are private and gitignored.

Built and supported through Omni by Enterprise DNA.
