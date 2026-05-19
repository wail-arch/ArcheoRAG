import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Database,
  Edit3,
  Filter,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Square,
  TableProperties,
  Trash2,
} from 'lucide-react';
import {
  buildEvidenceMatrix,
  getEvidenceMatrix,
  getIndexedPapers,
  resetEvidenceMatrix,
  updateMatrixRowCuration,
  verifyMatrixRow,
  type IndexedPaper,
  type MatrixFieldItem,
  type MatrixQuality,
  type MatrixResponse,
  type MatrixRow,
} from '../hooks/useApi';
import { getErrorMessage } from '../utils/errors';

const FIELD_COLUMNS = [
  { key: 'regions', label: 'Région' },
  { key: 'sites', label: 'Site' },
  { key: 'periods', label: 'Période' },
  { key: 'methods', label: 'Méthode' },
  { key: 'materials', label: 'Matériel' },
  { key: 'main_claims', label: 'Claims' },
  { key: 'limitations', label: 'Limites' },
];

const MATRIX_FIELDS = [
  { key: 'regions', label: 'Régions' },
  { key: 'sites', label: 'Sites' },
  { key: 'periods', label: 'Périodes' },
  { key: 'date_ranges', label: 'Dates' },
  { key: 'methods', label: 'Méthodes' },
  { key: 'materials', label: 'Matériaux' },
  { key: 'evidence_types', label: 'Types de preuve' },
  { key: 'main_claims', label: 'Claims' },
  { key: 'limitations', label: 'Limites' },
  { key: 'uncertainties', label: 'Incertitudes' },
];

const FILTER_FIELDS = [
  { key: 'regions', label: 'Région' },
  { key: 'periods', label: 'Période' },
  { key: 'methods', label: 'Méthode' },
  { key: 'materials', label: 'Matériel' },
];

const REVIEW_FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'low', label: 'Faible confiance' },
  { key: 'partial', label: 'Partielles' },
  { key: 'failed', label: 'Échecs' },
  { key: 'unverified', label: 'Non vérifiées' },
  { key: 'stale', label: 'Obsolètes' },
] as const;

type ReviewFilter = (typeof REVIEW_FILTERS)[number]['key'];

function valuesFor(row: MatrixRow, field: string): MatrixFieldItem[] {
  return row.fields[field] ?? [];
}

function textFor(row: MatrixRow): string {
  return [
    row.paper.citation,
    row.paper.docname,
    row.paper.title,
    row.paper.year,
    row.curation?.notes,
    row.status,
    ...Object.values(row.fields).flat().map((item) => item.value),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function uniqueValues(rows: MatrixRow[], field: string): string[] {
  return Array.from(
    new Set(rows.flatMap((row) => valuesFor(row, field).map((item) => item.value)))
  ).sort((a, b) => a.localeCompare(b));
}

function shortValues(items: MatrixFieldItem[], max = 2): string {
  if (items.length === 0) return '—';
  const values = items.map((item) => item.value);
  const visible = values.slice(0, max).join(', ');
  return values.length > max ? `${visible} +${values.length - max}` : visible;
}

function replaceRow(matrix: MatrixResponse, updatedRow: MatrixRow): MatrixResponse {
  return {
    ...matrix,
    rows: matrix.rows.map((row) =>
      row.paper.file_location === updatedRow.paper.file_location ? updatedRow : row
    ),
  };
}

function emptyFields(): Record<string, MatrixFieldItem[]> {
  return Object.fromEntries(MATRIX_FIELDS.map((field) => [field.key, []]));
}

function emptyQuality(): MatrixQuality {
  const fieldQuality = Object.fromEntries(
    MATRIX_FIELDS.map((field) => [
      field.key,
      {
        item_count: 0,
        confidence_counts: { high: 0, medium: 0, low: 0 },
        supporting_context_count: 0,
        missing: true,
        verified: false,
      },
    ])
  );
  return {
    confidence_counts: { high: 0, medium: 0, low: 0 },
    field_quality: fieldQuality,
    supporting_context_count: 0,
    missing_key_categories: FIELD_COLUMNS.map((field) => field.key),
    missing_groups: ['context', 'methods', 'interpretation'],
    dropped_unsupported_count: 0,
    needs_review: true,
  };
}

function placeholderRow(paper: IndexedPaper, currentHash = ''): MatrixRow {
  const fields = emptyFields();
  return {
    paper,
    fields,
    generated_fields: fields,
    contexts: [],
    status: 'partial',
    quality: emptyQuality(),
    curation: {
      notes: '',
      row_verified: false,
      verified_fields: [],
      curated_fields: {},
      updated_at: null,
    },
    dropped_items: [],
    updated_at: '',
    index_config_hash: currentHash,
  };
}

function isPlaceholderRow(row: MatrixRow): boolean {
  return row.updated_at === '' && row.contexts.length === 0;
}

function matchesReviewFilter(
  row: MatrixRow,
  reviewFilter: ReviewFilter,
  currentHash?: string
): boolean {
  if (reviewFilter === 'all') return true;
  if (reviewFilter === 'low') return (row.quality?.confidence_counts.low ?? 0) > 0;
  if (reviewFilter === 'partial') return row.status === 'partial';
  if (reviewFilter === 'failed') return row.status === 'failed';
  if (reviewFilter === 'unverified') return !row.curation?.row_verified;
  if (reviewFilter === 'stale') return row.index_config_hash !== currentHash;
  return true;
}

export default function MatrixPage() {
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [indexedPapers, setIndexedPapers] = useState<IndexedPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [matrixResult, indexedResult] = await Promise.all([
        getEvidenceMatrix(),
        getIndexedPapers(),
      ]);
      setMatrix(matrixResult);
      setIndexedPapers(indexedResult);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Chargement de la matrice échoué'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadMatrix);
  }, [loadMatrix]);

  const handleBuild = async (force: boolean) => {
    setBuilding(true);
    setMessage(null);
    setError(null);
    try {
      const result = await buildEvidenceMatrix(force);
      setMatrix(result.matrix);
      setMessage(
        `Analyse terminée: ${result.analyzed} analysé(s), ${result.skipped} ignoré(s), ${result.failed} échec(s)`
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Construction de la matrice échouée'));
    }
    setBuilding(false);
  };

  const handleBuildSelection = async (force: boolean) => {
    const fileLocations = Array.from(selectedFiles);
    if (fileLocations.length === 0) return;
    setBuilding(true);
    setMessage(null);
    setError(null);
    try {
      const result = await buildEvidenceMatrix({
        force,
        mode: 'cheap',
        file_locations: fileLocations,
      });
      setMatrix(result.matrix);
      setSelectedFiles(new Set());
      setMessage(
        `Sélection terminée en mode éco: ${result.analyzed} analysé(s), ${result.skipped} ignoré(s), ${result.failed} échec(s)`
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Construction de la sélection échouée'));
    }
    setBuilding(false);
  };

  const handleReset = async () => {
    setBuilding(true);
    setMessage(null);
    setError(null);
    try {
      setMatrix(await resetEvidenceMatrix(true));
      setExpanded(null);
      setSelectedFiles(new Set());
      setMessage('Matrice réinitialisée.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Réinitialisation de la matrice échouée'));
    }
    setBuilding(false);
  };

  const handleRowUpdated = (updatedRow: MatrixRow) => {
    setMatrix((prev) => (prev ? replaceRow(prev, updatedRow) : prev));
  };

  const status = matrix?.status;
  const matrixRows = useMemo(() => matrix?.rows ?? [], [matrix]);
  const rows = useMemo(() => {
    const rowsByFile = new Map(
      matrixRows.map((row) => [row.paper.file_location, row])
    );
    const currentHash = status?.index_config_hash ?? '';
    const placeholders = indexedPapers
      .filter((paper) => !rowsByFile.has(paper.file_location))
      .map((paper) => placeholderRow(paper, currentHash));
    return [...matrixRows, ...placeholders];
  }, [indexedPapers, matrixRows, status?.index_config_hash]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !normalizedQuery || textFor(row).includes(normalizedQuery);
      const matchesFilters = Object.entries(filters).every(([field, value]) => {
        if (!value) return true;
        return valuesFor(row, field).some((item) => item.value === value);
      });
      return (
        matchesSearch &&
        matchesFilters &&
        matchesReviewFilter(row, reviewFilter, status?.index_config_hash)
      );
    });
  }, [rows, query, filters, reviewFilter, status?.index_config_hash]);

  const selectedCount = selectedFiles.size;
  const visibleSelectedCount = filteredRows.filter((row) =>
    selectedFiles.has(row.paper.file_location)
  ).length;
  const allVisibleSelected =
    filteredRows.length > 0 && visibleSelectedCount === filteredRows.length;
  const unverifiedCount = matrixRows.filter((row) => !row.curation?.row_verified).length;
  const lowConfidenceCount = matrixRows.filter(
    (row) => (row.quality?.confidence_counts.low ?? 0) > 0
  ).length;

  const toggleSelected = (fileLocation: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileLocation)) {
        next.delete(fileLocation);
      } else {
        next.add(fileLocation);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const row of filteredRows) {
          next.delete(row.paper.file_location);
        }
      } else {
        for (const row of filteredRows) {
          next.add(row.paper.file_location);
        }
      }
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-5 pb-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Matrice</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Analyse structurée, vérifiable et corrigeable des papiers indexés
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBuild(false)}
              disabled={building || !status?.available}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${building ? 'animate-spin' : ''}`} />
              Construire
            </button>
            <button
              onClick={() => handleBuild(true)}
              disabled={building || !status?.available}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Reconstruire
            </button>
            <button
              onClick={handleReset}
              disabled={building || matrixRows.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Réinitialiser
            </button>
          </div>
        </div>

        {status?.stale && (
          <Notice tone="warning" text="La matrice est obsolète par rapport à l'index PaperQA. Reconstruisez-la." />
        )}
        {message && <Notice tone="success" text={message} />}
        {error && <Notice tone="error" text={error} />}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Stat icon={Database} label="Papiers indexés" value={status?.paper_count ?? 0} />
          <Stat icon={TableProperties} label="Lignes matrice" value={status?.row_count ?? 0} />
          <Stat icon={AlertCircle} label="Échecs" value={status?.failed_papers.length ?? 0} />
          <Stat icon={ShieldCheck} label="À vérifier" value={unverifiedCount} />
          <Stat icon={Filter} label="Faible confiance" value={lowConfidenceCount} />
        </div>

        {!loading && !status?.available ? (
          <div className="text-center py-16 text-gray-400">
            Aucun papier indexé. Indexez d'abord vos PDFs dans la Bibliothèque.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher dans la matrice..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none focus:border-amber-500"
                  />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {FILTER_FIELDS.map((field) => (
                    <select
                      key={field.key}
                      value={filters[field.key] ?? ''}
                      onChange={(event) =>
                        setFilters((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">{field.label}</option>
                      {uniqueValues(rows, field.key).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {REVIEW_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setReviewFilter(filter.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      reviewFilter === filter.key
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-amber-400'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
                {selectedCount > 0 && (
                  <>
                    <button
                      onClick={() => handleBuildSelection(false)}
                      disabled={building}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${building ? 'animate-spin' : ''}`} />
                      Construire sélection ({selectedCount})
                    </button>
                    <button
                      onClick={() => handleBuildSelection(true)}
                      disabled={building}
                      className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Reconstruire sélection
                    </button>
                    <button
                      onClick={() => setSelectedFiles(new Set())}
                      disabled={building}
                      className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                    >
                      Désélectionner
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <button
                          onClick={toggleVisibleSelection}
                          disabled={filteredRows.length === 0}
                          className="p-1 text-gray-400 hover:text-amber-600 disabled:opacity-40"
                          title={allVisibleSelected ? 'Désélectionner les lignes visibles' : 'Sélectionner les lignes visibles'}
                        >
                          {allVisibleSelected ? (
                            <CheckSquare className="w-4 h-4" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">Papier</th>
                      {FIELD_COLUMNS.map((field) => (
                        <th key={field.key} className="text-left px-3 py-2 font-medium min-w-40">
                          {field.label}
                        </th>
                      ))}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {loading ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                          Chargement...
                        </td>
                      </tr>
                    ) : filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                          Aucune ligne ne correspond aux filtres.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => (
                        <MatrixTableRow
                          key={row.paper.file_location}
                          row={row}
                          expanded={expanded === row.paper.file_location}
                          selected={selectedFiles.has(row.paper.file_location)}
                          onToggle={() =>
                            setExpanded((prev) =>
                              prev === row.paper.file_location ? null : row.paper.file_location
                            )
                          }
                          onSelect={() => toggleSelected(row.paper.file_location)}
                          onRowUpdated={handleRowUpdated}
                          onError={setError}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MatrixTableRow({
  row,
  expanded,
  selected,
  onToggle,
  onSelect,
  onRowUpdated,
  onError,
}: {
  row: MatrixRow;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onRowUpdated: (row: MatrixRow) => void;
  onError: (message: string | null) => void;
}) {
  const paperTitle = row.paper.title || row.paper.filename || row.paper.docname;
  const placeholder = isPlaceholderRow(row);

  return (
    <>
      <tr className={row.status === 'failed' ? 'bg-red-50 dark:bg-red-900/10' : ''}>
        <td className="px-3 py-3 align-top">
          <button
            onClick={onSelect}
            className="p-1 text-gray-400 hover:text-amber-600"
            title={selected ? 'Désélectionner ce papier' : 'Sélectionner ce papier'}
          >
            {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>
        </td>
        <td className="px-3 py-3 align-top min-w-72">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-gray-800 dark:text-gray-100">{paperTitle}</p>
              <p className="text-xs text-gray-400">
                {placeholder ? 'non construite' : row.paper.year || row.status}
                {row.build_mode === 'cheap' ? ' · éco' : ''}
              </p>
            </div>
            {placeholder ? (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">
                à créer
              </span>
            ) : (
              <StatusBadge status={row.status} />
            )}
          </div>
          {row.curation?.notes && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">
              {row.curation.notes}
            </p>
          )}
        </td>
        {FIELD_COLUMNS.map((field) => (
          <td key={field.key} className="px-3 py-3 align-top text-gray-600 dark:text-gray-300">
            <FieldCell row={row} field={field.key} />
          </td>
        ))}
        <td className="px-2 py-3 align-top">
          <button
            onClick={onToggle}
            className="p-1.5 text-gray-400 hover:text-amber-600"
            title="Voir les preuves"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="px-4 py-4 bg-gray-50 dark:bg-gray-800/60">
            <ExpandedEvidence
              key={`${row.paper.file_location}-${row.curation?.updated_at ?? row.updated_at}`}
              row={row}
              onRowUpdated={onRowUpdated}
              onError={onError}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function FieldCell({ row, field }: { row: MatrixRow; field: string }) {
  const items = valuesFor(row, field);
  const quality = row.quality?.field_quality[field];
  const hasCurated = items.some((item) => item.source === 'curated');

  return (
    <div className="space-y-1">
      <p>{shortValues(items)}</p>
      <div className="flex flex-wrap items-center gap-1">
        {quality?.verified && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
            vérifié
          </span>
        )}
        {hasCurated && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
            corrigé
          </span>
        )}
        {quality && quality.supporting_context_count > 0 && (
          <span className="text-[11px] text-gray-400">{quality.supporting_context_count} preuve(s)</span>
        )}
        {(quality?.confidence_counts.low ?? 0) > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
            faible
          </span>
        )}
      </div>
    </div>
  );
}

function ExpandedEvidence({
  row,
  onRowUpdated,
  onError,
}: {
  row: MatrixRow;
  onRowUpdated: (row: MatrixRow) => void;
  onError: (message: string | null) => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [notes, setNotes] = useState(row.curation?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const contextById = new Map(row.contexts.map((ctx) => [ctx.id, ctx]));
  const fields = MATRIX_FIELDS.filter(({ key }) => {
    const hasEffectiveItems = valuesFor(row, key).length > 0;
    const hasGeneratedItems = (row.generated_fields[key] ?? []).length > 0;
    const hasCuratedOverride = Boolean(row.curation?.curated_fields?.[key]);
    return hasEffectiveItems || hasGeneratedItems || hasCuratedOverride;
  });

  const patchRow = async (update: Parameters<typeof updateMatrixRowCuration>[1]) => {
    setSaving(true);
    onError(null);
    try {
      const updated = await updateMatrixRowCuration(row.paper.file_location, update);
      onRowUpdated(updated);
    } catch (err: unknown) {
      onError(getErrorMessage(err, 'Mise à jour de la curation échouée'));
    }
    setSaving(false);
  };

  const saveItem = async (field: string, index: number) => {
    const value = draftValue.trim();
    if (!value) return;
    const nextItems = valuesFor(row, field).map((item, itemIndex) =>
      itemIndex === index ? { ...item, value, source: 'curated' as const } : item
    );
    await patchRow({ curated_fields: { [field]: nextItems } });
    setEditingKey(null);
  };

  const deleteItem = async (field: string, index: number) => {
    const nextItems = valuesFor(row, field).filter((_, itemIndex) => itemIndex !== index);
    await patchRow({ curated_fields: { [field]: nextItems } });
  };

  const resetField = async (field: string) => {
    await patchRow({ clear_curated_fields: [field] });
  };

  const verifyField = async (field: string, verified: boolean) => {
    setSaving(true);
    onError(null);
    try {
      const updated = await verifyMatrixRow(row.paper.file_location, verified, field);
      onRowUpdated(updated);
    } catch (err: unknown) {
      onError(getErrorMessage(err, 'Vérification du champ échouée'));
    }
    setSaving(false);
  };

  const verifyWholeRow = async (verified: boolean) => {
    setSaving(true);
    onError(null);
    try {
      const updated = await verifyMatrixRow(row.paper.file_location, verified);
      onRowUpdated(updated);
    } catch (err: unknown) {
      onError(getErrorMessage(err, 'Vérification de la ligne échouée'));
    }
    setSaving(false);
  };

  if (isPlaceholderRow(row)) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Ligne non construite. Cochez ce papier puis utilisez Construire sélection pour générer une Matrix éco.
      </p>
    );
  }

  if (row.status === 'failed') {
    return <p className="text-sm text-red-600 dark:text-red-400">{row.error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-3 lg:items-start lg:justify-between">
        <QualitySummary row={row} />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => verifyWholeRow(!row.curation?.row_verified)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {row.curation?.row_verified ? 'Retirer validation' : 'Valider ligne'}
          </button>
          <button
            onClick={() => patchRow({ notes })}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-white text-xs disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            Notes
          </button>
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes de curation..."
        className="w-full min-h-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none focus:border-amber-500"
      />

      {fields.map(({ key: field, label }) => {
        const items = valuesFor(row, field);
        return (
        <div key={field} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{label}</h3>
              {row.quality?.field_quality[field]?.verified && (
                <span className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  vérifié
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  verifyField(field, !row.quality?.field_quality[field]?.verified)
                }
                disabled={saving}
                className="flex items-center gap-1 px-2 py-1 rounded border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-xs disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Champ
              </button>
              {row.curation?.curated_fields?.[field] && (
                <button
                  onClick={() => resetField(field)}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 text-xs disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Original
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun élément actif pour ce champ.</p>
            ) : (
              items.map((item, index) => {
              const itemKey = `${field}-${index}`;
              return (
                <div key={itemKey} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {editingKey === itemKey ? (
                        <input
                          value={draftValue}
                          onChange={(event) => setDraftValue(event.target.value)}
                          className="min-w-64 flex-1 px-2 py-1 border border-amber-400 rounded text-sm bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                          {item.value}
                        </span>
                      )}
                      <ConfidenceBadge confidence={item.confidence} />
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">
                        {item.source === 'curated' ? 'corrigé' : 'généré'}
                      </span>
                      <div className="flex items-center gap-1 ml-auto">
                        {editingKey === itemKey ? (
                          <button
                            onClick={() => saveItem(field, index)}
                            disabled={saving}
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded disabled:opacity-50"
                            title="Enregistrer"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingKey(itemKey);
                              setDraftValue(item.value);
                            }}
                            className="p-1.5 text-gray-400 hover:text-amber-600 rounded"
                            title="Corriger"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteItem(field, index)}
                          disabled={saving}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {item.evidence_ids.map((id) => {
                        const ctx = contextById.get(id);
                        if (!ctx) return null;
                        return (
                          <div key={id} className="text-xs text-gray-500 dark:text-gray-400">
                            <p className="font-medium text-gray-600 dark:text-gray-300">
                              {ctx.text.name} · score {ctx.score}
                            </p>
                            <p>{ctx.context}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
            )}
          </div>
        </div>
        );
      })}

      {row.dropped_items.length > 0 && (
        <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300">
          {row.dropped_items.length} élément(s) rejeté(s) car non supporté(s), dupliqué(s) ou mal formé(s).
        </div>
      )}
    </div>
  );
}

function QualitySummary({ row }: { row: MatrixRow }) {
  const quality = row.quality;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
        {quality.supporting_context_count} contexte(s)
      </span>
      <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
        {quality.confidence_counts.high} haute
      </span>
      <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        {quality.confidence_counts.medium} moyenne
      </span>
      <span className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
        {quality.confidence_counts.low} faible
      </span>
      {quality.missing_key_categories.length > 0 && (
        <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
          manquant: {quality.missing_key_categories.join(', ')}
        </span>
      )}
      {quality.dropped_unsupported_count > 0 && (
        <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
          {quality.dropped_unsupported_count} rejeté(s)
        </span>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: MatrixFieldItem['confidence'] }) {
  const classes = {
    high: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    low: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  };
  return <span className={`text-xs px-2 py-0.5 rounded ${classes[confidence]}`}>{confidence}</span>;
}

function StatusBadge({ status }: { status: MatrixRow['status'] }) {
  const labels = {
    complete: 'complet',
    partial: 'partiel',
    failed: 'échec',
    needs_review: 'à revoir',
    verified: 'vérifié',
  };
  const classes = {
    complete: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    partial: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    needs_review: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    verified: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  };
  return <span className={`text-xs px-2 py-0.5 rounded ${classes[status]}`}>{labels[status]}</span>;
}

function Notice({ tone, text }: { tone: 'success' | 'warning' | 'error'; text: string }) {
  const classes = {
    success: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    error: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  };
  return <div className={`px-4 py-3 rounded-lg text-sm border ${classes[tone]}`}>{text}</div>;
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-amber-500" />
        <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  );
}
