import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  GitCompare,
  GitCompareArrows,
  Search,
  TableProperties,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  findMatrixGaps,
  getPaperManifest,
  type GapResponse,
  type PaperManifestRow,
} from '../hooks/useApi';
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
  paper_kind: 'Type',
};

const REASON_LABELS: Record<string, string> = {
  indexed_only: 'Pas de Matrix',
  needs_review: 'Matrix à vérifier',
  missing_fields: 'Champs manquants',
  weak_fields: 'Champs faibles',
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

function severityClass(severity: string): string {
  if (severity === 'high') {
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
  }
  if (severity === 'medium') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
}

export default function GapFinderPage() {
  const [manifestRows, setManifestRows] = useState<PaperManifestRow[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'selection' | 'corpus'>('corpus');
  const [includeIndexedOnly, setIncludeIndexedOnly] = useState(true);
  const [result, setResult] = useState<GapResponse | null>(null);
  const [copied, setCopied] = useState(false);
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
  const canRun = !running && (scope === 'corpus' || selectedFiles.length > 0);

  const togglePaper = (fileLocation: string) => {
    setSelectedFiles((prev) => {
      if (prev.includes(fileLocation)) {
        return prev.filter((item) => item !== fileLocation);
      }
      setScope('selection');
      return [...prev, fileLocation];
    });
  };

  const runGaps = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await findMatrixGaps({
          file_locations: scope === 'selection' ? selectedFiles : undefined,
          include_indexed_only: includeIndexedOnly,
          scope,
        })
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Analyse des gaps échouée'));
    }
    setRunning(false);
  };

  const copyResults = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(formatGapExport(result));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-5 pb-12">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Gap Finder</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Diagnostic gratuit des manques Matrix à partir du manifest
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
              'Matrix partielle: les papiers indexed_only seront signalés comme gaps forts.'
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
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge>{`${matrixRows} Matrix`}</Badge>
                <Badge>{`${indexedOnlyRows} indexed only`}</Badge>
                <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  {selectedFiles.length} sélectionnés
                </span>
              </div>
            </div>

            <div className="max-h-[calc(100vh-330px)] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
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
                      Analyse les {manifestRows.length} papiers du manifest.
                    </p>
                  ) : selectedRows.length === 0 ? (
                    <p className="text-sm text-gray-400">Sélectionnez au moins un papier.</p>
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
                    onClick={runGaps}
                    disabled={!canRun}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    {running ? 'Analyse...' : 'Analyser gaps'}
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
              <p className="text-sm text-gray-400">Lancez l’analyse pour voir les manques Matrix exploitables.</p>
            ) : (
              <>
                <OverviewCard result={result} />
                <ReviewGapsPanel result={result} />
                <CompletionGapsPanel result={result} />
                <FieldGapsPanel result={result} />
                <ActionsPanel result={result} />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ result }: { result: GapResponse }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Vue d’ensemble</h2>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
        <Metric label="Papiers" value={result.summary.paper_count} />
        <Metric label="Matrix" value={result.summary.matrix_rows} />
        <Metric label="Indexed only" value={result.summary.indexed_only_rows} />
        <Metric label="À vérifier" value={result.summary.needs_review_rows} />
        <Metric label="Avec gaps" value={result.summary.gap_paper_count} />
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
        Stratégie: {result.summary.strategy}. Aucun build Matrix ou Compare cité n’est lancé automatiquement.
      </p>
    </div>
  );
}

function reviewGaps(result: GapResponse) {
  return result.review_gaps || result.paper_gaps.filter((item) => item.reasons.length === 1 && item.reasons[0] === 'needs_review');
}

function completionGaps(result: GapResponse) {
  return result.completion_gaps || result.paper_gaps.filter((item) => !(item.reasons.length === 1 && item.reasons[0] === 'needs_review'));
}

function ReviewGapsPanel({ result }: { result: GapResponse }) {
  const items = reviewGaps(result);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Papiers à vérifier</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune ligne Matrix simplement à vérifier.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((item) => (
            <div key={item.paper.file_location} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-sm text-gray-800 dark:text-gray-100">{item.paper.label}</h3>
                  <p className="text-xs text-gray-400">Matrix à vérifier, sans champ manquant/faible détecté.</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs ${severityClass(item.severity)}`}>
                  {item.severity}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompletionGapsPanel({ result }: { result: GapResponse }) {
  const items = completionGaps(result);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Papiers à compléter</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun vrai champ manquant ou faible sur ce périmètre.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.paper.file_location} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-medium text-gray-800 dark:text-gray-100">{item.paper.label}</h3>
                  <p className="text-xs text-gray-400">
                    {item.paper.source === 'indexed_only' ? 'Pas de ligne Matrix' : item.paper.needs_review ? 'Matrix à vérifier' : 'Matrix incomplète'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs ${severityClass(item.severity)}`}>
                  {item.severity}
                </span>
              </div>
              <FieldChipLine label="Motifs" fields={item.reasons} labels={REASON_LABELS} />
              <FieldChipLine label="Manquants" fields={item.missing_fields} />
              <FieldChipLine label="Faibles" fields={item.weak_fields} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldGapsPanel({ result }: { result: GapResponse }) {
  const rows = result.field_gaps
    .filter((field) => field.missing_count > 0 || field.weak_count > 0)
    .sort((a, b) => b.missing_count + b.weak_count - (a.missing_count + a.weak_count));
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Champs faibles / manquants</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Tous les champs suivis sont renseignés sur ce périmètre.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((field) => (
            <div key={field.field} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="font-medium text-sm text-gray-800 dark:text-gray-100">{field.label}</h3>
                <Badge>{`${Math.round(field.coverage_ratio * 100)}% couvert`}</Badge>
              </div>
              <p className="text-xs text-gray-400">
                {field.missing_count} manquants, {field.weak_count} faibles, {field.present_count} présents
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionsPanel({ result }: { result: GapResponse }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Actions suggérées</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {result.actions.map((action) => (
          <div key={action.type} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-medium text-sm text-gray-800 dark:text-gray-100">{action.label}</h3>
              <span className={`px-2 py-0.5 rounded text-xs ${severityClass(action.priority)}`}>
                {action.priority}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{action.description}</p>
            <ActionLink type={action.type} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionLink({ type }: { type: string }) {
  if (type.includes('similarity')) {
    return (
      <Link to="/similarity" className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <GitCompare className="w-3.5 h-3.5" />
        Similarités
      </Link>
    );
  }
  if (type.includes('comparison')) {
    return (
      <Link to="/comparison-lab" className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <GitCompareArrows className="w-3.5 h-3.5" />
        Comparison Lab
      </Link>
    );
  }
  return (
    <Link to="/matrix" className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <TableProperties className="w-3.5 h-3.5" />
      Matrix
    </Link>
  );
}

function FieldChipLine({
  label,
  fields,
  labels = FIELD_LABELS,
}: {
  label: string;
  fields: string[];
  labels?: Record<string, string>;
}) {
  return (
    <div className="mt-2">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {fields.length === 0 ? (
          <Badge>aucun</Badge>
        ) : (
          fields.map((field) => <Badge key={field}>{labels[field] || field}</Badge>)
        )}
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

function formatGapExport(result: GapResponse): string {
  const lines = [
    '# Gap Finder V1',
    '',
    `Scope: ${result.scope}`,
    `Strategy: ${result.summary.strategy}`,
    `Papers: ${result.summary.paper_count}`,
    `Matrix rows: ${result.summary.matrix_rows}`,
    `Indexed-only rows: ${result.summary.indexed_only_rows}`,
    `Needs review: ${result.summary.needs_review_rows}`,
    `Gap papers: ${result.summary.gap_paper_count}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(' | ')}`);
  }
  lines.push('', '## Papiers à vérifier');
  const reviewItems = reviewGaps(result);
  if (reviewItems.length === 0) {
    lines.push('none');
  } else {
    reviewItems.forEach((item) => {
      lines.push('', `### ${item.paper.label}`, `Severity: ${item.severity}`, 'Motifs: Matrix à vérifier');
    });
  }
  lines.push('', '## Papiers à compléter');
  const completionItems = completionGaps(result);
  if (completionItems.length === 0) {
    lines.push('none');
  } else {
    completionItems.forEach((item) => {
      lines.push(
        '',
        `### ${item.paper.label}`,
        `Severity: ${item.severity}`,
        `Motifs: ${item.reasons.map((reason) => REASON_LABELS[reason] || reason).join(', ') || 'none'}`,
        `Missing: ${item.missing_fields.map((field) => FIELD_LABELS[field] || field).join(', ') || 'none'}`,
        `Weak: ${item.weak_fields.map((field) => FIELD_LABELS[field] || field).join(', ') || 'none'}`
      );
    });
  }
  lines.push('', '## Champs faibles / manquants');
  result.field_gaps
    .filter((field) => field.missing_count > 0 || field.weak_count > 0)
    .forEach((field) => {
      lines.push(`- ${field.label}: ${field.missing_count} manquants, ${field.weak_count} faibles, ${Math.round(field.coverage_ratio * 100)}% couvert`);
    });
  lines.push('', '## Actions suggérées');
  result.actions.forEach((action) => {
    lines.push(`- ${action.label} (${action.priority}): ${action.description}`);
  });
  return lines.join('\n');
}
