#!/usr/bin/env node
/**
 * Safe, non-destructive SQLite schema update for TRUSTORA.
 *
 *   node scripts/db-safe-update.mjs                 # DRY RUN (default): shows the plan, changes nothing
 *   node scripts/db-safe-update.mjs --apply         # backs up, then applies the plan in one transaction
 *   node scripts/db-safe-update.mjs --db <file>     # target another database file
 *
 * Why not `prisma db push --accept-data-loss`? That flag turns off Prisma's safety checks entirely.
 * This script instead computes the exact SQL difference, REFUSES if it contains any DROP, checks the
 * preconditions of new unique indexes itself, makes and verifies a backup, and applies everything in a
 * single transaction that rolls back on any error. Stop the dev server before using --apply.
 */
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const require = createRequire(import.meta.url);

export class SafeUpdateError extends Error {}

function prismaCli() {
  return require.resolve("prisma/build/index.js", { paths: [webRoot] });
}

/** SQL that would turn `dbPath` into the shape described by `schemaPath`. Read-only. */
export function diffSql(dbPath, schemaPath) {
  const out = execFileSync(
    process.execPath,
    [prismaCli(), "migrate", "diff", "--from-url", `file:${resolve(dbPath)}`, "--to-schema-datamodel", resolve(schemaPath), "--script"],
    { encoding: "utf8", env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const sql = out.trim();
  return /^-- This is an empty migration\.?$/m.test(sql) || sql === "" ? "" : sql;
}

const tablesOf = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);

export function rowCounts(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return Object.fromEntries(tablesOf(db).map((t) => [t, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n)]));
  } finally {
    db.close();
  }
}

function integrity(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("PRAGMA integrity_check").get().integrity_check;
  } finally {
    db.close();
  }
}

/** Summarizes what a plan would do, for people to read. */
export function describePlan(sql) {
  const newTables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
  const newColumns = [...sql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g)].map((m) => `${m[1]}.${m[2]}`);
  const newIndexes = [...sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)"/g)].map((m) => `${m[1] ? "unique " : ""}${m[2]}`);
  return { newTables, newColumns, newIndexes };
}

/** Anything that removes or rebuilds existing structure is refused: this tool only ever adds. */
export function destructiveStatements(sql) {
  return sql
    .split("\n")
    .filter((l) => /\b(DROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)|DELETE\s+FROM|TRUNCATE|RENAME\s+(TO|COLUMN)|UPDATE\s+")/i.test(l))
    .map((l) => l.trim());
}

/** New unique indexes fail on existing duplicates; find them first so we can refuse before touching anything. */
export function uniqueConflicts(dbPath, sql) {
  const problems = [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const existing = new Set(tablesOf(db));
    for (const m of sql.matchAll(/CREATE UNIQUE INDEX "[^"]+" ON "([^"]+)"\(([^)]+)\)/g)) {
      const [, table, colList] = m;
      if (!existing.has(table)) continue; // brand-new table: cannot have duplicates
      const cols = colList.split(",").map((c) => c.trim());
      const rows = db.prepare(`SELECT ${cols.join(", ")}, COUNT(*) AS n FROM "${table}" GROUP BY ${cols.join(", ")} HAVING COUNT(*) > 1 LIMIT 5`).all();
      if (rows.length) problems.push(`${table}(${cols.join(", ")}) has ${rows.length}+ duplicate group(s), e.g. ${JSON.stringify(rows[0])}`);
    }
  } finally {
    db.close();
  }
  return problems;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

/** Copies the database (after checkpointing WAL) and proves the copy is intact before returning its path. */
export function makeVerifiedBackup(dbPath, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const src = new DatabaseSync(dbPath);
  try {
    src.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    src.close();
  }
  const backupPath = join(backupDir, `${basename(dbPath, ".db")}-${timestamp()}.db`);
  copyFileSync(dbPath, backupPath);
  const same = JSON.stringify(rowCounts(dbPath)) === JSON.stringify(rowCounts(backupPath));
  if (integrity(backupPath) !== "ok" || !same) {
    throw new SafeUpdateError(`Backup verification failed for ${backupPath}; the database was NOT modified.`);
  }
  return backupPath;
}

/**
 * Plans (and with apply=true, performs) the update. Returns a result object; throws SafeUpdateError when refusing.
 * Order is deliberate: plan -> refuse if unsafe -> verified backup -> transactional apply -> verify.
 */
export function run({ dbPath, schemaPath, apply = false, backupDir } = {}) {
  dbPath = resolve(dbPath ?? join(webRoot, "prisma", "dev.db"));
  schemaPath = resolve(schemaPath ?? join(webRoot, "prisma", "schema.prisma"));
  backupDir = resolve(backupDir ?? join(dirname(dbPath), "backups"));

  if (!existsSync(dbPath)) {
    throw new SafeUpdateError(`No database at ${dbPath}. There is nothing to protect, so create it with: npm run db:push`);
  }
  const before = rowCounts(dbPath);
  const sql = diffSql(dbPath, schemaPath);
  if (!sql) return { status: "UP_TO_DATE", plan: describePlan(""), before };

  const bad = destructiveStatements(sql);
  if (bad.length) {
    throw new SafeUpdateError(`Refusing: the update would remove or rebuild existing data structures:\n  ${bad.join("\n  ")}\nNothing was changed. Review these manually.`);
  }
  const conflicts = uniqueConflicts(dbPath, sql);
  if (conflicts.length) {
    throw new SafeUpdateError(`Refusing: new unique indexes would fail on existing data:\n  ${conflicts.join("\n  ")}\nNothing was changed. Fix the duplicates first.`);
  }

  const plan = describePlan(sql);
  if (!apply) return { status: "DRY_RUN", plan, before, sql };

  const backupPath = makeVerifiedBackup(dbPath, backupDir);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(sql);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw new SafeUpdateError(`The update failed and was rolled back (${err.message}). The database is unchanged; a backup is at ${backupPath}.`);
  } finally {
    db.close();
  }

  const after = rowCounts(dbPath);
  const lost = Object.keys(before).filter((t) => after[t] !== before[t]);
  if (integrity(dbPath) !== "ok" || lost.length || diffSql(dbPath, schemaPath) !== "") {
    throw new SafeUpdateError(`Post-update verification failed (${lost.length ? `row counts changed in ${lost.join(", ")}` : "integrity/diff check"}). Restore the backup: ${backupPath}`);
  }
  return { status: "APPLIED", plan, before, after, backupPath };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  try {
    const result = run({ dbPath: opt("--db"), schemaPath: opt("--schema"), apply: args.includes("--apply") });
    const p = result.plan;
    if (result.status === "UP_TO_DATE") {
      console.log("Database is already up to date. Nothing to do.");
      return;
    }
    console.log(`New tables:   ${p.newTables.join(", ") || "none"}`);
    console.log(`New columns:  ${p.newColumns.join(", ") || "none"}`);
    console.log(`New indexes:  ${p.newIndexes.join(", ") || "none"}`);
    console.log(`Row counts (unchanged by this update): ${JSON.stringify(result.before)}`);
    if (result.status === "DRY_RUN") {
      console.log("\nDRY RUN: nothing was changed. This update only ADDS structure (no DROP/DELETE/rename).");
      console.log("Stop the dev server, then run again with --apply to back up and apply.");
    } else {
      console.log(`\nApplied. Backup (verified): ${result.backupPath}`);
      console.log(`To restore: stop the app and copy that file over the database file.`);
    }
  } catch (err) {
    console.error(err instanceof SafeUpdateError ? err.message : err);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
