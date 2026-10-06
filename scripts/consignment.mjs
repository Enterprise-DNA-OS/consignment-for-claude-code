#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { getDb, REPO_ROOT } from "./lib/db.mjs";
import { parseCsv, pick } from "./lib/csv.mjs";
import { table } from "./lib/format.mjs";

export const questions = [
  [
    "Which expired items lack permission to donate?",
    "select sku,title,consignor,expires_on from stock where status='available' and expires_on<current_date and not donation_allowed",
  ],
  [
    "Which consignors have old stock and money waiting?",
    "select distinct b.name,b.currency,b.due_cents from balances b join stock s on s.consignor_id=b.id where b.due_cents>0 and s.status='available' and s.age_days>60",
  ],
  [
    "Which sold pieces earned less than their ticket price?",
    "select i.sku,i.title,l.currency,i.price_cents,s.net_cents,i.price_cents-s.net_cents discount_cents from sales s join items i on i.id=s.item_id join consignors c on c.id=i.consignor_id join locations l on l.id=c.location_id where s.refunded_on is null and s.net_cents<i.price_cents",
  ],
  [
    "What consignor credit is waiting at each store?",
    "select location,currency,sum(due_cents)::bigint due_cents from balances group by location,currency order by location",
  ],
  [
    "Which regulated items lack a linked dealer record?",
    "select sku,title,consignor,jurisdiction from stock where regulated and dealer_record_ref=''",
  ],
  [
    "Which consignors have no signed terms reference?",
    "select name,email from consignors where terms_ref=''",
  ],
  [
    "Which categories have the oldest available stock?",
    "select category,currency,count(*) items,round(avg(age_days)) average_age_days,sum(price_cents)::bigint ticket_cents from stock where status='available' group by category,currency order by average_age_days desc",
  ],
  [
    "Which refunds left a consignor owing the store?",
    "select name,location,currency,due_cents from balances where due_cents<0",
  ],
  [
    "Which items expire within the next fortnight?",
    "select sku,title,consignor,expires_on,days_to_expiry from stock where status='available' and days_to_expiry between 0 and 14 order by expires_on",
  ],
  [
    "What retained share came from each consignor?",
    "select c.name,l.currency,sum(s.net_cents-s.consignor_cents)::bigint store_share_cents from sales s join items i on i.id=s.item_id join consignors c on c.id=i.consignor_id join locations l on l.id=c.location_id where s.refunded_on is null group by c.name,l.currency order by c.name",
  ],
];
const reads = {
  locations: "select name,currency,jurisdiction from locations order by name",
  consignors:
    "select name,location,currency,opening_cents,earned_cents,paid_cents,due_cents from balances order by name",
  inventory:
    "select sku,title,consignor,location,currency,status,price_cents,split_percent,age_days from stock order by sku",
  "expiry-pull": "select * from expiry_queue order by expires_on,sku",
  "payout-run":
    "select name,location,currency,opening_cents,earned_cents,paid_cents,due_cents from balances where due_cents<>0 order by location,name",
  "stock-age":
    "select sku,title,consignor,currency,age_days,price_cents from stock where status='available' order by age_days desc,sku",
  "split-check":
    "select i.sku,c.name consignor,i.split_percent item_split,c.split_percent account_default from items i join consignors c on c.id=i.consignor_id where i.split_percent<>c.split_percent order by sku",
  sales:
    "select s.reference,i.sku,s.sold_on,l.currency,s.net_cents,s.consignor_cents,s.refunded_on from sales s join items i on i.id=s.item_id join consignors c on c.id=i.consignor_id join locations l on l.id=c.location_id order by s.sold_on,s.reference",
  attention: "select * from attention_queue order by location,sku,reason",
  compliance:
    "select sku,rule,basis,issue from compliance_issues order by sku,rule",
  metrics:
    "select l.name location,l.currency,count(s.id) recorded_sales,coalesce(sum(s.net_cents),0)::bigint net_cents,coalesce(sum(s.consignor_cents),0)::bigint consignor_cents,coalesce(sum(s.net_cents-s.consignor_cents),0)::bigint store_share_cents from locations l left join consignors c on c.location_id=l.id left join items i on i.consignor_id=c.id left join sales s on s.item_id=i.id and s.refunded_on is null group by l.name,l.currency order by l.name",
};
export function args(argv) {
  const opts = {},
    pos = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, ...v] = a.slice(2).split("=");
      opts[k] = v.length ? v.join("=") : true;
    } else pos.push(a);
  }
  return { opts, pos };
}
const required = (o, k) => {
  if (typeof o[k] !== "string" || !o[k].trim())
    throw Error(`Required --${k}=value`);
  return o[k].trim();
};
export function cents(s) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(s)))
    throw Error(`Invalid amount: ${s}`);
  const neg = String(s).startsWith("-");
  const [a, b = ""] = String(s).replace("-", "").split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 2147483647)
    throw Error("Amount out of range");
  return neg ? -n : n;
}
function percent(s) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(s)) || Number(s) > 100)
    throw Error("Split must be 0 to 100 with at most two decimals");
  return Number(s);
}
function date(s) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw Error(`Invalid ISO date: ${s}`);
  return s;
}
function bool(s) {
  if (
    !["true", "false", "yes", "no", "1", "0"].includes(String(s).toLowerCase())
  )
    throw Error(`Invalid boolean: ${s}`);
  return ["true", "yes", "1"].includes(String(s).toLowerCase());
}
async function resolve(db, t, term, key = "name") {
  if (!term) throw Error(`Specify a ${t} name or id`);
  const rows = await db.query(`select * from ${t} order by ${key}`);
  let found = rows.filter(
    (x) =>
      String(x.id) === term ||
      String(x[key]).toLowerCase() === term.toLowerCase(),
  );
  if (!found.length)
    found = rows.filter(
      (x) =>
        x.id.startsWith(term) ||
        String(x[key]).toLowerCase().includes(term.toLowerCase()),
    );
  if (found.length !== 1)
    throw Error(
      `${found.length ? "Ambiguous" : "No match"} ${t}: ${term}\n${(found.length ? found : rows).map((x) => `${x.id} ${x[key]}`).join("\n")}`,
    );
  return found[0];
}
async function tx(db, fn) {
  await db.exec("BEGIN");
  try {
    const out = await fn();
    await db.exec("COMMIT");
    return out;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
async function lockAccount(db, id) {
  await db.query("select id from consignors where id=$1 for update", [id]);
}
async function item(db, term) {
  return resolve(db, "items", term, "sku");
}
const today = () => new Date().toISOString().slice(0, 10);
async function event(db, id, o, note) {
  await db.query("insert into events(item_id,actor,note) values($1,$2,$3)", [
    id,
    required(o, "actor"),
    note,
  ]);
}

async function importRecords(db, o) {
  const loc = await resolve(db, "locations", required(o, "location"));
  const accountText = fs.readFileSync(required(o, "accounts"), "utf8"),
    itemText = fs.readFileSync(required(o, "items"), "utf8");
  const map = o.map ? JSON.parse(fs.readFileSync(o.map, "utf8")) : {};
  const read = (row, type, key, ...aliases) =>
    pick(row, map[type]?.[key] || key, ...aliases);
  const a = parseCsv(accountText).map((row) => ({
    external_id: read(row, "accounts", "Account ID", "ID"),
    name: read(row, "accounts", "Name"),
    email: read(row, "accounts", "Email"),
    phone: read(row, "accounts", "Phone"),
    address: read(row, "accounts", "Address"),
    split: percent(read(row, "accounts", "Split", "Consignor Split")),
    opening: cents(read(row, "accounts", "Balance")),
    terms: read(row, "accounts", "Terms Reference"),
    identity: read(row, "accounts", "Identity Reference"),
  }));
  const it = parseCsv(itemText).map((row) => ({
    sku: read(row, "items", "SKU"),
    account: read(row, "items", "Account ID"),
    title: read(row, "items", "Description", "Title"),
    category: read(row, "items", "Category"),
    received: date(read(row, "items", "Received Date")),
    expires: date(read(row, "items", "Expiration Date")),
    price: cents(read(row, "items", "Price", "Tag Price")),
    split: percent(read(row, "items", "Split", "Consignor Split")),
    status: read(row, "items", "Status").toLowerCase(),
    regulated: bool(read(row, "items", "Regulated") || "false"),
    record: read(row, "items", "Dealer Record Reference"),
    donate: bool(read(row, "items", "Donation Allowed") || "false"),
  }));
  if (!a.length) throw Error("Accounts file is empty");
  if (
    a.some((x) => !x.external_id || !x.name) ||
    new Set(a.map((x) => x.external_id)).size !== a.length
  )
    throw Error("Accounts require unique Account ID and Name");
  if (
    it.some(
      (x) =>
        !x.sku ||
        !x.title ||
        !a.some((y) => y.external_id === x.account) ||
        x.price < 0 ||
        x.expires < x.received ||
        !["available", "sold", "returned", "donated", "archived"].includes(
          x.status,
        ),
    )
  )
    throw Error("Invalid item, dates, status or account reference");
  if (new Set(it.map((x) => x.sku)).size !== it.length)
    throw Error("Duplicate SKU in import");
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ location: loc.id, accountText, itemText, map }))
    .digest("hex");
  return tx(db, async () => {
    // Serialise imports and compare before applying. Imports never overwrite a live ledger.
    await db.exec("lock table import_batches in exclusive mode");
    if (
      (
        await db.query("select id from import_batches where source_hash=$1", [
          hash,
        ])
      ).length
    )
      return [{ result: "Already imported", accounts: 0, items: 0 }];
    const existing = await db.query(
      "select external_id from consignors where location_id=$1",
      [loc.id],
    );
    if (a.some((x) => existing.some((y) => x.external_id === y.external_id)))
      throw Error(
        "Account already exists: changed reimports require reviewed reconciliation",
      );
    const skus = await db.query("select sku from items");
    if (it.some((x) => skus.some((y) => x.sku === y.sku)))
      throw Error("SKU already exists");
    if (o["dry-run"])
      return [
        {
          result: "Validated; no writes",
          accounts: a.length,
          items: it.length,
        },
      ];
    const ids = new Map();
    for (const x of a) {
      const [r] = await db.query(
        "insert into consignors(external_id,location_id,name,email,phone,address,split_percent,opening_cents,terms_ref,identity_evidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
        [
          x.external_id,
          loc.id,
          x.name,
          x.email,
          x.phone,
          x.address,
          x.split,
          x.opening,
          x.terms,
          x.identity,
        ],
      );
      ids.set(x.external_id, r.id);
    }
    for (const x of it)
      await db.query(
        "insert into items(sku,consignor_id,title,category,received_on,expires_on,price_cents,split_percent,status,regulated,dealer_record_ref,donation_allowed) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          x.sku,
          ids.get(x.account),
          x.title,
          x.category,
          x.received,
          x.expires,
          x.price,
          x.split,
          x.status,
          x.regulated,
          x.record,
          x.donate,
        ],
      );
    await db.query(
      "insert into import_batches(source_hash,account_count,item_count) values($1,$2,$3)",
      [hash, a.length, it.length],
    );
    return [
      {
        result:
          "Imported opening balances and inventory; no historical sales created",
        accounts: a.length,
        items: it.length,
      },
    ];
  });
}

export async function run(db, argv) {
  const {
    opts: o,
    pos: [cmd = "help", arg, ...rest],
  } = args(argv);
  if (reads[cmd]) return db.query(reads[cmd]);
  if (cmd === "help")
    return [
      {
        commands: [
          ...Object.keys(reads),
          "item <sku>",
          "statement <consignor>",
          "intake",
          "add location|consignor",
          "sale <sku>",
          "refund <sale reference>",
          "payout <consignor>",
          "dispose <sku>",
          "log <sku>",
          "weekly-review",
          "draft-expiry <consignor>",
          "questions [1..10]",
          "import consigncloud",
          "export",
        ].join("\n"),
      },
    ];
  if (cmd === "questions") {
    if (!arg)
      return questions.map(([question], i) => ({ number: i + 1, question }));
    const q = questions[Number(arg) - 1];
    if (!q) throw Error("Choose question 1 to 10");
    return db.query(q[1]);
  }
  if (cmd === "weekly-review")
    return {
      expiry: await db.query(reads["expiry-pull"]),
      payouts: await db.query(reads["payout-run"]),
      attention: await db.query(reads.attention),
    };
  if (cmd === "item") {
    const i = await item(db, arg);
    return {
      item: await db.query("select * from stock where id=$1", [i.id]),
      sales: await db.query("select * from sales where item_id=$1", [i.id]),
      events: await db.query(
        "select actor,note,created_at from events where item_id=$1 order by created_at",
        [i.id],
      ),
    };
  }
  if (cmd === "statement") {
    const c = await resolve(db, "consignors", arg);
    return {
      balance: await db.query("select * from balances where id=$1", [c.id]),
      sales: await db.query(
        "select s.reference,i.sku,s.sold_on,s.net_cents,s.consignor_cents,s.refunded_on from sales s join items i on i.id=s.item_id where i.consignor_id=$1 order by sold_on",
        [c.id],
      ),
      settlements: await db.query(
        "select reference,paid_on,amount_cents,actor from settlements where consignor_id=$1 order by paid_on",
        [c.id],
      ),
    };
  }
  if (cmd === "add" && arg === "location")
    return db.query(
      "insert into locations(name,currency,jurisdiction) values($1,$2,$3) returning name,currency,jurisdiction",
      [
        required(o, "name"),
        required(o, "currency"),
        required(o, "jurisdiction"),
      ],
    );
  if (cmd === "add" && arg === "consignor") {
    const l = await resolve(db, "locations", required(o, "location"));
    return db.query(
      "insert into consignors(location_id,name,email,phone,address,split_percent,terms_ref,identity_evidence) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,name",
      [
        l.id,
        required(o, "name"),
        o.email || "",
        o.phone || "",
        o.address || "",
        percent(required(o, "split")),
        o.terms || "",
        o.identity || "",
      ],
    );
  }
  if (cmd === "intake") {
    const c = await resolve(db, "consignors", required(o, "consignor"));
    return tx(db, async () => {
      const [i] = await db.query(
        "insert into items(sku,consignor_id,title,category,received_on,expires_on,price_cents,split_percent,regulated,dealer_record_ref,donation_allowed) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,sku,title",
        [
          required(o, "sku"),
          c.id,
          required(o, "title"),
          o.category || "",
          date(o.received || today()),
          date(required(o, "expires")),
          cents(required(o, "price")),
          o.split === undefined ? c.split_percent : percent(o.split),
          bool(o.regulated || "false"),
          o["dealer-record"] || "",
          bool(o["donation-allowed"] || "false"),
        ],
      );
      await event(db, i.id, o, "Intake recorded");
      return [i];
    });
  }
  if (cmd === "sale") {
    const i = await item(db, arg);
    return tx(db, async () => {
      await lockAccount(db, i.consignor_id);
      const [fresh] = await db.query(
        "select * from items where id=$1 for update",
        [i.id],
      );
      if (fresh.status !== "available")
        throw Error("Only available stock can be sold");
      const d = date(o.date || today());
      if (d < fresh.received_on) throw Error("Sale predates intake");
      if (fresh.regulated && !fresh.dealer_record_ref)
        throw Error(
          "Link the external dealer record before recording this regulated sale",
        );
      const amount = cents(required(o, "net"));
      if (amount <= 0) throw Error("Sale must be positive");
      const result = await db.query(
        "insert into sales(reference,item_id,sold_on,net_cents,consignor_cents) values($1,$2,$3,$4::integer,round($4::integer::numeric*$5::numeric/100)) returning reference,net_cents,consignor_cents",
        [required(o, "reference"), i.id, d, amount, fresh.split_percent],
      );
      await db.query(
        "update items set status='sold',disposed_on=$2 where id=$1",
        [i.id, d],
      );
      await event(db, i.id, o, "Recorded external sale " + o.reference);
      return result;
    });
  }
  if (cmd === "refund") {
    const s = await resolve(db, "sales", arg, "reference");
    const [i] = await db.query("select * from items where id=$1", [s.item_id]);
    return tx(db, async () => {
      await lockAccount(db, i.consignor_id);
      const [fresh] = await db.query(
        "select * from sales where id=$1 for update",
        [s.id],
      );
      if (fresh.refunded_on) throw Error("Sale already refunded");
      const d = date(o.date || today());
      if (d < String(fresh.sold_on).slice(0, 10))
        throw Error("Refund predates sale");
      await db.query(
        "update sales set refunded_on=$2,refund_reference=$3 where id=$1",
        [s.id, d, required(o, "reference")],
      );
      await db.query(
        "update items set status='available',disposed_on=null where id=$1",
        [i.id],
      );
      await event(db, i.id, o, "Recorded full external refund " + o.reference);
      return [
        {
          reference: s.reference,
          result: "Full refund recorded; consignor credit reversed",
        },
      ];
    });
  }
  if (cmd === "payout") {
    const c = await resolve(db, "consignors", arg);
    return tx(db, async () => {
      await lockAccount(db, c.id);
      const [b] = await db.query("select * from balances where id=$1", [c.id]);
      const n = cents(required(o, "amount"));
      if (n <= 0 || n > Number(b.due_cents))
        throw Error(
          `Payout exceeds available credit ${b.due_cents} cents, or is not positive`,
        );
      return db.query(
        "insert into settlements(consignor_id,reference,paid_on,amount_cents,actor) values($1,$2,$3,$4,$5) returning reference,paid_on,amount_cents",
        [
          c.id,
          required(o, "reference"),
          date(o.date || today()),
          n,
          required(o, "actor"),
        ],
      );
    });
  }
  if (cmd === "dispose") {
    const i = await item(db, arg);
    return tx(db, async () => {
      await lockAccount(db, i.consignor_id);
      const [f] = await db.query("select * from items where id=$1 for update", [
        i.id,
      ]);
      const action = required(o, "action");
      if (!["returned", "donated"].includes(action))
        throw Error("Action must be returned or donated");
      if (f.status !== "available")
        throw Error("Only available stock can be disposed");
      if (action === "donated" && !f.donation_allowed)
        throw Error("No donation permission recorded");
      await db.query(
        "update items set status=$2,disposed_on=current_date where id=$1",
        [i.id, action],
      );
      await event(db, i.id, o, action + ": " + required(o, "note"));
      return [{ sku: i.sku, status: action }];
    });
  }
  if (cmd === "log") {
    const i = await item(db, arg);
    await event(db, i.id, o, required(o, "note"));
    return [{ sku: i.sku, result: "Note recorded" }];
  }
  if (cmd === "draft-expiry") {
    const c = await resolve(db, "consignors", arg);
    const rows = await db.query(
      "select sku,title,expires_on from items where consignor_id=$1 and status='available' and expires_on<=current_date+14 order by expires_on",
      [c.id],
    );
    const dir = path.join(process.env.OUTPUT_DIR || REPO_ROOT, "drafts");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `expiry-${c.id}.md`);
    fs.writeFileSync(
      file,
      `# Draft only: consignment expiry\n\nTo: ${c.name} <${c.email}>\n\nThese items need an expiry decision:\n\n${rows.map((x) => `- ${x.sku}: ${x.title}, expires ${x.expires_on}`).join("\n") || "No items due."}\n\nPlease confirm collection or the next step allowed by your agreement.\n`,
    );
    return [{ file, items: rows.length, sent: false }];
  }
  if (cmd === "import") {
    if (arg !== "consigncloud") throw Error("Supported source: consigncloud");
    return importRecords(db, o);
  }
  if (cmd === "export") {
    const out = {
      format: "consignment-backup-v1",
      exported_at: new Date().toISOString(),
    };
    await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      for (const t of [
        "locations",
        "consignors",
        "items",
        "sales",
        "settlements",
        "events",
        "import_batches",
      ])
        out[t] = await db.query(`select * from ${t} order by id`);
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
    const file = path.resolve(
      o.file ||
        path.join(
          process.env.OUTPUT_DIR || REPO_ROOT,
          "exports",
          `consignment-${today()}.json`,
        ),
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    return [
      {
        file,
        records: Object.values(out)
          .filter(Array.isArray)
          .reduce((n, a) => n + a.length, 0),
      },
    ];
  }
  throw Error(`Unknown command: ${cmd} ${arg || ""}. Run help.`);
}
export function human(out) {
  if (!Array.isArray(out))
    return Object.entries(out)
      .map(([k, v]) => k + "\n" + human(v))
      .join("\n\n");
  if (!out.length) return "(none)";
  const rows = out.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        k.endsWith("_cents")
          ? (Number(v) / 100).toFixed(2)
          : v instanceof Date
            ? v.toISOString()
            : typeof v === "object" && v !== null
              ? JSON.stringify(v)
              : v,
      ]),
    ),
  );
  return table(
    rows,
    Object.keys(rows[0]).map((key) => ({
      key,
      label: key.replace(/_cents$/, "").replace(/_/g, " "),
    })),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let db;
  try {
    db = await getDb();
    const out = await run(db, process.argv.slice(2));
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(out, null, 2)
        : human(out),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
