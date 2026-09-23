// ---- Pricing & tools -------------------------------------------------------

export type PricingBasis = 'per_call' | 'per_hit' | 'per_result' | 'free' | 'unknown';
export type ToolStatus = 'hit' | 'miss' | 'error';

export interface ToolResult {
  status: ToolStatus;
  /** Provider payload, scrubbed of secrets. Stored verbatim in the receipt. */
  output?: unknown;
  missReason?: string;
  httpStatus?: number;
  error?: string;
  /** When the provider reports the exact spend (e.g. PDL's x-call-credits-spent header). */
  costOverride?: number;
}

export type ToolInput = Record<string, unknown>;

export interface AdapterCtx {
  fetch: typeof fetch;
  log: (msg: string) => void;
}

export interface ToolDef {
  description: string;
  /** Canonical, minimal input. What gets hashed is exactly what gets sent. */
  normalize(input: ToolInput): ToolInput;
  execute?(input: ToolInput, ctx: AdapterCtx): Promise<ToolResult>;
  /** Optional batch path. Results must be positional. */
  executeBatch?(inputs: ToolInput[], ctx: AdapterCtx): Promise<ToolResult[]>;
  maxBatch?: number;
  /** Credits charged for this result, from the static price table unless costOverride is set. */
  cost(result: ToolResult): number;
}

export interface PriceEntry {
  basis: PricingBasis;
  credits: number;
  note?: string;
}

export interface Adapter {
  name: string;
  pricing: {
    /** Approximate USD per credit, for the receipt's USD column. */
    usdPerCredit: number;
    /** Date the price table was last checked against the provider's pricing page. */
    verifiedOn: string;
    table: Record<string, PriceEntry>;
  };
  requiredEnv: string[];
  tools: Record<string, ToolDef>;
}

// ---- Receipts (cache + cost ledger) ----------------------------------------

export interface Receipt {
  id: string;
  provider: string;
  tool: string;
  inputHash: string;
  input: ToolInput;
  output: unknown;
  status: ToolStatus;
  pricingBasis: PricingBasis;
  costCredits: number;
  costUsd: number;
  httpStatus?: number;
  durationMs?: number;
  error?: string;
  runId?: string;
  createdAt: string;
  /** Set on the returned object when served from cache; never persisted. */
  cached?: boolean;
}

export type NewReceipt = Omit<Receipt, 'id' | 'createdAt' | 'cached'>;

// ---- Email policy ------------------------------------------------------------

export type EmailStatus = 'valid' | 'catch_all' | 'unknown' | 'invalid' | 'disposable';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'HOLD';

export interface EmailCandidate {
  email: string;
  status: EmailStatus;
  rawStatus?: string;
  source: string;
}

// ---- Dataset rows & cells ------------------------------------------------------

export type LegCellStatus = 'hit' | 'miss' | 'error' | 'skipped' | 'not_reached';

export interface LegCell {
  status: LegCellStatus;
  value?: string;
  rawStatus?: string;
  missReason?: string;
  receiptId?: string;
  cached?: boolean;
  costCredits: number;
  at: string;
}

export interface EmailCell {
  value: string | null;
  status: EmailStatus | null;
  source: string | null;
  confidence: Confidence;
  missReason: string | null;
}

export type Cells = Record<string, LegCell | EmailCell | unknown>;

export interface RowState {
  rowKey: string;
  input: Record<string, string>;
  cells: Cells;
  /** Working memory during a run; not persisted. */
  candidates: EmailCandidate[];
}

// ---- Runs --------------------------------------------------------------------

export type RunStatus = 'running' | 'done' | 'failed' | 'aborted';

export interface Run {
  id: string;
  play: string;
  datasetId?: string;
  status: RunStatus;
  inputSummary: Record<string, unknown>;
  rowsIn: number;
  rowsOut: number;
  totalCostCredits: number;
  totalCostUsd: number;
  receipt?: unknown;
  startedAt: string;
  finishedAt?: string;
  notes?: string;
}
