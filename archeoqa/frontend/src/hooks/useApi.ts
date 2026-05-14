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
  matrix: MatrixResponse;
}

export function getMatrixStatus(): Promise<MatrixStatus> {
  return apiFetch('/analysis/matrix/status');
}

export function getEvidenceMatrix(): Promise<MatrixResponse> {
  return apiFetch('/analysis/matrix');
}

export function buildEvidenceMatrix(force = false): Promise<MatrixBuildResponse> {
  return apiFetch('/analysis/matrix/build', {
    method: 'POST',
    body: JSON.stringify({ force }),
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
