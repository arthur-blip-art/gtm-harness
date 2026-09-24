import postgres from 'postgres';
import type { Cells, NewReceipt, Receipt, Run, RunStatus } from '../core/types.ts';
import type { CompanyRow, CrmSync, DatasetRow, GoldenCompany, GoldenPerson, PersonRow, Score, Signal, Store } from './store.ts';

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

  async getReceipt(id: string) {
    const rows = await this.sql<ReceiptRow[]>`select * from tool_receipts where id = ${id}`;
    return rows[0] ? toReceipt(rows[0]) : null;
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
      insert into companies (domain, name, linkedin_url, country, city, industry, headcount, employees_range, founded_year,
        funding_total_usd, funding_last_round, funding_last_date, tech, field_sources, raw)
      values (${c.domain}, ${c.name ?? null}, ${c.linkedinUrl ?? null}, ${c.country ?? null}, ${c.city ?? null}, ${c.industry ?? null},
        ${c.headcount ?? null}, ${c.employeesRange ?? null}, ${c.foundedYear ?? null}, ${c.fundingTotalUsd ?? null}, ${c.fundingLastRound ?? null},
        ${c.fundingLastDate ?? null}, ${this.sql.json((c.tech ?? []) as never)}, ${this.sql.json(c.fieldSources as never)}, ${this.sql.json(c.raw as never)})
      on conflict (domain) do update set
        name = coalesce(excluded.name, companies.name),
        linkedin_url = coalesce(excluded.linkedin_url, companies.linkedin_url),
        country = coalesce(excluded.country, companies.country),
        city = coalesce(excluded.city, companies.city),
        industry = coalesce(excluded.industry, companies.industry),
        headcount = coalesce(excluded.headcount, companies.headcount),
        employees_range = coalesce(excluded.employees_range, companies.employees_range),
        founded_year = coalesce(excluded.founded_year, companies.founded_year),
        funding_total_usd = coalesce(excluded.funding_total_usd, companies.funding_total_usd),
        funding_last_round = coalesce(excluded.funding_last_round, companies.funding_last_round),
        funding_last_date = coalesce(excluded.funding_last_date, companies.funding_last_date),
        tech = case when jsonb_array_length(excluded.tech) > 0 then excluded.tech else companies.tech end,
        field_sources = companies.field_sources || excluded.field_sources,
        raw = companies.raw || excluded.raw,
        updated_at = now()`;
  }

  async listCompanies(domains?: string[]) {
    const rows = domains
      ? await this.sql<CompanyDb[]>`select * from companies where domain = any(${domains})`
      : await this.sql<CompanyDb[]>`select * from companies order by domain`;
    return rows.map(toCompany);
  }

  async listPeople(domains?: string[]) {
    const rows = domains
      ? await this.sql<PersonDb[]>`select * from people where domain = any(${domains})`
      : await this.sql<PersonDb[]>`select * from people order by domain, last_name`;
    return rows.map(toPerson);
  }

  async upsertSignals(rows: Signal[]) {
    let n = 0;
    for (const r of rows) {
      const res = await this.sql`
        insert into signals (dedupe_key, domain, type, value, source, observed_at, receipt_id, company_id)
        values (${r.dedupeKey}, ${r.domain}, ${r.type}, ${this.sql.json(r.value as never)}, ${r.source}, ${r.observedAt ?? null}, ${r.receiptId ?? null},
          (select id from companies where domain = ${r.domain}))
        on conflict (dedupe_key) do nothing`;
      n += res.count;
    }
    return n;
  }

  async listSignals(domains: string[], since?: string) {
    const rows = await this.sql<SignalDb[]>`
      select * from signals where domain = any(${domains}) and (${since ?? null}::timestamptz is null or observed_at >= ${since ?? null})
      order by observed_at desc`;
    return rows.map((r) => ({ dedupeKey: r.dedupe_key, domain: r.domain, type: r.type, value: r.value, source: r.source, observedAt: r.observed_at?.toISOString(), receiptId: r.receipt_id ?? undefined }));
  }

  async upsertScore(sc: Score) {
    await this.sql`
      insert into scores (domain, model, dimension, score, tier, reasons, inputs, miss_reason, company_id)
      values (${sc.domain}, ${sc.model}, ${sc.dimension}, ${sc.score}, ${sc.tier}, ${this.sql.json(sc.reasons as never)}, ${this.sql.json(sc.inputs as never)}, ${sc.missReason ?? null},
        (select id from companies where domain = ${sc.domain}))
      on conflict (domain, model, dimension) do update set
        score = excluded.score, tier = excluded.tier, reasons = excluded.reasons, inputs = excluded.inputs, miss_reason = excluded.miss_reason, computed_at = now()`;
  }

  async listScores(model: string, domains?: string[]) {
    const rows = domains
      ? await this.sql<ScoreDb[]>`select * from scores where model = ${model} and domain = any(${domains})`
      : await this.sql<ScoreDb[]>`select * from scores where model = ${model}`;
    return rows.map((r) => ({ domain: r.domain, model: r.model, dimension: r.dimension, score: r.score === null ? null : Number(r.score), tier: r.tier, reasons: r.reasons, inputs: r.inputs, missReason: r.miss_reason }));
  }

  async getCrmSync(entityType: CrmSync['entityType'], entityId: string, crm: string) {
    const rows = await this.sql<CrmDb[]>`select * from crm_sync where entity_type = ${entityType} and entity_id = ${entityId} and crm = ${crm}`;
    const r = rows[0];
    return r ? { entityType: r.entity_type, entityId: r.entity_id, crm: r.crm, crmObjectType: r.crm_object_type ?? undefined, crmId: r.crm_id ?? undefined, lastHash: r.last_hash ?? undefined, lastSyncedAt: r.last_synced_at?.toISOString(), status: r.status ?? undefined, error: r.error ?? undefined } : null;
  }

  async upsertCrmSync(c: CrmSync) {
    await this.sql`
      insert into crm_sync (entity_type, entity_id, crm, crm_object_type, crm_id, last_hash, last_synced_at, status, error)
      values (${c.entityType}, ${c.entityId}, ${c.crm}, ${c.crmObjectType ?? null}, ${c.crmId ?? null}, ${c.lastHash ?? null}, ${c.lastSyncedAt ?? null}, ${c.status ?? null}, ${c.error ?? null})
      on conflict (entity_type, entity_id, crm) do update set
        crm_object_type = coalesce(excluded.crm_object_type, crm_sync.crm_object_type), crm_id = coalesce(excluded.crm_id, crm_sync.crm_id),
        last_hash = coalesce(excluded.last_hash, crm_sync.last_hash), last_synced_at = coalesce(excluded.last_synced_at, crm_sync.last_synced_at),
        status = excluded.status, error = excluded.error`;
  }

  async upsertPerson(p: GoldenPerson) {
    await this.sql`
      insert into people (person_key, first_name, last_name, title, domain, linkedin_url, linkedin_source, linkedin_confidence, email, email_status,
        email_source, email_verified_at, confidence, phone, phone_status, phone_source, phone_verified_at, field_sources, raw, company_id)
      values (${p.personKey}, ${p.firstName ?? null}, ${p.lastName ?? null}, ${p.title ?? null}, ${p.domain ?? null},
        ${p.linkedinUrl ?? null}, ${p.linkedinSource ?? null}, ${p.linkedinConfidence ?? null}, ${p.email}, ${p.emailStatus}, ${p.emailSource},
        ${p.email ? new Date() : null}, ${p.confidence}, ${p.phone ?? null}, ${p.phoneStatus ?? null}, ${p.phoneSource ?? null}, ${p.phone ? new Date() : null},
        ${this.sql.json(p.fieldSources as never)}, ${this.sql.json(p.raw as never)},
        (select id from companies where domain = ${p.domain ?? null}))
      on conflict (person_key) do update set
        linkedin_source = coalesce(excluded.linkedin_source, people.linkedin_source),
        linkedin_confidence = coalesce(excluded.linkedin_confidence, people.linkedin_confidence),
        phone = coalesce(excluded.phone, people.phone),
        phone_status = coalesce(excluded.phone_status, people.phone_status),
        phone_source = coalesce(excluded.phone_source, people.phone_source),
        phone_verified_at = coalesce(excluded.phone_verified_at, people.phone_verified_at),
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
type CompanyDb = { id: string; domain: string; name: string | null; linkedin_url: string | null; country: string | null; city: string | null; industry: string | null; headcount: number | null; employees_range: string | null; founded_year: number | null; funding_total_usd: string | null; funding_last_round: string | null; funding_last_date: Date | null; tech: string[]; field_sources: Record<string, string>; raw: Record<string, unknown> };
function toCompany(r: CompanyDb): CompanyRow {
  return { id: r.id, domain: r.domain, name: r.name ?? undefined, linkedinUrl: r.linkedin_url ?? undefined, country: r.country ?? undefined, city: r.city ?? undefined, industry: r.industry ?? undefined, headcount: r.headcount ?? undefined, employeesRange: r.employees_range ?? undefined, foundedYear: r.founded_year ?? undefined, fundingTotalUsd: r.funding_total_usd === null ? undefined : Number(r.funding_total_usd), fundingLastRound: r.funding_last_round ?? undefined, fundingLastDate: r.funding_last_date ? r.funding_last_date.toISOString().slice(0, 10) : undefined, tech: r.tech ?? [], fieldSources: r.field_sources ?? {}, raw: r.raw ?? {} };
}
type PersonDb = { id: string; person_key: string; first_name: string | null; last_name: string | null; title: string | null; domain: string | null; linkedin_url: string | null; linkedin_source: string | null; linkedin_confidence: string | null; email: string | null; email_status: string | null; email_source: string | null; confidence: string | null; phone: string | null; phone_status: string | null; phone_source: string | null; field_sources: Record<string, string>; raw: Record<string, unknown>; do_not_contact: boolean };
function toPerson(r: PersonDb): PersonRow {
  return { id: r.id, personKey: r.person_key, firstName: r.first_name ?? undefined, lastName: r.last_name ?? undefined, title: r.title ?? undefined, domain: r.domain ?? undefined, linkedinUrl: r.linkedin_url ?? undefined, linkedinSource: r.linkedin_source ?? undefined, linkedinConfidence: r.linkedin_confidence ?? undefined, email: r.email, emailStatus: r.email_status, emailSource: r.email_source, confidence: r.confidence ?? 'LOW', phone: r.phone, phoneStatus: r.phone_status, phoneSource: r.phone_source, fieldSources: r.field_sources ?? {}, raw: r.raw ?? {}, doNotContact: r.do_not_contact };
}
type SignalDb = { dedupe_key: string; domain: string; type: string; value: Record<string, unknown>; source: string; observed_at: Date | null; receipt_id: string | null };
type ScoreDb = { domain: string; model: string; dimension: Score['dimension']; score: string | null; tier: string | null; reasons: unknown[]; inputs: Record<string, unknown>; miss_reason: string | null };
type CrmDb = { entity_type: CrmSync['entityType']; entity_id: string; crm: string; crm_object_type: string | null; crm_id: string | null; last_hash: string | null; last_synced_at: Date | null; status: string | null; error: string | null };
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
