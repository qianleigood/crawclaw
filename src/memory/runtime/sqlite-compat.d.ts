declare module "@photostructure/sqlite" {
  export type DatabaseSyncInstance = {
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      iterate(...params: unknown[]): Iterable<unknown>;
    };
    exec(sql: string): void;
    close(): void;
  };

  export class DatabaseSync {
    constructor(filename: string);
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      iterate(...params: unknown[]): Iterable<unknown>;
    };
    exec(sql: string): void;
    close(): void;
  }
}
