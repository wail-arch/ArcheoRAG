import type { AskResponse } from '../hooks/useApi';

const STORAGE_KEY = 'archeoqa-chat-history';
const MAX_ENTRIES = 50;

export interface ChatEntry {
  id: string;
  data: AskResponse;
}

export function loadHistory(): ChatEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatEntry[];
    return parsed.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveHistory(entries: ChatEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // localStorage full — ignore
  }
}

export function clearSavedHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getTotalCost(): number {
  const entries = loadHistory();
  return entries.reduce((sum, e) => sum + (e.data.cost ?? 0), 0);
}
