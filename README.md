# Consignment for Claude Code

The open-source consignor desk for resale stores: intake, splits, stock ageing, expiry decisions and payout reconciliation in a database you own. Built by Enterprise DNA.

| Do it yourself | We customise it | We run it for you |
|---|---|---|
| Free, MIT. Install and change it yourself. | Your fields, agreement rules and ConsignCloud export mapping. Store screens and connections scoped around your operation. | Installed and operated through Omni by Enterprise DNA. One setup fee, then a retainer. |
| [Quick start](#quick-start) | [Get your version built](https://enterprisedna.co/omni/book?offer=replace-software&utm_medium=github&utm_campaign=consigncloud) | [Book a call](https://enterprisedna.co/omni/book?offer=replace-software&utm_medium=github&utm_campaign=consigncloud) |

Runs with Claude Code, Codex, OpenCode or Cursor. Every agent follows AGENTS.md and the same command recipes.

## What the store owns

An item belongs to a consignor, carries an agreed share and has an expiry date. A recorded till sale credits the consignor. A recorded external payment reduces the balance. A full refund reverses the original credit, even after a payout. Currency stays attached to the store. Nothing here moves money or sends messages.

Keep the existing till, payment processor and any legally required dealer record system. This base handles individually tracked consigned items. Store-owned inventory, partial refunds, fees, tax calculation, live commerce sync and public consignor portals require separate work. Read [the scope](docs/why-no-front-end.md).

## Quick start

Requires Node 20 or newer. These commands work in Windows PowerShell and Linux shells.

```bash
git clone https://github.com/Enterprise-DNA-OS/consignment-for-claude-code.git
cd consignment-for-claude-code
npm install
npm test
npm run demo
npm run view
npm run docs
```

The fictional demo has two stores with separate NZD and AUD amounts, three consignors, eight items, two recorded sales and one recorded payout. Stock dates are relative to the seed day. Repeating seed does not overwrite changes.

Read-only reports appear in views/ for the week, expiry pull, payout review and compliance evidence. Printable documents appear in docs-out/: consignor statements, intake records, expiry letters and return or donation records. Disposal records render once an item has been returned or donated. Change the business name, logo and colours in brand.json. Logo paths should be absolute or hosted URLs. Nothing is sent.

## Commands for the weekly work

/README, /add, /attention, /compliance, /consignors, /customise, /dispose, /documents, /draft-expiry, /expiry-pull, /export, /import, /intake, /inventory, /item, /locations, /log, /metrics, /new-view, /payout, /payout-run, /questions, /refund, /sale, /sales, /split-check, /statement, /stock-age, /weekly-review.

The five store rituals are /intake, /expiry-pull, /payout-run, /stock-age and /split-check. /weekly-review combines expiry decisions, balances and missing evidence. Recipes live in .claude/commands. Other agents read those same files.

```bash
node scripts/consignment.mjs help
node scripts/consignment.mjs statement "Mara Bell" --json
node scripts/consignment.mjs sale HR-106 --net=60.00 --reference=POS-NEW --actor=Jo
node scripts/consignment.mjs payout "Mara Bell" --amount=10.00 --reference=BANK-NEW --actor=Jo
node scripts/consignment.mjs log HR-101 --actor=Jo --note="Owner approved collection Friday"
```

Only record a sale or payment already completed outside this system. Net is the tax-exclusive amount on which the agreed consignor share is calculated, after applicable discounts. Calculate and reconcile that basis in your till. Splits round once to the nearest cent for each item. Amounts are stored as integer cents. Fees and special rounding policies need explicit custom rules.

Names match case-insensitively, ids accept unique prefixes, and item lookups accept SKUs. Ambiguous matches list candidates and exit 1. All commands accept --json. Mutations use parameterised queries and transactions. Payouts lock the consignor before checking available credit. No delete command is supplied. A database administrator can still change records directly, so production needs restricted roles and audit controls.

## Ten questions from your records

Run questions <number> for each answer. These are implemented analyses, not a claim that ConsignCloud cannot produce similar reports. Its own help describes configurable reports and a Data Explorer.

1. Which expired items lack permission to donate?
2. Which consignors have old stock and money waiting?
3. Which sold pieces earned less than their ticket price?
4. What consignor credit is waiting at each store?
5. Which regulated items lack a linked dealer record?
6. Which consignors have no signed terms reference?
7. Which categories have the oldest available stock?
8. Which refunds left a consignor owing the store?
9. Which items expire within the next fortnight?
10. What retained share came from each consignor?

## Your first hour: ten things to ask for

1. List the expired stock by store.
2. Show consignors with money waiting.
3. Find pieces with a different split from their consignor default.
4. Show missing agreement references.
5. Draft a collection letter for Mara Bell.
6. Prepare a printable consignor statement.
7. Compare old stock by category and currency.
8. Find refunds that left negative balances.
9. Add a rack-location field with /customise.
10. Add a read-only report of expiring coats with /new-view.

## Bring ConsignCloud opening records across

ConsignCloud Classic exports Excel sheets with selectable columns. Save the accounts and inventory sheets as CSV, confirm their columns, then import with one command:

```bash
node scripts/consignment.mjs import consigncloud --accounts=accounts.csv --items=items.csv --location="Harbour Resale" --dry-run
```

Read [the switching guide](docs/replace-consigncloud.md) before removing --dry-run. Column mapping is supported. Opening credit is imported separately from post-cutover sales. The importer does not fabricate historical sales or statutory records. Identical imports are safe to repeat. Changed overlapping snapshots stop for reconciliation.

## Storage, access and backup

Without DATABASE_URL, embedded PGlite stores data in .data/db. Set DATA_DIR to use another directory. Only one embedded process should use it at a time. Set DATABASE_URL to use PostgreSQL and run npm run migrate. Both adapters run the same schema and parameterised queries. This build was exercised locally in embedded mode and against PostgreSQL 17 in the remote workflow.

Create a fresh database for your store and never seed live business data. Use add location, then add consignor or import. Shared use requires the owner to configure restricted database roles, TLS, network access, backups and restoration. This base has no web login, staff permission manager or tenant isolation.

export writes all seven domain record types to portable JSON in exports/. That is a record snapshot, not an automatic restore command. Also maintain database-native backups and test recovery. Drafts, exports, .env files and local data are gitignored.

## Dealer and agreement checks

/compliance flags missing agreement references, missing supplier identity references and missing links to dealer records. Regulated NSW items always carry an external-system reminder. [Compliance sources and boundaries](docs/compliance.md) identify which checks reflect official guidance and which are store policies. This system does not establish legal compliance, licence eligibility or approval as dealer software.

## Validation

npm test uses a temporary database, ignores live DATABASE_URL and exercises every CLI workflow, all ten analyses, failed and repeated imports, exact split rounding, sale/refund/payout controls, four report types and four document types. The same suite is configured for Windows and Linux on Node 20 and 22 in GitHub Actions. An explicit TEST_DATABASE_URL runs it in a disposable schema on PostgreSQL; the inherited workflow supplies PostgreSQL 17. See [validation evidence](docs/validation.md) for actual runs.

Seven domain tables, five views, UUID ids and update triggers. No frontend framework or server. MIT licence.
