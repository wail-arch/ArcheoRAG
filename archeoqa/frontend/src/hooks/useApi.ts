/**
 * API hook — wrapper around fetch for backend calls.
 */

const API_BASE = '/api';

export interface ApiError {
  status: number;
  message: string;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });
  } catch {
    throw {
      status: 0,
      message: 'Impossible de contacter le backend. Vérifiez que le serveur est lancé (uvicorn backend.app:app --port 8000).',
    } as ApiError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw { status: res.status, message: body.detail || res.statusText } as ApiError;
  }

  return res.json();
}

// Q&A
export interface AskResponse {
  answer: string;
  question: string;
  contexts: ContextItem[];
  cost: number;
  session_id: string;
  targeting?: TargetingInfo;
}

export interface TargetingPaper {
  file_location: string;
  filename: string;
  dockey: string;
  docname: string;
  citation: string;
  title?: string | null;
  year?: number | null;
  label?: string;
}

export interface TargetingInfo {
  mode: 'manual_filter' | 'auto_resolved' | 'needs_clarification' | 'global';
  resolved_papers?: TargetingPaper[];
  unresolved_mentions?: string[];
  candidates?: Record<string, TargetingPaper[]>;
  answer_mode?: 'targeted_comparison' | 'targeted_comparison_balanced' | 'standard';
  comparison_strategy?: string;
  matrix_assisted?: boolean;
  matrix_assistance_strategy?: string | null;
  matrix_rows_used?: Array<{ label: string; file_location: string; source: string; paper_kind?: string; method_tags?: string[] }>;
  matrix_missing_papers?: Array<{ label: string; file_location: string; reason: string }>;
  per_paper_context_counts?: Record<string, number>;
  partial_papers?: Array<{ label: string; file_location: string; reason: string; context_count?: number }>;
  context_quality_filter?: string;
  dropped_low_quality_contexts?: Array<{ docname: string; name: string; score?: number; quality_penalty: number; reason: string }>;
  cleaned_internal_ids?: boolean;
  warnings?: string[];
  out_of_scope_contexts?: Array<{ docname: string; name: string }>;
}

export interface ContextItem {
  id: string;
  context: string;
  score: number;
  text: {
    name: string;
    text: string;
    doc: {
      docname: string;
      citation: string;
    };
  };
}

export function askQuestion(question: string, useAgent = false, paperFilter?: string[]): Promise<AskResponse> {
  return apiFetch('/ask', {
    method: 'POST',
    body: JSON.stringify({ question, use_agent: useAgent, paper_filter: paperFilter || null }),
  });
}

// Papers
export interface PaperInfo {
  filename: string;
  path: string;
  size_bytes: number;
  size_mb: number;
  modified: number;
}

export interface IndexedPaper {
  file_location: string;
  filename: string;
  dockey: string;
  docname: string;
  citation: string;
  title?: string | null;
  year?: number | null;
}

export function listPapers(): Promise<PaperInfo[]> {
  return apiFetch('/papers');
}

export function indexPapers(): Promise<{ indexed: string[]; total_papers: number; total_chunks: number }> {
  return apiFetch('/papers/index', { method: 'POST' });
}

export function rebuildIndex(): Promise<{ indexed: string[]; total_papers: number; total_chunks: number }> {
  return apiFetch('/papers/rebuild', { method: 'POST' });
}

export function getIndexedPapers(): Promise<IndexedPaper[]> {
  return apiFetch('/papers/indexed');
}

export function getPaperStats(): Promise<{
  num_papers: number;
  num_chunks: number;
  index_built: boolean;
  index_ready: boolean;
  rebuild_required: boolean;
  indexed_files: string[];
  failed_files: string[];
  index_config_hash: string;
  papers_dir: string;
}> {
  return apiFetch('/papers/stats');
}

export async function uploadPaper(file: File): Promise<{ message: string; path: string; size_mb: number }> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/papers/upload`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw {
      status: 0,
      message: 'Impossible de contacter le backend. Vérifiez que le serveur est lancé.',
    } as ApiError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw { status: res.status, message: body.detail || res.statusText } as ApiError;
  }

  return res.json();
}

export function deletePaper(filename: string): Promise<{ message: string }> {
  return apiFetch(`/papers/${encodeURIComponent(filename)}`, { method: 'DELETE' });
}

// Evidence Matrix
export interface MatrixFieldItem {
  value: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_ids: string[];
  source?: 'generated' | 'curated';
}

export interface MatrixContext {
  id: string;
  context: string;
  score: number;
  text: {
    name: string;
    text: string;
    doc: {
      docname: string;
      citation: string;
    };
  };
}

export interface MatrixFieldQuality {
  item_count: number;
  confidence_counts: Record<'high' | 'medium' | 'low', number>;
  supporting_context_count: number;
  missing: boolean;
  verified: boolean;
}

export interface MatrixQuality {
  confidence_counts: Record<'high' | 'medium' | 'low', number>;
  field_quality: Record<string, MatrixFieldQuality>;
  supporting_context_count: number;
  missing_key_categories: string[];
  missing_groups: string[];
  dropped_unsupported_count: number;
  needs_review: boolean;
}

export interface MatrixCuration {
  notes: string;
  row_verified: boolean;
  verified_fields: string[];
  curated_fields: Record<string, MatrixFieldItem[]>;
  updated_at: string | null;
}

export interface MatrixDroppedItem {
  field: string;
  value: string;
  reason: string;
  evidence_ids: string[];
}

export interface MatrixRow {
  paper: IndexedPaper;
  fields: Record<string, MatrixFieldItem[]>;
  generated_fields: Record<string, MatrixFieldItem[]>;
  contexts: MatrixContext[];
  status: 'complete' | 'partial' | 'failed' | 'needs_review' | 'verified';
  quality: MatrixQuality;
  curation: MatrixCuration;
  dropped_items: MatrixDroppedItem[];
  error?: string;
  build_mode?: 'standard' | 'cheap';
  updated_at: string;
  index_config_hash: string;
}

export interface MatrixStatus {
  exists: boolean;
  available: boolean;
  stale: boolean;
  paper_count: number;
  row_count: number;
  last_build_at: string | null;
  index_config_hash: string;
  failed_papers: string[];
}

export interface MatrixResponse {
  metadata: Record<string, unknown>;
  rows: MatrixRow[];
  status: MatrixStatus;
}

export interface MatrixBuildResponse {
  analyzed: number;
  skipped: number;
  failed: number;
  total: number;
  mode?: 'standard' | 'cheap';
  selected?: boolean;
  matrix: MatrixResponse;
}

export interface PaperManifestRow {
  file_location: string;
  filename: string;
  docname: string;
  title?: string | null;
  year?: number | null;
  citation: string;
  label: string;
  aliases: string[];
  paper_kind: 'primary_study' | 'review' | 'preprint' | 'unknown';
  method_tags: string[];
  regions: string[];
  sites: string[];
  periods: string[];
  date_ranges: string[];
  evidence_types: string[];
  main_claims: string[];
  limitations: string[];
  uncertainties: string[];
  matrix_status: MatrixRow['status'] | null;
  row_verified: boolean;
  needs_review: boolean;
  source: 'indexed_only' | 'matrix_derived';
}

export interface PaperManifestStatus {
  exists: boolean;
  available: boolean;
  stale: boolean;
  paper_count: number;
  row_count: number;
  last_build_at: string | null;
  index_config_hash: string;
  path: string;
}

export interface PaperManifestResponse {
  metadata: Record<string, unknown>;
  rows: PaperManifestRow[];
  status: PaperManifestStatus;
}

export interface SimilarityPaper {
  file_location: string;
  filename: string;
  docname: string;
  title?: string | null;
  year?: number | null;
  citation: string;
  label: string;
}

export interface SimilarityResult {
  paper: SimilarityPaper;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  shared: Record<string, string[]>;
  missing: {
    source: string[];
    target: string[];
  };
  source: 'indexed_only' | 'matrix_derived';
  matrix_status: MatrixRow['status'] | null;
  needs_review: boolean;
  rationale: string;
}

export interface SimilarityResponse {
  source_paper: SimilarityPaper;
  results: SimilarityResult[];
  metadata: {
    strategy: string;
    limit: number;
    include_indexed_only: boolean;
    matrix_rows: number;
    indexed_only_rows: number;
    total_candidates: number;
  };
  warnings: string[];
}

export interface DifferencePaper extends SimilarityPaper {
  source: 'indexed_only' | 'matrix_derived';
  matrix_status: MatrixRow['status'] | null;
  row_verified: boolean;
  needs_review: boolean;
}

export interface DifferenceByPaper {
  paper: DifferencePaper;
  fields: Record<string, string[]>;
  note: string;
}

export interface MissingByPaper {
  paper: DifferencePaper;
  fields: string[];
}

export interface DifferenceResponse {
  papers: DifferencePaper[];
  excluded_papers: DifferencePaper[];
  shared: Record<string, string[]>;
  shared_central?: Record<string, string[]>;
  shared_contextual?: Record<string, string[]>;
  differences: DifferenceByPaper[];
  missing: MissingByPaper[];
  quality: {
    strategy: string;
    paper_count: number;
    matrix_rows: number;
    indexed_only_rows: number;
    needs_review_rows: number;
    strong_fields: string[];
    weak_fields: string[];
    confidence: 'high' | 'medium' | 'low';
  };
  suggested_compare_question: string;
  warnings: string[];
}

export type GapPaper = DifferencePaper;

export interface GapByPaper {
  paper: GapPaper;
  missing_fields: string[];
  weak_fields: string[];
  reasons: string[];
  severity: 'high' | 'medium' | 'low' | 'none';
  recommended_actions: string[];
}

export interface GapByField {
  field: string;
  label: string;
  present_count: number;
  missing_count: number;
  weak_count: number;
  coverage_ratio: number;
  missing_papers: GapPaper[];
  weak_papers: GapPaper[];
}

export interface GapAction {
  type: string;
  label: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  file_locations: string[];
}

export interface GapResponse {
  scope: 'selection' | 'corpus';
  papers: GapPaper[];
  excluded_papers: GapPaper[];
  summary: {
    strategy: string;
    paper_count: number;
    total_manifest_rows: number;
    matrix_rows: number;
    indexed_only_rows: number;
    needs_review_rows: number;
    verified_rows: number;
    gap_paper_count: number;
    review_only_count?: number;
    completion_gap_count?: number;
  };
  paper_gaps: GapByPaper[];
  review_gaps?: GapByPaper[];
  completion_gaps?: GapByPaper[];
  field_gaps: GapByField[];
  actions: GapAction[];
  warnings: string[];
}

export function getMatrixStatus(): Promise<MatrixStatus> {
  return apiFetch('/analysis/matrix/status');
}

export function getEvidenceMatrix(): Promise<MatrixResponse> {
  return apiFetch('/analysis/matrix');
}

export interface MatrixBuildOptions {
  force?: boolean;
  mode?: 'standard' | 'cheap';
  file_locations?: string[];
}

export function buildEvidenceMatrix(
  forceOrOptions: boolean | MatrixBuildOptions = false
): Promise<MatrixBuildResponse> {
  const body =
    typeof forceOrOptions === 'boolean'
      ? { force: forceOrOptions }
      : {
          force: forceOrOptions.force ?? false,
          mode: forceOrOptions.mode ?? 'standard',
          file_locations: forceOrOptions.file_locations,
        };
  return apiFetch('/analysis/matrix/build', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resetEvidenceMatrix(clearOverrides = true): Promise<MatrixResponse> {
  return apiFetch('/analysis/matrix/reset', {
    method: 'POST',
    body: JSON.stringify({ clear_overrides: clearOverrides }),
  });
}

export function updateMatrixRowCuration(
  fileLocation: string,
  update: {
    curated_fields?: Record<string, MatrixFieldItem[]>;
    clear_curated_fields?: string[];
    notes?: string;
    row_verified?: boolean;
    verified_fields?: string[];
  }
): Promise<MatrixRow> {
  return apiFetch(`/analysis/matrix/rows/${encodeURIComponent(fileLocation)}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

export function verifyMatrixRow(
  fileLocation: string,
  verified = true,
  field?: string
): Promise<MatrixRow> {
  return apiFetch(`/analysis/matrix/rows/${encodeURIComponent(fileLocation)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ verified, field }),
  });
}

export function getPaperManifest(): Promise<PaperManifestResponse> {
  return apiFetch('/analysis/manifest');
}

export function buildPaperManifest(): Promise<PaperManifestResponse> {
  return apiFetch('/analysis/manifest/build', { method: 'POST' });
}

export function findSimilarPapers(
  fileLocation: string,
  options: { limit?: number; include_indexed_only?: boolean } = {}
): Promise<SimilarityResponse> {
  return apiFetch('/analysis/similarity', {
    method: 'POST',
    body: JSON.stringify({
      file_location: fileLocation,
      limit: options.limit ?? 10,
      include_indexed_only: options.include_indexed_only ?? true,
    }),
  });
}

export function comparePaperDifferences(
  fileLocations: string[],
  options: { include_indexed_only?: boolean } = {}
): Promise<DifferenceResponse> {
  return apiFetch('/analysis/difference', {
    method: 'POST',
    body: JSON.stringify({
      file_locations: fileLocations,
      include_indexed_only: options.include_indexed_only ?? true,
    }),
  });
}

export function findMatrixGaps(
  options: {
    file_locations?: string[];
    include_indexed_only?: boolean;
    scope?: 'selection' | 'corpus';
  } = {}
): Promise<GapResponse> {
  return apiFetch('/analysis/gaps', {
    method: 'POST',
    body: JSON.stringify({
      file_locations: options.file_locations,
      include_indexed_only: options.include_indexed_only ?? true,
      scope: options.scope,
    }),
  });
}

// Settings
export interface AppSettings {
  llm: string;
  summary_llm: string;
  embedding: string;
  enrichment_llm: string;
  agent_llm: string;
  papers_dir: string;
  temperature: number;
  evidence_k: number;
  answer_max_sources: number;
  multimodal: string;
  has_openai_key: boolean;
  has_google_key: boolean;
  has_perplexity_key: boolean;
}

export function getSettings(): Promise<AppSettings> {
  return apiFetch('/settings');
}

export function updateSettings(update: Record<string, unknown>): Promise<AppSettings> {
  return apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify(update),
  });
}
