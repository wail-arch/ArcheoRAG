import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { BookOpen, ChevronDown, ChevronUp, Copy, Download, DollarSign, Check } from 'lucide-react';
import type { AskResponse, ContextItem } from '../hooks/useApi';
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
  let md = `## Question\n${data.question}\n\n## Réponse\n${data.answer}\n\n## Sources\n`;
  contexts.forEach((ctx, i) => {
    const ref = formatDocname(ctx.text.doc.docname);
    const pages = parsePages(ctx.text.name);
    const cite = ctx.text.doc.citation || ref;
    md += `${i + 1}. ${cite}${pages ? ` — ${pages}` : ''}\n   > ${ctx.context}\n\n`;
  });
  md += `---\nCoût: $${data.cost.toFixed(4)}\n`;
  return md;
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

      {/* Answer */}
      <div className="px-6 py-5">
        <div className="prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert">
          <ReactMarkdown>{data.answer}</ReactMarkdown>
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
