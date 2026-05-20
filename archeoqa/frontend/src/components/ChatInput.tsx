import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { Send, Bot, Filter, X, GitCompareArrows } from 'lucide-react';
import { getIndexedPapers, type IndexedPaper } from '../hooks/useApi';
import { consumeComparePrefill } from '../utils/comparePrefill';

interface ChatInputProps {
  onSubmit: (question: string, useAgent: boolean, paperFilter?: string[]) => void;
  isLoading: boolean;
}

export default function ChatInput({ onSubmit, isLoading }: ChatInputProps) {
  const [initialPrefill] = useState(() => consumeComparePrefill());
  const [question, setQuestion] = useState(initialPrefill?.question ?? '');
  const [useAgent, setUseAgent] = useState(false);
  const [papers, setPapers] = useState<IndexedPaper[]>([]);
  const [selectedPapers, setSelectedPapers] = useState<string[]>(
    initialPrefill?.paper_filter ?? []
  );
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const comparisonQuestion =
    'Compare uniquement les papiers sélectionnés : quelles hypothèses proposent-ils, quelles preuves utilisent-ils, quelles méthodes/données mobilisent-ils, quelles périodes/datations discutent-ils, quelles limites présentent-ils, et où divergent-ils ?';

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

  const handleCompareSelected = () => {
    if (isLoading || selectedPapers.length < 2 || selectedPapers.length > 5) return;
    const customQuestion = question.trim();
    const q = customQuestion
      ? customQuestion.toLowerCase().startsWith('compare uniquement les papiers sélectionnés')
        ? customQuestion
        : `Compare uniquement les papiers sélectionnés sur cette question : ${customQuestion}`
      : comparisonQuestion;
    onSubmit(q, useAgent, selectedPapers);
    if (customQuestion) setQuestion('');
  };

  const togglePaper = (fileLocation: string) => {
    setSelectedPapers((prev) =>
      prev.includes(fileLocation) ? prev.filter((d) => d !== fileLocation) : [...prev, fileLocation]
    );
  };

  const formatDocname = (docname?: string, filename?: string, title?: string | null, year?: number | null, maxLength = 56): string => {
    if (title) {
      return `${title.slice(0, maxLength)}${title.length > maxLength ? '…' : ''}${year ? ` (${year})` : ''}`;
    }
    if (filename) return filename.length > maxLength ? filename.slice(0, maxLength) + '…' : filename;
    if (!docname) return '';
    const m = docname.match(/^([a-z]+)(\d{4})/i);
    if (m) return `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} ${m[2]}`;
    return docname.length > maxLength ? docname.slice(0, maxLength) + '…' : docname;
  };

  const paperLabel = (fileLocation: string): string => {
    const paper = papers.find((p) => p.file_location === fileLocation);
    return paper ? formatDocname(paper.docname, paper.filename, paper.title, paper.year) : fileLocation;
  };

  const sortedPapers = useMemo(
    () =>
      [...papers].sort((a, b) =>
        formatDocname(a.docname, a.filename, a.title, a.year, 120).localeCompare(
          formatDocname(b.docname, b.filename, b.title, b.year, 120),
          'fr',
          { sensitivity: 'base' }
        )
      ),
    [papers]
  );

  const fullPaperLabel = (paper: IndexedPaper): string => {
    const title = paper.title || paper.filename || paper.docname;
    return `${title}${paper.year ? ` (${paper.year})` : ''}`;
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
              {paperLabel(docname)}
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

      {selectedPapers.length >= 2 && (
        <div className="flex items-center justify-end gap-2 mb-2 max-w-4xl mx-auto">
          {selectedPapers.length > 5 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Sélectionnez 5 papiers maximum pour une comparaison lisible.
            </span>
          )}
          <button
            type="button"
            onClick={handleCompareSelected}
            disabled={isLoading || selectedPapers.length > 5}
            title={question.trim() ? 'Comparer les papiers sélectionnés selon cette question' : 'Comparer les papiers sélectionnés'}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <GitCompareArrows className="w-4 h-4" />
            Comparer
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
              <div className="absolute bottom-full left-0 mb-2 w-[min(720px,calc(100vw-2rem))] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50">
                <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase px-2">
                    Filtrer par papier
                  </p>
                </div>
                <div className="max-h-[55vh] overflow-y-auto py-1">
                  {sortedPapers.map((paper) => (
                    <button
                      key={paper.dockey}
                      type="button"
                      title={fullPaperLabel(paper)}
                      onClick={() => togglePaper(paper.file_location)}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-start gap-3 ${
                        selectedPapers.includes(paper.file_location)
                          ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 mt-0.5 rounded border flex-shrink-0 ${
                        selectedPapers.includes(paper.file_location)
                          ? 'bg-amber-500 border-amber-500'
                          : 'border-gray-300 dark:border-gray-600'
                      }`} />
                      <span className="min-w-0">
                        <span className="block leading-snug line-clamp-2">
                          {formatDocname(paper.docname, paper.filename, paper.title, paper.year)}
                        </span>
                        {paper.filename && paper.title && (
                          <span className="block mt-1 text-xs text-gray-400 line-clamp-1">
                            {paper.filename}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
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
        {selectedPapers.length >= 2 && selectedPapers.length <= 5 && (
          <span className="hidden sm:inline text-gray-400 dark:text-gray-500">
            Écrivez un angle puis cliquez Comparer, ou laissez vide pour une comparaison générale.
          </span>
        )}
        {selectedPapers.length > 0 && (
          <span className="ml-auto text-amber-600 dark:text-amber-400">
            {selectedPapers.length} papier{selectedPapers.length > 1 ? 's' : ''} sélectionné{selectedPapers.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </form>
  );
}
