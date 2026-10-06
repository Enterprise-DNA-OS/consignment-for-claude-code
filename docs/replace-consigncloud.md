# Bring ConsignCloud records across

Source checked 2026-10-06: [ConsignCloud export help](https://help.consigncloud.com/en/articles/1769152-search-and-table-views-classic). Classic exports selected account and inventory views to Excel. The owner chooses columns, so there is no single universal CSV layout. Export all required columns with filters cleared. Save the relevant sheets as UTF-8 CSV with identifiers kept as text. For a different edition, confirm its export options with the vendor.

## Prepare a cutover snapshot

Reconcile consignor balances in ConsignCloud and the external bank before cutover. Export accounts and inventory at the same cutoff. The account balance becomes opening credit, not sales revenue. Historical sales, refunds, payouts, photos, signed agreements, item status changes, discounts, fee schedules and live integrations do not migrate through this base importer. Preserve their original exports separately. Importing historical sales on top of opening balances would double count credit.

The synthetic fixtures in examples/consigncloud demonstrate the accepted mapping. They are not vendor-certified exports. Use --map=your-map.json to map local expected column names to the names in your export. No data is inferred for missing required columns.

Accounts: Account ID, Name, Split (consignor percentage), Balance (signed decimal). Optional Email, Phone, Address, Terms Reference and Identity Reference.

Items: SKU, Account ID, Description (or Title), Received Date, Expiration Date, Price (or Tag Price), Split, Status. Optional Category, Regulated, Dealer Record Reference, Donation Allowed. Dates use YYYY-MM-DD, splits use bare numeric percentages, and money uses decimal amounts without symbols or thousands separators. Status is available, sold, returned, donated or archived. Map vendor status labels explicitly before import. One record per individually tracked consigned item. Store-owned stock, quantities, buyer fees and automatic markdown schedules need separate mapping and rules.

```bash
node scripts/consignment.mjs add location --name="My store" --currency=NZD --jurisdiction=NZ
node scripts/consignment.mjs import consigncloud --accounts=accounts.csv --items=items.csv --location="My store" --map=mapping.json --dry-run
node scripts/consignment.mjs import consigncloud --accounts=accounts.csv --items=items.csv --location="My store" --map=mapping.json
```

The two exports enter with one import command. Dry run parses every row, validates references and checks conflicts. A bad row rolls the whole import back. Repeating identical files is a no-op. Changed files that overlap existing accounts or SKUs stop for reviewed reconciliation rather than changing a live balance. Opening dates record the import day. Imported sold items carry stock status but do not fabricate historical sale entries. Historical refunds require review against the original ledger.

## Reconcile before switching

Compare account counts, item counts by status, inventory ticket values by currency and the sum of opening credit with your exports. Run statement, payout-run, inventory and compliance. Verify several individual consignor balances and split overrides. Keep the till, card processor and required dealer system in place. Test a new sale, a full refund and a recorded payout on a copy before switching the consignor desk.

Use export for a portable JSON snapshot of all seven domain record types. Keep backups encrypted and access restricted. A database-native backup and restore drill is also required before production. This importer is for opening records, not full historical restoration.
