import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  GitCompareArrows,
  Search,
  ShieldAlert,
  TableProperties,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  findCandidateContradictions,
  getPaperManifest,
  type ContradictionCandidate,
  type ContradictionResponse,
  type PaperManifestRow,
} from '../hooks/useApi';
import { saveComparePrefill } from '../utils/comparePrefill';
import { getErrorMessage } from '../utils/errors';

const FIELD_LABELS: Record<string, string> = {
  sites: 'Sites',
  regions: 'Régions',
  periods: 'Périodes',
  date_ranges: 'Dates',
  method_tags: 'Méthodes',
  evidence_types: 'Types de preuve',
  main_claims: 'Claims',
  limitations: 'Limites',
  uncertainties: 'Incertitudes',
};

const TENSION_LABELS: Record<string, string> = {
  candidate_tension: 'Tension candidate',
  dating_tension: 'Tension de datation',
  claim_tension: 'Tension de claims',
  method_inference_tension: 'Tension méthode / inférence',
  uncertainty_tension: 'Tension d’incertitudes',
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

function sourceLabel(source: PaperManifestRow['source']): string {
  return source === 'matrix_derived' ? 'Matrix' : 'Indexed only';
}

function confidenceClass(confidence: string): string {
  if (confidence === 'high') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
  if (confidence === 'medium') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
}

export default function ContradictionsPage() {
  const navigate = useNavigate();
  const [manifestRows, setManifestRows] = useState<PaperManifestRow[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'selection' | 'corpus'>('corpus');
  const [includeIndexedOnly, setIncludeIndexedOnly] = useState(false);
  const [limit, setLimit] = useState(20);
  const [result, setResult] = useState<ContradictionResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPaperManifest();
      setManifestRows(response.rows);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Chargement du manifest échoué'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadManifest);
  }, [loadManifest]);

  const rowsByFile = useMemo(
    () => new Map(manifestRows.map((row) => [row.file_location, row])),
    [manifestRows]
  );

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return manifestRows;
    return manifestRows.filter((row) => rowText(row).includes(normalized));
  }, [manifestRows, query]);

  const selectedRows = selectedFiles
    .map((fileLocation) => rowsByFile.get(fileLocation))
    .filter((row): row is PaperManifestRow => Boolean(row));

  const matrixRows = manifestRows.filter((row) => row.source === 'matrix_derived').length;
  const indexedOnlyRows = manifestRows.length - matrixRows;
  const canRun = !running && (scope === 'corpus' || selectedFiles.length >= 2);

  const togglePaper = (fileLocation: string) => {
    setSelectedFiles((prev) => {
      if (prev.includes(fileLocation)) {
        return prev.filter((item) => item !== fileLocation);
      }
      setScope('selection');
      if (prev.length >= 8) return prev;
      return [...prev, fileLocation];
    });
  };

  const runContradictions = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      const response = await findCandidateContradictions({
        file_locations: scope === 'selection' ? selectedFiles : undefined,
        include_indexed_only: includeIndexedOnly,
        scope,
        limit,
      });
      setResult(response);
      setExpandedIndex(response.candidates.length > 0 ? 0 : null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Détection des tensions échouée'));
    }
    setRunning(false);
  };

  const copyResults = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(formatContradictionExport(result));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const prepareCitedCompare = (candidate: ContradictionCandidate) => {
    saveComparePrefill({
      question: candidate.suggested_compare_question,
      paper_filter: candidate.papers.map((paper) => paper.file_location),
    });
    navigate('/');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-5 pb-12">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Contradictions</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tensions candidates Matrix-only à valider par Compare cité
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

        <Notice text="V1 signale uniquement des tensions candidates. Une contradiction scientifique doit être vérifiée avec des citations PaperQA." />

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
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                <button
                  onClick={() => setScope('corpus')}
                  className={`flex-1 px-3 py-2 ${scope === 'corpus' ? 'bg-amber-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                >
                  Corpus
                </button>
                <button
                  onClick={() => setScope('selection')}
                  className={`flex-1 px-3 py-2 ${scope === 'selection' ? 'bg-amber-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                >
                  Sélection
                </button>
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
              <label className="block text-sm text-gray-600 dark:text-gray-300">
                Limite résultats
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value) || 20)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 outline-none focus:border-amber-500"
                />
              </label>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge>{`${matrixRows} Matrix`}</Badge>
                <Badge>{`${indexedOnlyRows} indexed only`}</Badge>
                <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  {selectedFiles.length}/8 sélectionnés
                </span>
              </div>
            </div>

            <div className="max-h-[calc(100vh-370px)] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <p className="p-4 text-sm text-gray-400">Chargement...</p>
              ) : filteredRows.length === 0 ? (
                <p className="p-4 text-sm text-gray-400">Aucun papier trouvé.</p>
              ) : (
                filteredRows.map((row) => {
                  const checked = selectedFiles.includes(row.file_location);
                  return (
                    <button
                      key={row.file_location}
                      onClick={() => togglePaper(row.file_location)}
                      className={`w-full text-left p-4 transition-colors flex gap-3 ${
                        checked ? 'bg-amber-50 dark:bg-amber-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 mt-0.5 rounded border shrink-0 ${
                          checked ? 'bg-amber-500 border-amber-500' : 'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-sm text-gray-800 dark:text-gray-100 line-clamp-2">
                          {row.label}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                          {row.year && <span>{row.year}</span>}
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">
                            {sourceLabel(row.source)}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                <div>
                  <p className="text-xs uppercase text-gray-400 mb-2">
                    {scope === 'corpus' ? 'Périmètre corpus' : 'Papiers sélectionnés'}
                  </p>
                  {scope === 'corpus' ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Analyse les paires Matrix du manifest.
                    </p>
                  ) : selectedRows.length === 0 ? (
                    <p className="text-sm text-gray-400">Sélectionnez 2 à 8 papiers.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedRows.map((row) => (
                        <span
                          key={row.file_location}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs"
                        >
                          {row.label}
                          <button onClick={() => togglePaper(row.file_location)}>
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={runContradictions}
                    disabled={!canRun}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    {running ? 'Analyse...' : 'Chercher tensions'}
                  </button>
                  <button
                    onClick={copyResults}
                    disabled={!result}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
                    {copied ? 'Copié' : 'Copier résultats'}
                  </button>
                </div>
              </div>
            </div>

            {!result ? (
              <p className="text-sm text-gray-400">Lancez l’analyse pour voir les tensions candidates Matrix.</p>
            ) : (
              <>
                <OverviewCard result={result} />
                <CandidateList
                  result={result}
                  expandedIndex={expandedIndex}
                  setExpandedIndex={setExpandedIndex}
                  prepareCitedCompare={prepareCitedCompare}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ result }: { result: ContradictionResponse }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Vue d’ensemble</h2>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
        <Metric label="Papiers" value={result.metadata.paper_count} />
        <Metric label="Matrix" value={result.metadata.matrix_rows} />
        <Metric label="Paires" value={result.metadata.considered_pairs} />
        <Metric label="Candidats" value={result.metadata.candidate_count} />
        <Metric label="À vérifier" value={result.metadata.needs_review_rows} />
      </div>
      {result.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {result.warnings.map((warning) => (
            <p key={warning} className="text-sm text-amber-600 dark:text-amber-400">{warning}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateList({
  result,
  expandedIndex,
  setExpandedIndex,
  prepareCitedCompare,
}: {
  result: ContradictionResponse;
  expandedIndex: number | null;
  setExpandedIndex: (index: number | null) => void;
  prepareCitedCompare: (candidate: ContradictionCandidate) => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Tensions candidates</h2>
      {result.candidates.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune tension candidate détectée avec les signaux Matrix actuels.</p>
      ) : (
        <div className="space-y-3">
          {result.candidates.map((candidate, index) => {
            const expanded = expandedIndex === index;
            return (
              <div key={`${candidate.papers.map((paper) => paper.file_location).join('|')}-${candidate.tension_type}`} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                <button
                  onClick={() => setExpandedIndex(expanded ? null : index)}
                  className="w-full text-left p-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-100">
                        {candidate.papers.map((paper) => paper.label).join(' ↔ ')}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{candidate.rationale}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge>{TENSION_LABELS[candidate.tension_type] || candidate.tension_type}</Badge>
                        <span className={`px-2 py-0.5 rounded text-xs ${confidenceClass(candidate.confidence)}`}>
                          confiance {candidate.confidence}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{candidate.score}</p>
                      <p className="text-xs text-gray-400">score</p>
                    </div>
                  </div>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => prepareCitedCompare(candidate)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600"
                      >
                        <GitCompareArrows className="w-4 h-4" />
                        Préparer Compare cité
                      </button>
                    </div>
                    <FieldPanel title="Champs partagés" fields={candidate.shared} />
                    <DivergencePanel candidate={candidate} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldPanel({ title, fields }: { title: string; fields: Record<string, string[]> }) {
  const entries = Object.entries(fields).filter(([, values]) => values.length > 0);
  return (
    <div>
      <h3 className="font-medium text-sm text-gray-800 dark:text-gray-100 mb-2">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">none</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {entries.map(([field, values]) => (
            <div key={field} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{FIELD_LABELS[field] || field}</p>
              <div className="flex flex-wrap gap-1.5">
                {values.map((value) => <Badge key={value}>{value}</Badge>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DivergencePanel({ candidate }: { candidate: ContradictionCandidate }) {
  const entries = Object.entries(candidate.divergent);
  return (
    <div>
      <h3 className="font-medium text-sm text-gray-800 dark:text-gray-100 mb-2">Divergences</h3>
      <div className="space-y-2">
        {entries.map(([field, values]) => (
          <div key={field} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{FIELD_LABELS[field] || field}</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {candidate.papers.map((paper, index) => (
                <div key={paper.file_location}>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{paper.label}</p>
                  <ul className="list-disc list-inside text-xs text-gray-500 dark:text-gray-400 space-y-1">
                    {(index === 0 ? values.paper_a : values.paper_b).map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm border bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-semibold text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-300">
      {children}
    </span>
  );
}

function formatFieldEntries(fields: Record<string, string[]>): string[] {
  const entries = Object.entries(fields).filter(([, values]) => values.length > 0);
  if (entries.length === 0) return ['none'];
  return entries.map(([field, values]) => `- ${FIELD_LABELS[field] || field}: ${values.join(', ')}`);
}

function formatDivergences(candidate: ContradictionCandidate): string[] {
  const lines: string[] = [];
  Object.entries(candidate.divergent).forEach(([field, values]) => {
    lines.push(`- ${FIELD_LABELS[field] || field}:`);
    candidate.papers.forEach((paper, index) => {
      const sideValues = index === 0 ? values.paper_a : values.paper_b;
      lines.push(`  - ${paper.label}: ${sideValues.join('; ') || 'none'}`);
    });
  });
  return lines.length ? lines : ['none'];
}

function formatContradictionExport(result: ContradictionResponse): string {
  const lines = [
    '# Contradiction Detector V1',
    '',
    `Scope: ${result.scope}`,
    `Strategy: ${result.metadata.strategy}`,
    `Papers: ${result.metadata.paper_count}`,
    `Matrix rows: ${result.metadata.matrix_rows}`,
    `Indexed-only rows: ${result.metadata.indexed_only_rows}`,
    `Pairs considered: ${result.metadata.considered_pairs}`,
    `Candidates: ${result.metadata.candidate_count}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(' | ')}`);
  }
  lines.push('', '## Tensions candidates');
  if (result.candidates.length === 0) {
    lines.push('none');
  } else {
    result.candidates.forEach((candidate, index) => {
      lines.push(
        '',
        `### ${index + 1}. ${candidate.papers.map((paper) => paper.label).join(' ↔ ')}`,
        `Type: ${TENSION_LABELS[candidate.tension_type] || candidate.tension_type}`,
        `Score: ${candidate.score}`,
        `Confidence: ${candidate.confidence}`,
        `Rationale: ${candidate.rationale}`,
        'Shared:',
        ...formatFieldEntries(candidate.shared),
        'Divergences:',
        ...formatDivergences(candidate),
        'Question Compare suggérée:',
        candidate.suggested_compare_question
      );
    });
  }
  return lines.join('\n');
}
