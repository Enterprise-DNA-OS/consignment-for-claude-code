# Bring ConsignCloud opening records across

Read CLAUDE.md, then run:

```bash
node scripts/consignment.mjs import consigncloud --accounts=accounts.csv --items=items.csv --location="<store>" --dry-run
```

Replace angle-bracket placeholders with the operator's actual values. Use --json for further analysis. Read the full item or statement before changing it. List ambiguous matches and stop until the operator identifies the record. State currency beside money. Never invent records or send anything.

Read docs/replace-consigncloud.md first. Check the export columns and map them. Review the dry run and opening balances before removing --dry-run. Never import historical sales over an opening balance.
