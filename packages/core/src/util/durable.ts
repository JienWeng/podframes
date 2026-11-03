import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function database(root: string): DatabaseSync {
  const dir = join(root, ".automation");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, "state.sqlite"));
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  return db;
}

/** SQLite transactions coordinate the web process and worker, including crashes. */
export function durableUpdate<T, R>(
  root: string,
  name: string,
  initial: () => T,
  update: (value: T) => R,
): R {
  const db = database(root);
  try {
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT value FROM state WHERE name = ?").get(name);
    const value: T = row ? JSON.parse(String(row.value)) : initial();
    const result = update(value);
    db.prepare(
      "INSERT INTO state(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
    ).run(name, JSON.stringify(value));
    db.exec("COMMIT");
    return result;
  } finally {
    db.close();
  }
}

export function durableRead<T>(
  root: string,
  name: string,
  initial: () => T,
): T {
  const db = database(root);
  try {
    const row = db.prepare("SELECT value FROM state WHERE name = ?").get(name);
    return row ? JSON.parse(String(row.value)) : initial();
  } finally {
    db.close();
  }
}
