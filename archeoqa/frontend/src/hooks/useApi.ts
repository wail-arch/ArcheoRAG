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

export function askQuestion(question: string, useAgent = false): Promise<AskResponse> {
  return apiFetch('/ask', {
    method: 'POST',
    body: JSON.stringify({ question, use_agent: useAgent }),
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
  dockey: string;
  docname: string;
  citation: string;
}

export function listPapers(): Promise<PaperInfo[]> {
  return apiFetch('/papers');
}

export function indexPapers(): Promise<{ indexed: string[]; total_papers: number; total_chunks: number }> {
  return apiFetch('/papers/index', { method: 'POST' });
}

export function getIndexedPapers(): Promise<IndexedPaper[]> {
  return apiFetch('/papers/indexed');
}

export function getPaperStats(): Promise<{
  num_papers: number;
  num_chunks: number;
  index_built: boolean;
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
