import { randomUUID } from 'node:crypto';
import type { Cells, NewReceipt, Receipt, Run, RunStatus } from '../core/types.ts';
import type { DatasetRow, GoldenCompany, GoldenPerson, Store } from './store.ts';

/** In-memory store for --dry-run and tests. Same semantics as Postgres, nothing persisted. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  receipts: Receipt[] = [];
  runs = new Map<string, Run>();
  datasets = new Map<string, { id: string; slug: string; play: string }>();
  rows = new Map<string, Map<string, DatasetRow>>();
  people = new Map<string, GoldenPerson>();
  companies = new Map<string, GoldenCompany>();

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
    this.companies.set(c.domain, c);
  }
  async upsertPerson(p: GoldenPerson) {
    this.people.set(p.personKey, p);
  }
  async ping() {
    return ['(memory) runs', 'tool_receipts', 'datasets', 'dataset_rows', 'companies', 'people'];
  }
  async close() {}
}
