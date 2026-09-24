import { randomUUID } from 'node:crypto';
import type { Cells, NewReceipt, Receipt, Run, RunStatus } from '../core/types.ts';
import type { CompanyRow, CrmSync, DatasetRow, GoldenCompany, GoldenPerson, PersonRow, Score, Signal, Store } from './store.ts';

/** In-memory store for --dry-run and tests. Same semantics as Postgres, nothing persisted. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  receipts: Receipt[] = [];
  runs = new Map<string, Run>();
  datasets = new Map<string, { id: string; slug: string; play: string }>();
  rows = new Map<string, Map<string, DatasetRow>>();
  people = new Map<string, PersonRow>();
  companies = new Map<string, CompanyRow>();
  signals = new Map<string, Signal>();
  scores = new Map<string, Score>();
  crm = new Map<string, CrmSync>();

  async findLatestReceipt(provider: string, tool: string, inputHash: string) {
    for (let i = this.receipts.length - 1; i >= 0; i--) {
      const r = this.receipts[i];
      if (r.provider === provider && r.tool === tool && r.inputHash === inputHash && r.status !== 'error') return r;
    }
    return null;
  }
  async insertReceipt(r: NewReceipt) {
    const full: Receipt = { ...r, id: randomUUID(), createdAt: new Date().toISOString() };
    this.receipts.push(full);
    return full;
  }
  async listReceiptsByRun(runId: string) {
    return this.receipts.filter((r) => r.runId === runId);
  }
  async getReceipt(id: string) {
    return this.receipts.find((r) => r.id === id) ?? null;
  }
  async receiptStats() {
    const byProvider: Record<string, { count: number; credits: number }> = {};
    for (const r of this.receipts) {
      const b = (byProvider[r.provider] ??= { count: 0, credits: 0 });
      b.count++;
      b.credits += r.costCredits;
    }
    return { total: this.receipts.length, byProvider };
  }

  async createRun(play: string, inputSummary: Record<string, unknown>, datasetId?: string) {
    const run: Run = {
      id: randomUUID(), play, datasetId, status: 'running', inputSummary,
      rowsIn: 0, rowsOut: 0, totalCostCredits: 0, totalCostUsd: 0, startedAt: new Date().toISOString(),
    };
    this.runs.set(run.id, run);
    return run;
  }
  async finishRun(id: string, patch: Partial<Run> & { status: RunStatus }) {
    const run = this.runs.get(id);
    if (run) Object.assign(run, patch, { finishedAt: new Date().toISOString() });
  }
  async getRun(id: string) {
    return this.runs.get(id) ?? null;
  }

  async ensureDataset(slug: string, play: string) {
    let d = this.datasets.get(slug);
    if (!d) {
      d = { id: randomUUID(), slug, play };
      this.datasets.set(slug, d);
      this.rows.set(d.id, new Map());
    }
    return d;
  }
  async upsertRows(datasetId: string, rows: Array<Pick<DatasetRow, 'rowKey' | 'input'>>) {
    const map = this.rows.get(datasetId) ?? new Map<string, DatasetRow>();
    this.rows.set(datasetId, map);
    const out: DatasetRow[] = [];
    for (const r of rows) {
      const existing = map.get(r.rowKey);
      const row: DatasetRow = existing
        ? { ...existing, input: r.input }
        : { rowKey: r.rowKey, input: r.input, cells: {}, updatedAt: new Date().toISOString() };
      map.set(r.rowKey, row);
      out.push(row);
    }
    return out;
  }
  async saveCells(datasetId: string, rowKey: string, cells: Cells) {
    const row = this.rows.get(datasetId)?.get(rowKey);
    if (row) {
      row.cells = cells;
      row.updatedAt = new Date().toISOString();
    }
  }

  async upsertCompany(c: GoldenCompany) {
    const prev = this.companies.get(c.domain);
    this.companies.set(c.domain, mergeDefined(prev ?? { id: randomUUID(), domain: c.domain, fieldSources: {}, raw: {} }, c, ['fieldSources', 'raw']) as CompanyRow);
  }
  async upsertPerson(p: GoldenPerson) {
    const prev = this.people.get(p.personKey);
    const merged = mergeDefined(prev ?? { id: randomUUID(), personKey: p.personKey, doNotContact: false, email: null, emailStatus: null, emailSource: null, confidence: 'LOW', fieldSources: {}, raw: {} }, p, ['fieldSources', 'raw']) as PersonRow;
    merged.confidence = p.confidence;
    this.people.set(p.personKey, merged);
  }
  async listCompanies(domains?: string[]) {
    const all = [...this.companies.values()];
    return domains ? all.filter((c) => domains.includes(c.domain)) : all;
  }
  async listPeople(domains?: string[]) {
    const all = [...this.people.values()];
    return domains ? all.filter((p) => p.domain && domains.includes(p.domain)) : all;
  }
  async upsertSignals(rows: Signal[]) {
    let n = 0;
    for (const r of rows) {
      if (!this.signals.has(r.dedupeKey)) n++;
      this.signals.set(r.dedupeKey, r);
    }
    return n;
  }
  async listSignals(domains: string[], since?: string) {
    return [...this.signals.values()].filter((s) => domains.includes(s.domain) && (!since || !s.observedAt || s.observedAt >= since));
  }
  async upsertScore(sc: Score) {
    this.scores.set(`${sc.domain}|${sc.model}|${sc.dimension}`, sc);
  }
  async listScores(model: string, domains?: string[]) {
    return [...this.scores.values()].filter((s) => s.model === model && (!domains || domains.includes(s.domain)));
  }
  async getCrmSync(entityType: CrmSync['entityType'], entityId: string, crm: string) {
    return this.crm.get(`${entityType}|${entityId}|${crm}`) ?? null;
  }
  async upsertCrmSync(c: CrmSync) {
    this.crm.set(`${c.entityType}|${c.entityId}|${c.crm}`, c);
  }
  async ping() {
    return ['(memory) runs', 'tool_receipts', 'datasets', 'dataset_rows', 'companies', 'people', 'signals', 'scores', 'crm_sync'];
  }
  async close() {}
}

/** Coalesce semantics like the SQL upserts: defined values win, null/undefined keep the previous; jsonb maps are merged. */
function mergeDefined<T extends object>(prev: T, next: object, mapKeys: string[]): T {
  const out: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
  for (const [k, v] of Object.entries(next)) {
    if (mapKeys.includes(k)) out[k] = { ...((prev as Record<string, unknown>)[k] as object), ...(v as object) };
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out as unknown as T;
}
