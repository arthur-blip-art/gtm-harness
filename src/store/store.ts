import type { Cells, NewReceipt, Receipt, Run, RunStatus } from '../core/types.ts';

export interface DatasetRow {
  rowKey: string;
  input: Record<string, string>;
  cells: Cells;
  updatedAt: string;
}

export interface GoldenPerson {
  personKey: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  domain?: string;
  linkedinUrl?: string;
  email: string | null;
  emailStatus: string | null;
  emailSource: string | null;
  confidence: string;
  fieldSources: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface GoldenCompany {
  domain: string;
  name?: string;
  fieldSources: Record<string, string>;
  raw: Record<string, unknown>;
}

/** One interface, two implementations: Postgres (Supabase) and in-memory (dry-run, tests). */
export interface Store {
  readonly kind: 'pg' | 'memory';
  // receipts
  findLatestReceipt(provider: string, tool: string, inputHash: string): Promise<Receipt | null>;
  insertReceipt(r: NewReceipt): Promise<Receipt>;
  listReceiptsByRun(runId: string): Promise<Receipt[]>;
  receiptStats(): Promise<{ total: number; byProvider: Record<string, { count: number; credits: number }> }>;
  // runs
  createRun(play: string, inputSummary: Record<string, unknown>, datasetId?: string): Promise<Run>;
  finishRun(id: string, patch: Partial<Run> & { status: RunStatus }): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  // datasets
  ensureDataset(slug: string, play: string): Promise<{ id: string; slug: string }>;
  upsertRows(datasetId: string, rows: Array<Pick<DatasetRow, 'rowKey' | 'input'>>): Promise<DatasetRow[]>;
  saveCells(datasetId: string, rowKey: string, cells: Cells): Promise<void>;
  // golden records
  upsertCompany(c: GoldenCompany): Promise<void>;
  upsertPerson(p: GoldenPerson): Promise<void>;
  // lifecycle
  ping(): Promise<string[]>;
  close(): Promise<void>;
}
