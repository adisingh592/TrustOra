// Minimal typings for the part of Node's built-in SQLite module that the tests and scripts/db-safe-update.mjs use.
// (@types/node v20 predates node:sqlite.)
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): { get(...params: unknown[]): any; all(...params: unknown[]): any[] };
    close(): void;
  }
}
