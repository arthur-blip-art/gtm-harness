import postgres from 'postgres';
import type { Cells, NewReceipt, Receipt, Run, RunStatus } from '../core/types.ts';
import type { DatasetRow, GoldenCompany, GoldenPerson, Store } from './store.ts';

/** Supabase Postgres store. One connection (session pooler), plain SQL, no ORM. */
export class PgStore implements Store {
  readonly kind = 'pg' as const;
  private sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 15 });
  }

  async findLatestReceipt(provider: string, tool: string, inputHash: string) {
    const rows = await this.sql<ReceiptRow[]>`
      select * from tool_receipts
      where provider = ${provider} and tool = ${tool} and input_hash = ${inputHash} and status <> 'error'
      order by created_at desc limit 1`;
    return rows[0] ? toReceipt(rows[0]) : null;
  }

  async insertReceipt(r: NewReceipt) {
    const rows = await this.sql<ReceiptRow[]>`
      insert into tool_receipts (provider, tool, input_hash, input, output, status, pricing_basis,
        cost_credits, cost_usd, http_status, duration_ms, error, run_id)
      values (${r.provider}, ${r.tool}, ${r.inputHash}, ${this.sql.json(r.input as never)},
        ${r.output === undefined ? null : this.sql.json(r.output as never)}, ${r.status}, ${r.pricingBasis},
        ${r.costCredits}, ${r.costUsd}, ${r.httpStatus ?? null}, ${r.durationMs ?? null}, ${r.error ?? null}, ${r.runId ?? null})
      returning *`;
    return toReceipt(rows[0]);
  }

  async listReceiptsByRun(runId: string) {
    const rows = await this.sql<ReceiptRow[]>`select * from tool_receipts where run_id = ${runId} order by created_at`;
    return rows.map(toReceipt);
  }

  async receiptStats() {
    const rows = await this.sql<{ provider: string; count: string; credits: string }[]>`
      select provider, count(*)::text as count, coalesce(sum(cost_credits),0)::text as credits
      from tool_receipts group by provider order by provider`;
    const byProvider: Record<string, { count: number; credits: number }> = {};
    let total = 0;
    for (const r of rows) {
      byProvider[r.provider] = { count: Number(r.count), credits: Number(r.credits) };
      total += Number(r.count);
    }
    return { total, byProvider };
  }

  async createRun(play: string, inputSummary: Record<string, unknown>, datasetId?: string) {
    const rows = await this.sql<RunRow[]>`
      insert into runs (play, dataset_id, status, input_summary)
      values (${play}, ${datasetId ?? null}, 'running', ${this.sql.json(inputSummary as never)}) returning *`;
    return toRun(rows[0]);
  }

  async finishRun(id: string, patch: Partial<Run> & { status: RunStatus }) {
    await this.sql`
      update runs set status = ${patch.status},
        rows_in = coalesce(${patch.rowsIn ?? null}, rows_in),
        rows_out = coalesce(${patch.rowsOut ?? null}, rows_out),
        total_cost_credits = coalesce(${patch.totalCostCredits ?? null}, total_cost_credits),
        total_cost_usd = coalesce(${patch.totalCostUsd ?? null}, total_cost_usd),
        receipt = coalesce(${patch.receipt === undefined ? null : this.sql.json(patch.receipt as never)}, receipt),
        notes = coalesce(${patch.notes ?? null}, notes),
        finished_at = now()
      where id = ${id}`;
  }

  async getRun(id: string) {
    const rows = await this.sql<RunRow[]>`select * from runs where id = ${id}`;
    return rows[0] ? toRun(rows[0]) : null;
  }

  async ensureDataset(slug: string, play: string) {
    const rows = await this.sql<{ id: string; slug: string }[]>`
      insert into datasets (slug, play) values (${slug}, ${play})
      on conflict (slug) do update set play = excluded.play
      returning id, slug`;
    return rows[0];
  }

  async upsertRows(datasetId: string, rows: Array<Pick<DatasetRow, 'rowKey' | 'input'>>) {
    const out: DatasetRow[] = [];
    for (const r of rows) {
      const res = await this.sql<{ row_key: string; input: Record<string, string>; cells: Cells; updated_at: Date }[]>`
        insert into dataset_rows (dataset_id, row_key, input)
        values (${datasetId}, ${r.rowKey}, ${this.sql.json(r.input as never)})
        on conflict (dataset_id, row_key) do update set input = excluded.input
        returning row_key, input, cells, updated_at`;
      const row = res[0];
      out.push({ rowKey: row.row_key, input: row.input, cells: row.cells ?? {}, updatedAt: row.updated_at.toISOString() });
    }
    return out;
  }

  async saveCells(datasetId: string, rowKey: string, cells: Cells) {
    await this.sql`update dataset_rows set cells = ${this.sql.json(cells as never)}, updated_at = now()
      where dataset_id = ${datasetId} and row_key = ${rowKey}`;
  }

  async upsertCompany(c: GoldenCompany) {
    await this.sql`
      insert into companies (domain, name, field_sources, raw)
      values (${c.domain}, ${c.name ?? null}, ${this.sql.json(c.fieldSources as never)}, ${this.sql.json(c.raw as never)})
      on conflict (domain) do update set
        name = coalesce(excluded.name, companies.name),
        field_sources = companies.field_sources || excluded.field_sources,
        raw = companies.raw || excluded.raw,
        updated_at = now()`;
  }

  async upsertPerson(p: GoldenPerson) {
    await this.sql`
      insert into people (person_key, first_name, last_name, title, domain, linkedin_url, email, email_status,
        email_source, email_verified_at, confidence, field_sources, raw, company_id)
      values (${p.personKey}, ${p.firstName ?? null}, ${p.lastName ?? null}, ${p.title ?? null}, ${p.domain ?? null},
        ${p.linkedinUrl ?? null}, ${p.email}, ${p.emailStatus}, ${p.emailSource},
        ${p.email ? new Date() : null}, ${p.confidence}, ${this.sql.json(p.fieldSources as never)}, ${this.sql.json(p.raw as never)},
        (select id from companies where domain = ${p.domain ?? null}))
      on conflict (person_key) do update set
        first_name = coalesce(excluded.first_name, people.first_name),
        last_name = coalesce(excluded.last_name, people.last_name),
        title = coalesce(excluded.title, people.title),
        domain = coalesce(excluded.domain, people.domain),
        linkedin_url = coalesce(excluded.linkedin_url, people.linkedin_url),
        email = coalesce(excluded.email, people.email),
        email_status = coalesce(excluded.email_status, people.email_status),
        email_source = coalesce(excluded.email_source, people.email_source),
        email_verified_at = coalesce(excluded.email_verified_at, people.email_verified_at),
        confidence = excluded.confidence,
        field_sources = people.field_sources || excluded.field_sources,
        raw = people.raw || excluded.raw,
        company_id = coalesce(excluded.company_id, people.company_id),
        updated_at = now()`;
  }

  async ping() {
    const rows = await this.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
    return rows.map((r) => r.table_name);
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

type ReceiptRow = {
  id: string; provider: string; tool: string; input_hash: string; input: Record<string, unknown>; output: unknown;
  status: 'hit' | 'miss' | 'error'; pricing_basis: Receipt['pricingBasis']; cost_credits: string; cost_usd: string | null;
  http_status: number | null; duration_ms: number | null; error: string | null; run_id: string | null; created_at: Date;
};
function toReceipt(r: ReceiptRow): Receipt {
  return {
    id: r.id, provider: r.provider, tool: r.tool, inputHash: r.input_hash, input: r.input, output: r.output,
    status: r.status, pricingBasis: r.pricing_basis, costCredits: Number(r.cost_credits), costUsd: Number(r.cost_usd ?? 0),
    httpStatus: r.http_status ?? undefined, durationMs: r.duration_ms ?? undefined, error: r.error ?? undefined,
    runId: r.run_id ?? undefined, createdAt: r.created_at.toISOString(),
  };
}
type RunRow = {
  id: string; play: string; dataset_id: string | null; status: RunStatus; input_summary: Record<string, unknown>;
  rows_in: number; rows_out: number; total_cost_credits: string; total_cost_usd: string; receipt: unknown;
  started_at: Date; finished_at: Date | null; notes: string | null;
};
function toRun(r: RunRow): Run {
  return {
    id: r.id, play: r.play, datasetId: r.dataset_id ?? undefined, status: r.status, inputSummary: r.input_summary,
    rowsIn: r.rows_in, rowsOut: r.rows_out, totalCostCredits: Number(r.total_cost_credits), totalCostUsd: Number(r.total_cost_usd),
    receipt: r.receipt, startedAt: r.started_at.toISOString(), finishedAt: r.finished_at?.toISOString(), notes: r.notes ?? undefined,
  };
}
