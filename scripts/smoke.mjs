import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getDb, REPO_ROOT } from "./lib/db.mjs";
import { migrate } from "./migrate.mjs";
import { run, cents, questions } from "./consignment.mjs";
import { parseCsv } from "./lib/csv.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "consignment-test-"));
// Only TEST_DATABASE_URL selects a server; ignore any live DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "";
process.env.DATA_DIR = path.join(tmp, "db");
process.env.OUTPUT_DIR = tmp;
let db, testSchema;
const mode = process.env.TEST_DATABASE_URL ? "postgres" : "pglite";
let count = 0;
const ok = (v, msg) => {
  assert.ok(v, msg);
  count++;
};
const equal = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  count++;
};
try {
  db = await getDb();
  equal(db.mode, mode);
  if (mode === "postgres") {
    testSchema = `consignment_test_${process.pid}_${Date.now()}`;
    await db.exec(`create schema ${testSchema}`);
    await db.exec(`set search_path to ${testSchema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `${url.searchParams.get("options") || ""} -c search_path=${testSchema}`.trim());
    process.env.DATABASE_URL = url.toString();
  }
  await migrate(db);
  equal((await migrate(db)).ran, [], "migration repeat");
  const seed = fs.readFileSync(
    path.join(REPO_ROOT, "supabase/seed.sql"),
    "utf8",
  );
  await db.exec(seed);
  await db.exec(seed);
  equal(
    (await db.query("select * from items")).length,
    8,
    "seed is idempotent",
  );
  equal(cents("10.01"), 1001);
  assert.throws(() => cents("NaN"));
  assert.throws(() => cents("1.001"));
  assert.throws(() => parseCsv("A,A\n1,2"));
  assert.throws(() => parseCsv("A,B\n1"));
  count += 4;
  equal(parseCsv('\uFEFFA,B\r\n"one, two","line\nnext"\r\n')[0], {
    A: "one, two",
    B: "line\nnext",
  });
  for (const cmd of [
    "help",
    "locations",
    "consignors",
    "inventory",
    "expiry-pull",
    "payout-run",
    "stock-age",
    "split-check",
    "sales",
    "attention",
    "compliance",
    "metrics",
    "questions",
  ])
    ok(Array.isArray(await run(db, [cmd])), cmd);
  for (let i = 1; i <= questions.length; i++)
    ok(Array.isArray(await run(db, ["questions", String(i)])), "analysis " + i);
  const b = (await run(db, ["statement", "mArA bElL"])).balance[0];
  equal(Number(b.due_cents), 4000, "opening + sales - settlements");
  await assert.rejects(
    run(db, ["statement", "Mara"]),
    /Ambiguous.*\n.*Mara Bell\n.*Mara Blake/s,
  );
  count++;
  equal(
    (await run(db, ["item", "30000000-0000-4000-8000-000000000001"])).item[0]
      .sku,
    "HR-101",
  );
  ok((await run(db, ["weekly-review"])).attention.length > 0);
  await assert.rejects(
    run(db, [
      "payout",
      "Mara Bell",
      "--amount=40.01",
      "--reference=BAD",
      "--actor=Sam",
    ]),
    /exceeds/,
  );
  count++;
  await assert.rejects(
    run(db, ["sale", "HR-103", "--net=100", "--reference=BAD", "--actor=Sam"]),
    /dealer record/,
  );
  count++;
  await assert.rejects(
    run(db, [
      "dispose",
      "HR-105",
      "--action=donated",
      "--note=no",
      "--actor=Sam",
    ]),
    /permission/,
  );
  count++;
  await run(db, [
    "add",
    "location",
    "--name=Test store",
    "--currency=NZD",
    "--jurisdiction=NZ",
  ]);
  const [c] = await run(db, [
    "add",
    "consignor",
    "--name=Test Person",
    "--location=Test store",
    "--split=50",
    "--terms=signed",
  ]);
  const expires = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  await run(db, [
    "intake",
    "--consignor=Test Person",
    "--sku=TEST-1",
    "--title=<script>escaped</script>",
    "--price=19.99",
    "--split=33.33",
    "--expires=" + expires,
    "--actor=Sam",
    "--donation-allowed=true",
  ]);
  ok((await run(db, ["split-check"])).some((x) => x.sku === "TEST-1"));
  await assert.rejects(
    run(db, ["sale", "TEST-1", "--net=19.99", "--reference=NO-ACTOR"]),
    /actor/,
  );
  count++;
  equal(
    (await run(db, ["item", "TEST-1"])).item[0].status,
    "available",
    "failed event rolls sale back",
  );
  const [s] = await run(db, [
    "sale",
    "TEST-1",
    "--net=19.99",
    "--reference=TEST-SALE",
    "--actor=Sam",
  ]);
  equal(s.consignor_cents, 666, "exact split rounded to cent");
  await assert.rejects(
    run(db, [
      "sale",
      "TEST-1",
      "--net=19.99",
      "--reference=DOUBLE",
      "--actor=Sam",
    ]),
    /available/,
  );
  count++;
  await run(db, [
    "payout",
    "Test Person",
    "--amount=6.66",
    "--reference=PAID-TEST",
    "--actor=Sam",
  ]);
  equal(
    Number((await run(db, ["statement", "Test Person"])).balance[0].due_cents),
    0,
  );
  await run(db, [
    "refund",
    "TEST-SALE",
    "--reference=REFUND-TEST",
    "--actor=Sam",
  ]);
  equal(
    Number((await run(db, ["statement", "Test Person"])).balance[0].due_cents),
    -666,
    "refund after payout creates recoverable balance",
  );
  ok((await run(db, ["questions", "8"])).some((x) => x.name === "Test Person"));
  await assert.rejects(
    run(db, ["refund", "TEST-SALE", "--reference=REFUND-TWICE", "--actor=Sam"]),
    /already/,
  );
  count++;
  await run(db, [
    "sale",
    "TEST-1",
    "--net=20",
    "--reference=RESOLD",
    "--actor=Sam",
  ]);
  equal(
    Number((await run(db, ["statement", "Test Person"])).balance[0].due_cents),
    1,
    "resale does not resurrect original share",
  );
  await run(db, [
    "dispose",
    "HR-101",
    "--action=donated",
    "--note=Signed authority checked",
    "--actor=Sam",
  ]);
  await run(db, [
    "dispose",
    "HR-105",
    "--action=returned",
    "--note=Collected by owner",
    "--actor=Sam",
  ]);
  await run(db, ["log", "HR-105", "--actor=Sam", "--note=Receipt filed"]);
  ok(
    (await run(db, ["item", "HR-105"])).events.some(
      (x) => x.note === "Receipt filed",
    ),
  );
  await assert.rejects(
    run(db, [
      "intake",
      "--consignor=Test Person",
      "--sku=BADDATE",
      "--title=Test",
      "--price=5",
      "--expires=2026-02-30",
      "--actor=Sam",
    ]),
    /Invalid ISO/,
  );
  count++;
  const draft = await run(db, ["draft-expiry", "Mara Bell"]);
  ok(fs.readFileSync(draft[0].file, "utf8").includes("Draft only"));
  const base = [
    "import",
    "consigncloud",
    "--accounts=" + path.join(REPO_ROOT, "examples/consigncloud/accounts.csv"),
    "--items=" + path.join(REPO_ROOT, "examples/consigncloud/items.csv"),
    "--location=Test store",
  ];
  equal((await run(db, [...base, "--dry-run"]))[0].accounts, 1);
  equal(
    (await db.query("select * from consignors where external_id='CC-900'"))
      .length,
    0,
    "dry run writes nothing",
  );
  await run(db, base);
  equal((await run(db, base))[0].result, "Already imported");
  equal(
    Number(
      (await run(db, ["statement", "Example Consignor"])).balance[0].due_cents,
    ),
    2550,
  );
  const changed = path.join(tmp, "changed.csv");
  fs.writeFileSync(
    changed,
    fs
      .readFileSync(
        path.join(REPO_ROOT, "examples/consigncloud/accounts.csv"),
        "utf8",
      )
      .replace("25.50", "999.99"),
  );
  await assert.rejects(
    run(db, [
      ...base.filter((x) => !x.startsWith("--accounts=")),
      "--accounts=" + changed,
    ]),
    /already exists/,
  );
  count++;
  equal(
    Number(
      (await run(db, ["statement", "Example Consignor"])).balance[0].due_cents,
    ),
    2550,
    "changed reimport does not overwrite money",
  );
  const bad = path.join(tmp, "bad.csv");
  fs.writeFileSync(
    bad,
    fs
      .readFileSync(
        path.join(REPO_ROOT, "examples/consigncloud/items.csv"),
        "utf8",
      )
      .replace("CC-900,", "MISSING,"),
  );
  await assert.rejects(
    run(db, [
      ...base.filter((x) => !x.startsWith("--items=")),
      "--items=" + bad,
    ]),
    /account reference/,
  );
  count++;
  // New account plus a colliding stock code must roll back all account writes.
  const fresh = path.join(tmp, "fresh.csv");
  fs.writeFileSync(
    fresh,
    fs
      .readFileSync(
        path.join(REPO_ROOT, "examples/consigncloud/accounts.csv"),
        "utf8",
      )
      .replaceAll("CC-900", "CC-901"),
  );
  const duplicate = path.join(tmp, "duplicate.csv");
  fs.writeFileSync(
    duplicate,
    fs
      .readFileSync(
        path.join(REPO_ROOT, "examples/consigncloud/items.csv"),
        "utf8",
      )
      .replace(",CC-900,", ",CC-901,"),
  );
  await assert.rejects(
    run(db, [
      "import",
      "consigncloud",
      "--accounts=" + fresh,
      "--items=" + duplicate,
      "--location=Test store",
    ]),
    /SKU already/,
  );
  count++;
  equal(
    (await db.query("select * from consignors where external_id='CC-901'"))
      .length,
    0,
  );
  const [snapshot] = await run(db, ["export"]);
  const saved = JSON.parse(fs.readFileSync(snapshot.file));
  equal(saved.format, "consignment-backup-v1");
  ok(saved.sales.length >= 4);
  ok(saved.events.length > 0);
  const old = (
    await db.query("select updated_at from consignors where id=$1", [c.id])
  )[0].updated_at;
  await db.query("update consignors set phone='changed' where id=$1", [c.id]);
  const updated = (
    await db.query("select updated_at from consignors where id=$1", [c.id])
  )[0].updated_at;
  ok(new Date(updated) >= new Date(old), "update trigger");
  await db.close();
  db = null;
  function child(file, args = [], expected = 0) {
    const p = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", file), ...args],
      { cwd: REPO_ROOT, env: process.env, encoding: "utf8" },
    );
    equal(p.status, expected, p.stdout + "\n" + p.stderr);
    return p;
  }
  child("consignment.mjs", ["statement", "Mara"], 1);
  const cli = child("consignment.mjs", ["inventory", "--json"]);
  ok(JSON.parse(cli.stdout).some((x) => x.sku === "TEST-1"));
  child("consignment.mjs", ["nonsense"], 1);
  child("view.mjs");
  child("docs.mjs");
  for (const name of ["week", "expiry", "payouts", "compliance"])
    ok(
      fs
        .readFileSync(path.join(tmp, "views", name + ".html"), "utf8")
        .includes("<!doctype html>"),
    );
  for (const name of [
    "consignor-statement",
    "intake-receipt",
    "expiry-letter",
    "disposal-record",
  ])
    ok(fs.readdirSync(path.join(tmp, "docs-out", name)).length > 0);
  const receipts = fs
    .readdirSync(path.join(tmp, "docs-out", "intake-receipt"))
    .map((f) =>
      fs.readFileSync(path.join(tmp, "docs-out", "intake-receipt", f), "utf8"),
    )
    .join("");
  ok(receipts.includes("&lt;script&gt;escaped&lt;/script&gt;"));
  ok(!receipts.includes("<script>escaped</script>"));
  console.log(
    `PASS (${mode}): ${count} assertions; all CLI workflows, ten analyses, imports, balance controls, four views and four document types.`,
  );
} finally {
  await db?.close();
  if (testSchema) {
    const cleanup = await getDb();
    try { await cleanup.exec(`drop schema ${testSchema} cascade`); }
    finally { await cleanup.close(); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
