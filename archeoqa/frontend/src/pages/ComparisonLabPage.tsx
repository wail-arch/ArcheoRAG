import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  FlaskConical,
  GitCompareArrows,
  Search,
  TableProperties,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  comparePaperDifferences,
  getPaperManifest,
  type DifferenceResponse,
  type PaperManifestRow,
} from '../hooks/useApi';
import { getErrorMessage } from '../utils/errors';
import { saveComparePrefill } from '../utils/comparePrefill';

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
  paper_kind: 'Type',
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

function confidenceClass(confidence: DifferenceResponse['quality']['confidence']): string {
  if (confidence === 'high') {
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
  }
  if (confidence === 'medium') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }
  return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
}

export default function ComparisonLabPage() {
  const navigate = useNavigate();
  const [manifestRows, setManifestRows] = useState<PaperManifestRow[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [includeIndexedOnly, setIncludeIndexedOnly] = useState(true);
  const [result, setResult] = useState<DifferenceResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
  const canRun = selectedFiles.length >= 2 && selectedFiles.length <= 5 && !running;

  const togglePaper = (fileLocation: string) => {
    setSelectedFiles((prev) => {
      if (prev.includes(fileLocation)) {
        return prev.filter((item) => item !== fileLocation);
      }
      if (prev.length >= 5) return prev;
      return [...prev, fileLocation];
    });
  };

  const runDifference = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await comparePaperDifferences(selectedFiles, {
          include_indexed_only: includeIndexedOnly,
        })
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Comparaison Matrix échouée'));
    }
    setRunning(false);
  };

  const copyText = async (kind: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const prepareCitedCompare = () => {
    if (!result) return;
    saveComparePrefill({
      question: result.suggested_compare_question,
      paper_filter: result.papers.map((paper) => paper.file_location),
    });
    navigate('/');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-5 pb-12">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Comparison Lab</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Pré-analyse gratuite des différences à partir de la Matrix et du manifest
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
              'Matrix partielle: les papiers indexed_only restent comparables, mais avec moins de signaux.'
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
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  {matrixRows} Matrix
                </span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {indexedOnlyRows} indexed only
                </span>
                <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  {selectedFiles.length}/5 sélectionnés
                </span>
              </div>
            </div>

            <div className="max-h-[calc(100vh-300px)] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
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
                        checked
                          ? 'bg-amber-50 dark:bg-amber-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 mt-0.5 rounded border shrink-0 ${
                          checked
                            ? 'bg-amber-500 border-amber-500'
                            : 'border-gray-300 dark:border-gray-600'
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
                  <p className="text-xs uppercase text-gray-400 mb-2">Papiers sélectionnés</p>
                  {selectedRows.length === 0 ? (
                    <p className="text-sm text-gray-400">Sélectionnez 2 à 5 papiers.</p>
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
                    onClick={runDifference}
                    disabled={!canRun}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FlaskConical className="w-4 h-4" />
                    {running ? 'Analyse...' : 'Analyser différences'}
                  </button>
                  <button
                    onClick={() => result && copyText('results', formatDifferenceExport(result))}
                    disabled={!result}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {copied === 'results' ? <CheckCircle2 className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
                    {copied === 'results' ? 'Copié' : 'Copier résultats'}
                  </button>
                  <button
                    onClick={prepareCitedCompare}
                    disabled={!result}
                    title="Ouvre le chat avec ces papiers déjà sélectionnés dans le filtre"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <GitCompareArrows className="w-4 h-4" />
                    Préparer Compare cité
                  </button>
                </div>
              </div>
              {selectedFiles.length > 5 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                  Sélectionnez 5 papiers maximum.
                </p>
              )}
            </div>

            {!result ? (
              <p className="text-sm text-gray-400">Lancez l’analyse pour voir les points communs et divergences Matrix.</p>
            ) : (
              <>
                <QualityCard result={result} />
                <FieldPanel
                  title="Commun central"
                  fields={sharedCentral(result)}
                  emptyText="Aucun axe central commun détecté entre tous les papiers."
                />
                <FieldPanel
                  title="Commun contextuel"
                  fields={sharedContextual(result)}
                  emptyText="Aucun commun contextuel détecté."
                />
                <DifferencesPanel result={result} />
                <MissingPanel result={result} />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function QualityCard({ result }: { result: DifferenceResponse }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
        <span className={`px-2 py-0.5 rounded ${confidenceClass(result.quality.confidence)}`}>
          confiance {result.quality.confidence}
        </span>
        <Badge>{`${result.quality.matrix_rows} Matrix`}</Badge>
        <Badge>{`${result.quality.indexed_only_rows} indexed only`}</Badge>
        <Badge>{`${result.quality.needs_review_rows} à vérifier`}</Badge>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Stratégie: {result.quality.strategy}. Les différences ci-dessous sont des signaux Matrix, pas une réponse citée.
      </p>
      {result.excluded_papers.length > 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
          Exclus: {result.excluded_papers.map((paper) => paper.label).join(', ')}
        </p>
      )}
    </div>
  );
}

function FieldPanel({
  title,
  fields,
  emptyText,
}: {
  title: string;
  fields: Record<string, string[]>;
  emptyText: string;
}) {
  const entries = Object.entries(fields).filter(([, values]) => values.length > 0);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {entries.map(([field, values]) => (
            <FieldBox key={field} field={field} values={values} />
          ))}
        </div>
      )}
    </div>
  );
}

function DifferencesPanel({ result }: { result: DifferenceResponse }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Différences par papier</h2>
      <div className="space-y-3">
        {result.differences.map((item) => {
          const entries = Object.entries(item.fields).filter(([, values]) => values.length > 0);
          return (
            <div key={item.paper.file_location} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-medium text-gray-800 dark:text-gray-100">{item.paper.label}</h3>
                  <p className="text-xs text-gray-400">{item.note}</p>
                </div>
                <Badge>{item.paper.year ? String(item.paper.year) : 'année inconnue'}</Badge>
              </div>
              {entries.length === 0 ? (
                <p className="text-sm text-gray-400">Aucune valeur propre hors champs communs.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {entries.map(([field, values]) => (
                    <FieldBox key={field} field={field} values={values} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MissingPanel({ result }: { result: DifferenceResponse }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Champs manquants / à vérifier</h2>
      <div className="space-y-2">
        {result.missing.map((item) => (
          <div key={item.paper.file_location} className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div>
              <p className="font-medium text-sm text-gray-800 dark:text-gray-100">{item.paper.label}</p>
              <p className="text-xs text-gray-400">
                {item.paper.source === 'indexed_only' ? 'Pas de ligne Matrix' : item.paper.needs_review ? 'Matrix à vérifier' : 'Matrix disponible'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 lg:justify-end">
              {item.fields.length === 0 ? (
                <Badge>aucun champ manquant</Badge>
              ) : (
                item.fields.map((field) => <Badge key={field}>{FIELD_LABELS[field] || field}</Badge>)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldBox({ field, values }: { field: string; values: string[] }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
        {FIELD_LABELS[field] || field}
      </h4>
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

function sharedCentral(result: DifferenceResponse): Record<string, string[]> {
  return result.shared_central || {};
}

function sharedContextual(result: DifferenceResponse): Record<string, string[]> {
  return result.shared_contextual || result.shared;
}

function formatDifferenceExport(result: DifferenceResponse): string {
  const lines = [
    '# Comparison Lab / Difference Finder V1',
    '',
    `Papers: ${result.papers.map((paper) => paper.label).join(' | ')}`,
    `Strategy: ${result.quality.strategy}`,
    `Confidence: ${result.quality.confidence}`,
    `Matrix rows: ${result.quality.matrix_rows}`,
    `Indexed-only rows: ${result.quality.indexed_only_rows}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(' | ')}`);
  }
  lines.push(
    '',
    '## Commun central',
    ...formatFieldEntries(sharedCentral(result)),
    '',
    '## Commun contextuel',
    ...formatFieldEntries(sharedContextual(result)),
    '',
    '## Différences'
  );
  result.differences.forEach((item) => {
    lines.push('', `### ${item.paper.label}`, `Note: ${item.note}`, ...formatFieldEntries(item.fields));
  });
  lines.push('', '## Manquants');
  result.missing.forEach((item) => {
    lines.push(
      `- ${item.paper.label}: ${
        item.fields.length ? item.fields.map((field) => FIELD_LABELS[field] || field).join(', ') : 'aucun'
      }`
    );
  });
  lines.push('', '## Question Compare suggérée', result.suggested_compare_question);
  return lines.join('\n');
}
