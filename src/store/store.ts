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
  linkedinSource?: string;
  linkedinConfidence?: string;
  email: string | null;
  emailStatus: string | null;
  emailSource: string | null;
  confidence: string;
  phone?: string | null;
  phoneStatus?: string | null;
  phoneSource?: string | null;
  fieldSources: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface PersonRow extends GoldenPerson {
  id: string;
  doNotContact: boolean;
}

export interface GoldenCompany {
  domain: string;
  name?: string;
  linkedinUrl?: string;
  country?: string;
  city?: string;
  industry?: string;
  headcount?: number;
  employeesRange?: string;
  foundedYear?: number;
  fundingTotalUsd?: number;
  fundingLastRound?: string;
  fundingLastDate?: string;
  tech?: string[];
  fieldSources: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface CompanyRow extends GoldenCompany {
  id: string;
}

export interface Signal {
  dedupeKey: string;
  domain: string;
  type: string;
  value: Record<string, unknown>;
  source: string;
  observedAt?: string;
  receiptId?: string;
}

export interface Score {
  domain: string;
  model: string;
  dimension: 'account_fit' | 'account_engagement' | 'lead_fit' | 'lead_engagement';
  score: number | null;
  tier: string | null;
  reasons: unknown[];
  inputs: Record<string, unknown>;
  missReason?: string | null;
}

export interface CrmSync {
  entityType: 'company' | 'person';
  entityId: string;
  crm: string;
  crmObjectType?: string;
  crmId?: string;
  lastHash?: string;
  lastSyncedAt?: string;
  status?: string;
  error?: string;
}

/** One interface, two implementations: Postgres (Supabase) and in-memory (dry-run, tests). */
export interface Store {
  readonly kind: 'pg' | 'memory';
  // receipts
  findLatestReceipt(provider: string, tool: string, inputHash: string): Promise<Receipt | null>;
  insertReceipt(r: NewReceipt): Promise<Receipt>;
  listReceiptsByRun(runId: string): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | null>;
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
  listCompanies(domains?: string[]): Promise<CompanyRow[]>;
  listPeople(domains?: string[]): Promise<PersonRow[]>;
  // signals, scores, crm
  upsertSignals(rows: Signal[]): Promise<number>;
  listSignals(domains: string[], since?: string): Promise<Signal[]>;
  upsertScore(s: Score): Promise<void>;
  listScores(model: string, domains?: string[]): Promise<Score[]>;
  getCrmSync(entityType: CrmSync['entityType'], entityId: string, crm: string): Promise<CrmSync | null>;
  upsertCrmSync(c: CrmSync): Promise<void>;
  // lifecycle
  ping(): Promise<string[]>;
  close(): Promise<void>;
}
