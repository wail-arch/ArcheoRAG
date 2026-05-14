import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, BookOpen, ChevronDown, ChevronUp, Copy, Download, DollarSign, Check, Target } from 'lucide-react';
import type { AskResponse, ContextItem, TargetingInfo, TargetingPaper } from '../hooks/useApi';
import CitationBadge from './CitationBadge';

interface AnswerCardProps {
  data: AskResponse;
}

/**
 * Parse a PaperQA2 chunk name like "fregel2018ancientgenomesfrom pages 5-7"
 * into { pages: "p. 5-7" }.
 */
function parsePages(name: string): string {
  const m = name.match(/pages?\s+(\d[\d\s,\-–]*)/i);
  return m ? `p. ${m[1].trim()}` : '';
}

/**
 * Turn a PaperQA2 docname like "fregel2018ancientgenomesfrom"
 * into a readable short ref like "Fregel 2018".
 * Falls back to the raw docname if parsing fails.
 */
function formatDocname(docname: string): string {
  // Pattern: author(s) + year + rest  e.g. "fregel2018ancientgenomesfrom"
  const m = docname.match(/^([a-z]+)(\d{4})/i);
  if (m) {
    const author = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const year = m[2];
    return `${author} ${year}`;
  }
  // Fallback: just capitalize first letter and truncate
  return docname.length > 40
    ? docname.slice(0, 40) + '…'
    : docname;
}

/**
 * Deduplicate contexts by docname+pages so we don't show
 * the same source chunk multiple times.
 */
function deduplicateContexts(contexts: ContextItem[]): ContextItem[] {
  const seen = new Set<string>();
  return contexts.filter((ctx) => {
    const key = `${ctx.text.doc.docname}|${ctx.text.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMarkdownExport(data: AskResponse, contexts: ContextItem[]): string {
  let md = `## Question\n${data.question}\n\n## Réponse\n${sanitizeAnswer(data.answer, data.targeting)}\n\n## Sources\n`;
  contexts.forEach((ctx, i) => {
    const ref = formatDocname(ctx.text.doc.docname);
    const pages = parsePages(ctx.text.name);
    const cite = ctx.text.doc.citation || ref;
    md += `${i + 1}. ${cite}${pages ? ` — ${pages}` : ''}\n   > ${ctx.context}\n\n`;
  });
  md += `---\nCoût: $${data.cost.toFixed(4)}\n`;
  return md;
}

function paperLabel(paper: TargetingPaper): string {
  return paper.label || paper.title || paper.docname || paper.filename;
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .trim();
}

function normalizeForMatch(value: string): string {
  return stripMarkdownInline(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function candidateLabels(paper: TargetingPaper): string[] {
  return [
    paper.label,
    paper.title ?? undefined,
    paper.docname,
    paper.filename,
    paper.filename?.replace(/\.pdf$/i, ''),
  ].filter(Boolean) as string[];
}

function paperOrderForRow(rowTitle: string, targeting?: TargetingInfo): number {
  const row = normalizeForMatch(rowTitle);
  const papers = targeting?.resolved_papers ?? [];
  const index = papers.findIndex((paper) =>
    candidateLabels(paper).some((candidate) => {
      const normalized = normalizeForMatch(candidate);
      return normalized.length > 0 && (row.includes(normalized) || normalized.includes(row));
    })
  );
  return index >= 0 ? index : 10_000;
}

function normalizeInlineCitations(answer: string, targeting?: TargetingInfo): string {
  let normalized = answer;
  const papers = targeting?.resolved_papers ?? [];
  [...papers].sort((a, b) => b.docname.length - a.docname.length).forEach((paper) => {
    if (!paper.docname) return;
    const label = paperLabel(paper);
    const escaped = paper.docname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(
      new RegExp(`\\b${escaped}\\s+pages?\\s+(\\d+(?:\\s*[-–,]\\s*\\d+)*)`, 'gi'),
      (_, pages: string) => `${label} p. ${pages.trim()}`
    );
  });
  return normalized;
}

function sanitizeAnswer(answer: string, targeting?: TargetingInfo): string {
  return normalizeInlineCitations(answer, targeting)
    .replace(/\(\s*(?:pqac|pqa|chunk|doc)[-_][A-Za-z0-9_.:-]+\s*\)/gi, '')
    .replace(/\b(?:pqac|pqa|chunk|doc)[-_][A-Za-z0-9_.:-]+\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function splitMarkdownTable(markdown: string): {
  before: string;
  headers: string[];
  rows: string[][];
  after: string;
} | null {
  const lines = markdown.split(/\r?\n/);
  const tableStart = lines.findIndex((line, index) => {
    const next = lines[index + 1]?.trim() ?? '';
    return line.trim().startsWith('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
  });

  if (tableStart < 0) return null;

  let tableEnd = tableStart + 2;
  while (tableEnd < lines.length && lines[tableEnd].trim().startsWith('|')) {
    tableEnd += 1;
  }

  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

  const headers = parseRow(lines[tableStart]);
  const rows = lines.slice(tableStart + 2, tableEnd).map(parseRow);
  if (headers.length < 2 || rows.length === 0) return null;

  return {
    before: lines.slice(0, tableStart).join('\n').trim(),
    headers,
    rows,
    after: lines.slice(tableEnd).join('\n').trim(),
  };
}

function AnswerMarkdown({ answer, targeting }: { answer: string; targeting?: TargetingInfo }) {
  const sanitized = sanitizeAnswer(answer, targeting);
  const table = splitMarkdownTable(sanitized);

  if (!table) {
    return <ReactMarkdown>{sanitized}</ReactMarkdown>;
  }

  const wideTable = table.headers.length > 4;
  const orderedRows = [...table.rows].sort((a, b) => {
    const orderA = paperOrderForRow(a[0] || '', targeting);
    const orderB = paperOrderForRow(b[0] || '', targeting);
    if (orderA !== orderB) return orderA - orderB;
    return table.rows.indexOf(a) - table.rows.indexOf(b);
  });

  return (
    <div className="space-y-4">
      {table.before && <ReactMarkdown>{table.before}</ReactMarkdown>}
      {wideTable ? (
        <div className="space-y-3">
          {orderedRows.map((row, rowIndex) => (
            <div
              key={`${row.join('|')}-${rowIndex}`}
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {stripMarkdownInline(row[0] || `Entrée ${rowIndex + 1}`)}
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {table.headers.slice(1).map((header, headerIndex) => (
                  <div
                    key={`${header}-${headerIndex}`}
                    className="rounded-md border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/50"
                  >
                    <p className="mb-1 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                      {header}
                    </p>
                    <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                      <ReactMarkdown>{row[headerIndex + 1] || 'Non documenté dans les contextes.'}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                {table.headers.map((header) => (
                  <th
                    key={header}
                    className="border-b border-gray-200 px-3 py-2 align-top font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((row, rowIndex) => (
                <tr key={`${row.join('|')}-${rowIndex}`} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900 dark:even:bg-gray-800/50">
                  {table.headers.map((header, cellIndex) => (
                    <td
                      key={`${header}-${cellIndex}`}
                      className="border-b border-gray-100 px-3 py-2 align-top text-gray-700 dark:border-gray-800 dark:text-gray-300"
                    >
                      <ReactMarkdown>{row[cellIndex] || ''}</ReactMarkdown>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.after && <ReactMarkdown>{table.after}</ReactMarkdown>}
    </div>
  );
}

function warningLabel(warning: string): string {
  switch (warning) {
    case 'internal_ids_removed':
      return 'identifiants internes retirés';
    case 'out_of_scope_contexts_detected':
      return 'sources hors périmètre écartées';
    default:
      return warning.replaceAll('_', ' ');
  }
}

export default function AnswerCard({ data }: AnswerCardProps) {
  const [expandedCtx, setExpandedCtx] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const uniqueContexts = deduplicateContexts(data.contexts);

  const handleCopy = async () => {
    const md = buildMarkdownExport(data, uniqueContexts);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const md = buildMarkdownExport(data, uniqueContexts);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archeoqa-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Question */}
      <div className="bg-gray-50 dark:bg-gray-800 px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <p className="text-gray-700 dark:text-gray-200 font-medium">❓ {data.question}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
            title="Copier en Markdown"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
            title="Télécharger en .md"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <TargetingNotice targeting={data.targeting} />

      {/* Answer */}
      <div className="px-6 py-5">
        <div className="prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert">
          <AnswerMarkdown answer={data.answer} targeting={data.targeting} />
        </div>
      </div>

      {/* Sources */}
      {uniqueContexts.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Sources ({uniqueContexts.length})
            </h3>
          </div>

          <div className="space-y-2">
            {uniqueContexts.map((ctx, idx) => (
              <SourceItem
                key={ctx.id}
                ctx={ctx}
                index={idx + 1}
                expanded={expandedCtx === ctx.id}
                onToggle={() =>
                  setExpandedCtx(expandedCtx === ctx.id ? null : ctx.id)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Cost footer */}
      <div className="bg-gray-50 dark:bg-gray-800 px-6 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-1 text-xs text-gray-400">
        <DollarSign className="w-3 h-3" />
        <span>Cost: ${data.cost.toFixed(4)}</span>
      </div>
    </div>
  );
}

function TargetingNotice({ targeting }: { targeting?: TargetingInfo }) {
  if (!targeting || targeting.mode === 'global') return null;

  if (targeting.mode === 'needs_clarification') {
    const unresolved = targeting.unresolved_mentions ?? [];
    return (
      <div className="px-6 py-3 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
        <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Ciblage à clarifier</p>
            {unresolved.length > 0 && (
              <p className="text-xs mt-1">
                Références non résolues : {unresolved.join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const papers = targeting.resolved_papers ?? [];
  if (papers.length === 0) return null;

  const label = targeting.mode === 'manual_filter'
    ? 'Recherche limitée par filtre manuel'
    : 'Recherche limitée automatiquement';
  const isBalanced = targeting.answer_mode === 'targeted_comparison_balanced';
  const isStructured = targeting.answer_mode === 'targeted_comparison' || isBalanced;
  const warnings = (targeting.warnings ?? []).filter((warning) => warning !== 'internal_ids_removed');

  return (
    <div className="px-6 py-3 border-b border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
      <div className="flex items-start gap-2 text-sm text-emerald-800 dark:text-emerald-200">
        <Target className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold">{label}</p>
          {isStructured && (
            <p className="text-xs mt-1 font-medium">
              {isBalanced ? 'Réponse comparative équilibrée par papier' : 'Réponse comparative structurée'}
            </p>
          )}
          <p className="text-xs mt-1">
            {papers.map(paperLabel).join(', ')}
          </p>
          {warnings.length > 0 && (
            <p className="text-xs mt-1 text-emerald-700 dark:text-emerald-300">
              Validation: {warnings.map(warningLabel).join(', ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceItem({
  ctx,
  index,
  expanded,
  onToggle,
}: {
  ctx: ContextItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shortRef = formatDocname(ctx.text.doc.docname);
  const pages = parsePages(ctx.text.name);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <CitationBadge index={index} score={ctx.score} />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {shortRef}
          </span>
          {pages && (
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
              {pages}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 space-y-2">
          {/* Full citation */}
          {ctx.text.doc.citation && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Citation
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 italic">{ctx.text.doc.citation}</p>
            </div>
          )}

          {/* Context summary */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
              Passage pertinent
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{ctx.context}</p>
          </div>

          {/* Original text excerpt */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
              Extrait original
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-white dark:bg-gray-900 p-2 rounded border dark:border-gray-700 leading-relaxed">
              {ctx.text.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
