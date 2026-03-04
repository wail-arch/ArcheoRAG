import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Send, Bot, Filter, X } from 'lucide-react';
import { getIndexedPapers, type IndexedPaper } from '../hooks/useApi';

interface ChatInputProps {
  onSubmit: (question: string, useAgent: boolean, paperFilter?: string[]) => void;
  isLoading: boolean;
}

export default function ChatInput({ onSubmit, isLoading }: ChatInputProps) {
  const [question, setQuestion] = useState('');
  const [useAgent, setUseAgent] = useState(false);
  const [papers, setPapers] = useState<IndexedPaper[]>([]);
  const [selectedPapers, setSelectedPapers] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getIndexedPapers().then(setPapers).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || isLoading) return;
    onSubmit(q, useAgent, selectedPapers.length > 0 ? selectedPapers : undefined);
    setQuestion('');
  };

  const togglePaper = (docname: string) => {
    setSelectedPapers((prev) =>
      prev.includes(docname) ? prev.filter((d) => d !== docname) : [...prev, docname]
    );
  };

  const formatDocname = (docname: string): string => {
    const m = docname.match(/^([a-z]+)(\d{4})/i);
    if (m) return `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} ${m[2]}`;
    return docname.length > 30 ? docname.slice(0, 30) + '…' : docname;
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      {/* Selected papers chips */}
      {selectedPapers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 max-w-4xl mx-auto">
          {selectedPapers.map((docname) => (
            <span
              key={docname}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs rounded-full"
            >
              {formatDocname(docname)}
              <button
                type="button"
                onClick={() => togglePaper(docname)}
                className="hover:text-amber-900 dark:hover:text-amber-200"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setSelectedPapers([])}
            className="text-xs text-gray-400 hover:text-red-500 px-1"
          >
            Tout effacer
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 max-w-4xl mx-auto">
        {/* Paper filter button */}
        {papers.length > 0 && (
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setShowFilter(!showFilter)}
              className={`p-3 rounded-xl border transition-colors ${
                selectedPapers.length > 0
                  ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-400 text-amber-700 dark:text-amber-400'
                  : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              title={selectedPapers.length > 0 ? `${selectedPapers.length} papiers sélectionnés` : 'Filtrer par papier'}
            >
              <Filter className="w-5 h-5" />
              {selectedPapers.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {selectedPapers.length}
                </span>
              )}
            </button>

            {showFilter && (
              <div className="absolute bottom-full left-0 mb-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-64 overflow-y-auto z-50">
                <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase px-2">
                    Filtrer par papier
                  </p>
                </div>
                {papers.map((paper) => (
                  <button
                    key={paper.dockey}
                    type="button"
                    onClick={() => togglePaper(paper.docname)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 ${
                      selectedPapers.includes(paper.docname)
                        ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded border flex-shrink-0 ${
                      selectedPapers.includes(paper.docname)
                        ? 'bg-amber-500 border-amber-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`} />
                    <span className="truncate">{formatDocname(paper.docname)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 relative">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Posez votre question sur vos articles..."
            className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-300 dark:border-gray-600 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-800 outline-none transition-all text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 bg-white dark:bg-gray-800"
            disabled={isLoading}
          />
        </div>

        {/* Agent toggle */}
        <button
          type="button"
          onClick={() => setUseAgent(!useAgent)}
          className={`p-3 rounded-xl border transition-colors ${
            useAgent
              ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-400 text-amber-700 dark:text-amber-400'
              : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
          title={useAgent ? 'Mode Agent (recherche approfondie)' : 'Mode Direct (rapide)'}
        >
          <Bot className="w-5 h-5" />
        </button>

        {/* Submit */}
        <button
          type="submit"
          disabled={!question.trim() || isLoading}
          className="p-3 rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 mt-2 max-w-4xl mx-auto text-xs text-gray-500 dark:text-gray-400">
        <span>{useAgent ? '🤖 Mode Agent (plus lent, plus précis)' : '⚡ Mode Direct (rapide)'}</span>
        {selectedPapers.length > 0 && (
          <span className="ml-auto text-amber-600 dark:text-amber-400">
            {selectedPapers.length} papier{selectedPapers.length > 1 ? 's' : ''} sélectionné{selectedPapers.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </form>
  );
}
