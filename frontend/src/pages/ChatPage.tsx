import { useState, useEffect, useCallback } from 'react';
import { Landmark, MessageSquare, Trash2 } from 'lucide-react';
import ChatInput from '../components/ChatInput';
import AnswerCard from '../components/AnswerCard';
import StatusBar from '../components/StatusBar';
import { useQAWebSocket } from '../hooks/useWebSocket';
import { askQuestion, type AskResponse } from '../hooks/useApi';

const STORAGE_KEY = 'archeoqa-chat-history';
const MAX_ENTRIES = 50;

export interface ChatEntry {
  id: string;
  data: AskResponse;
}

function loadHistory(): ChatEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatEntry[];
    return parsed.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function saveHistory(entries: ChatEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch { /* localStorage full — ignore */ }
}

export function getTotalCost(): number {
  const entries = loadHistory();
  return entries.reduce((sum, e) => sum + (e.data.cost ?? 0), 0);
}

export default function ChatPage() {
  const [history, setHistory] = useState<ChatEntry[]>(loadHistory);
  const { status, result, error, ask: wsAsk, isLoading } = useQAWebSocket();
  const [fallbackLoading, setFallbackLoading] = useState(false);

  // Persist whenever history changes
  useEffect(() => {
    saveHistory(history);
    window.dispatchEvent(new Event('archeoqa-cost-update'));
  }, [history]);

  const handleSubmit = async (question: string, useAgent: boolean, paperFilter?: string[]) => {
    try {
      wsAsk(question, useAgent, paperFilter);
    } catch {
      setFallbackLoading(true);
      try {
        const res = await askQuestion(question, useAgent);
        setHistory((prev) => [...prev, { id: crypto.randomUUID(), data: res }]);
      } catch (err: any) {
        console.error('Ask failed:', err);
      }
      setFallbackLoading(false);
    }
  };

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Add result to history when WebSocket completes
  if (result && (history.length === 0 || history[history.length - 1].data.session_id !== result.session_id)) {
    setHistory((prev) => [...prev, { id: crypto.randomUUID(), data: result }]);
  }

  const loading = isLoading || fallbackLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-6">
        {history.length === 0 && !loading ? (
          <EmptyState onSuggest={(q) => handleSubmit(q, false)} />
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Clear history button */}
            {history.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Effacer l'historique"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Effacer
                </button>
              </div>
            )}

            {history.map((entry) => (
              <AnswerCard key={entry.id} data={entry.data} />
            ))}

            {loading && (
              <StatusBar status={status} />
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput onSubmit={handleSubmit} isLoading={loading} />
    </div>
  );
}

function EmptyState({ onSuggest }: { onSuggest: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <Landmark className="w-16 h-16 text-amber-400 mb-4" />
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">ArcheoQA</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-md">
        Interrogez votre bibliothèque d'articles scientifiques en archéologie.
        Les réponses sont sourcées avec des citations précises.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
        {[
          'Quelles méthodes de datation sont utilisées au Maghreb ?',
          'Quels sont les sites néolithiques les plus étudiés ?',
          'Quelles contradictions existent sur la chronologie du Bronze ancien ?',
          'Résume les approches stratigraphiques récentes',
        ].map((q) => (
          <button
            key={q}
            onClick={() => onSuggest(q)}
            className="text-left px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
          >
            <MessageSquare className="w-4 h-4 text-amber-500 mb-1" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
