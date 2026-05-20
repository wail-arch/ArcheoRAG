import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clipboard,
  CheckCircle2,
  Filter,
  GitCompare,
  Search,
  TableProperties,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  findSimilarPapers,
  getPaperManifest,
  type PaperManifestRow,
  type SimilarityResponse,
  type SimilarityResult,
} from '../hooks/useApi';
import { getErrorMessage } from '../utils/errors';

const SHARED_LABELS: Record<string, string> = {
  sites: 'Sites',
  title_site_matches: 'Site dans le titre',
  regions: 'Régions',
  periods: 'Périodes',
  method_tags: 'Méthodes',
  evidence_types: 'Types de preuve',
  date_ranges: 'Dates',
  main_claims: 'Claims',
  paper_kind: 'Type',
  metadata: 'Métadonnées fallback',
};

function rowText(row: PaperManifestRow): string {
  return [
    row.label,
    row.title,
    row.citation,
    row.docname,
    row.filename,
    row.year,
    row.source,
    ...row.aliases,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function confidenceClass(confidence: SimilarityResult['confidence']): string {
  if (confidence === 'high') {
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
  }
  if (confidence === 'medium') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }
  return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
}

function sourceLabel(source: SimilarityResult['source'] | PaperManifestRow['source']): string {
  return source === 'matrix_derived' ? 'Matrix' : 'Indexed only';
}

function resultSubtitle(item: SimilarityResult): string {
  const title = item.paper.title?.trim();
  if (title && title !== item.paper.label) return title;
  if (item.paper.filename && item.paper.filename !== item.paper.label) return item.paper.filename;
  if (item.paper.docname && item.paper.docname !== item.paper.label) return item.paper.docname;
  return '';
}

export default function SimilarityPage() {
  const [manifestRows, setManifestRows] = useState<PaperManifestRow[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [query, setQuery] = useState('');
  const [includeIndexedOnly, setIncludeIndexedOnly] = useState(true);
  const [result, setResult] = useState<SimilarityResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPaperManifest();
      setManifestRows(response.rows);
      setSelectedFile((prev) => prev || response.rows[0]?.file_location || '');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Chargement du manifest échoué'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadManifest);
  }, [loadManifest]);

  const selectedRow = useMemo(
    () => manifestRows.find((row) => row.file_location === selectedFile) ?? null,
    [manifestRows, selectedFile]
  );

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return manifestRows;
    return manifestRows.filter((row) => rowText(row).includes(normalized));
  }, [manifestRows, query]);

  const runSimilarity = useCallback(async () => {
    if (!selectedFile) return;
    setSearching(true);
    setError(null);
    setExpanded(null);
    try {
      setResult(
        await findSimilarPapers(selectedFile, {
          limit: 12,
          include_indexed_only: includeIndexedOnly,
        })
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Recherche de similarité échouée'));
    }
    setSearching(false);
  }, [includeIndexedOnly, selectedFile]);

  useEffect(() => {
    if (!selectedFile) return;
    void Promise.resolve().then(runSimilarity);
  }, [runSimilarity, selectedFile]);

  const matrixRows = manifestRows.filter((row) => row.source === 'matrix_derived').length;
  const indexedOnlyRows = manifestRows.length - matrixRows;

  const copyResults = async () => {
    if (!result) return;
    const text = formatSimilarityExport(result);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-5 pb-12">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Similarités</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Classement déterministe des papiers proches à partir de la Matrix et du manifest
            </p>
          </div>
          <Link
            to="/matrix"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400"
          >
            <TableProperties className="w-4 h-4" />
            Ouvrir la Matrix
          </Link>
        </div>

        {(indexedOnlyRows > 0 || result?.warnings.length) && (
          <Notice
            text={
              result?.warnings[0] ||
              'Résultats limités: construisez la Matrix ou une sélection de papiers pour améliorer la similarité.'
            }
          />
        )}

        {error && (
          <div className="px-4 py-3 rounded-lg text-sm border bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher un papier..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none focus:border-amber-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={includeIndexedOnly}
                  onChange={(event) => setIncludeIndexedOnly(event.target.checked)}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                Inclure papiers sans Matrix
              </label>
              <div className="flex gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  {matrixRows} Matrix
                </span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {indexedOnlyRows} indexed only
                </span>
              </div>
            </div>

            <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <p className="p-4 text-sm text-gray-400">Chargement...</p>
              ) : filteredRows.length === 0 ? (
                <p className="p-4 text-sm text-gray-400">Aucun papier trouvé.</p>
              ) : (
                filteredRows.map((row) => (
                  <button
                    key={row.file_location}
                    onClick={() => setSelectedFile(row.file_location)}
                    className={`w-full text-left p-4 transition-colors ${
                      selectedFile === row.file_location
                        ? 'bg-amber-50 dark:bg-amber-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <p className="font-medium text-sm text-gray-800 dark:text-gray-100 line-clamp-2">
                      {row.label}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      {row.year && <span>{row.year}</span>}
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">
                        {sourceLabel(row.source)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-gray-400 mb-1">Papier source</p>
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                    {selectedRow?.label || 'Aucun papier sélectionné'}
                  </h2>
                  {selectedRow && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {selectedRow.year || 'année inconnue'} · {sourceLabel(selectedRow.source)}
                    </p>
                  )}
                </div>
                <button
                  onClick={runSimilarity}
                  disabled={!selectedFile || searching}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <GitCompare className="w-4 h-4" />
                  {searching ? 'Calcul...' : 'Recalculer'}
                </button>
                <button
                  onClick={copyResults}
                  disabled={!result || result.results.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
                  {copied ? 'Copié' : 'Copier résultats'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {!result ? (
                <p className="text-sm text-gray-400">Sélectionnez un papier pour voir les similarités.</p>
              ) : result.results.length === 0 ? (
                <p className="text-sm text-gray-400">Aucun papier comparable trouvé.</p>
              ) : (
                result.results.map((item) => (
                  <SimilarityCard
                    key={item.paper.file_location}
                    item={item}
                    expanded={expanded === item.paper.file_location}
                    onToggle={() =>
                      setExpanded((prev) =>
                        prev === item.paper.file_location ? null : item.paper.file_location
                      )
                    }
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatSimilarityExport(result: SimilarityResponse): string {
  const lines = [
    `# Similarity Finder V1`,
    ``,
    `Source: ${result.source_paper.label}`,
    `File: ${result.source_paper.file_location}`,
    `Strategy: ${result.metadata.strategy}`,
    `Matrix rows: ${result.metadata.matrix_rows}`,
    `Indexed-only rows: ${result.metadata.indexed_only_rows}`,
    `Include indexed-only: ${result.metadata.include_indexed_only}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(' | ')}`);
  }
  lines.push(``, `## Results`);

  result.results.forEach((item, index) => {
    lines.push(
      ``,
      `${index + 1}. ${item.paper.label}`,
      `Score: ${item.score}`,
      `Confidence: ${item.confidence}`,
      `Source: ${sourceLabel(item.source)}`,
      ...(resultSubtitle(item) ? [`Detail: ${resultSubtitle(item)}`] : []),
      `Rationale: ${item.rationale}`
    );
    const sharedEntries = Object.entries(item.shared).filter(([, values]) => values.length > 0);
    if (sharedEntries.length === 0) {
      lines.push(`Shared: none`);
    } else {
      lines.push(`Shared:`);
      sharedEntries.forEach(([field, values]) => {
        lines.push(`- ${SHARED_LABELS[field] || field}: ${values.join(', ')}`);
      });
    }
    if (item.missing.source.length > 0 || item.missing.target.length > 0) {
      lines.push(
        `Missing source: ${item.missing.source.join(', ') || 'none'}`,
        `Missing target: ${item.missing.target.join(', ') || 'none'}`
      );
    }
  });

  return lines.join('\n');
}

function SimilarityCard({
  item,
  expanded,
  onToggle,
}: {
  item: SimilarityResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sharedEntries = Object.entries(item.shared).filter(([, values]) => values.length > 0);
  const subtitle = resultSubtitle(item);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
      <button onClick={onToggle} className="w-full p-4 text-left">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 line-clamp-2">
              {item.paper.label}
            </h3>
            {subtitle && (
              <p className="text-xs text-gray-400 mt-1 line-clamp-1">{subtitle}</p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.rationale}</p>
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
              {item.paper.year && <span className="text-gray-400">{item.paper.year}</span>}
              <Badge>{sourceLabel(item.source)}</Badge>
              {item.needs_review && <Badge>à vérifier</Badge>}
              <span className={`px-2 py-0.5 rounded ${confidenceClass(item.confidence)}`}>
                {item.confidence}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {item.score}
              </p>
              <p className="text-xs text-gray-400">score</p>
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800">
          {sharedEntries.length === 0 ? (
            <p className="pt-4 text-sm text-gray-400">Aucun champ structuré commun.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-4">
              {sharedEntries.map(([field, values]) => (
                <div key={field} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Filter className="w-4 h-4 text-amber-500" />
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      {SHARED_LABELS[field] || field}
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {values.map((value) => (
                      <span
                        key={value}
                        className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300"
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(item.missing.source.length > 0 || item.missing.target.length > 0) && (
            <div className="mt-3 text-xs text-gray-400 flex flex-col gap-1">
              {item.missing.source.length > 0 && (
                <span>Manquant source: {item.missing.source.join(', ')}</span>
              )}
              {item.missing.target.length > 0 && (
                <span>Manquant cible: {item.missing.target.join(', ')}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm border bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{text}</span>
      <ArrowRight className="w-4 h-4 mt-0.5 shrink-0 ml-auto" />
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">
      {children}
    </span>
  );
}
