const STORAGE_KEY = 'archeoqa-compare-prefill';

export interface ComparePrefill {
  question: string;
  paper_filter: string[];
}

export function saveComparePrefill(prefill: ComparePrefill) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
}

export function consumeComparePrefill(): ComparePrefill | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as ComparePrefill;
    if (!parsed.question || !Array.isArray(parsed.paper_filter)) return null;
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
