# Record a full external refund

Read CLAUDE.md, then run:

```bash
node scripts/consignment.mjs refund <sale-reference> --reference="<external refund reference>" --actor="<operator>"
```

Replace angle-bracket placeholders with the operator's actual values. Use --json for further analysis. Read the full item or statement before changing it. List ambiguous matches and stop until the operator identifies the record. State currency beside money. Never invent records or send anything.

This records an action already completed in an external till or bank. It never moves money. Confirm the external reference and amount. A full refund reverses the consignor share. Partial refunds and surcharges need reviewed custom rules.
