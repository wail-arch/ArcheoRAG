import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw, Trash2, Database, HardDrive } from 'lucide-react';
import UploadZone from '../components/UploadZone';
import {
  listPapers,
  indexPapers,
  getIndexedPapers,
  getPaperStats,
  deletePaper,
  type PaperInfo,
  type IndexedPaper,
} from '../hooks/useApi';

export default function LibraryPage() {
  const [papers, setPapers] = useState<PaperInfo[]>([]);
  const [indexed, setIndexed] = useState<IndexedPaper[]>([]);
  const [stats, setStats] = useState<{ num_papers: number; num_chunks: number; index_built: boolean } | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, idx, s] = await Promise.all([listPapers(), getIndexedPapers(), getPaperStats()]);
      setPapers(p);
      setIndexed(idx);
      setStats(s);
    } catch (err) {
      console.error('Failed to load library:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const [indexProgress, setIndexProgress] = useState<{
    current: number;
    total: number;
    paper: string;
  } | null>(null);

  const handleIndex = async () => {
    setIndexing(true);
    setIndexResult(null);
    setIndexProgress(null);

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:8000/api/papers/ws/index`;

    try {
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'progress') {
            setIndexProgress({
              current: msg.current,
              total: msg.total,
              paper: msg.paper,
            });
          } else if (msg.type === 'done') {
            setIndexResult(
              `Indexé ${msg.indexed} papiers — ${msg.total_chunks} chunks`
            );
            setIndexProgress(null);
            resolve();
          } else if (msg.type === 'error') {
            setIndexResult(`Erreur: ${msg.message}`);
            setIndexProgress(null);
            resolve();
          }
        };
        ws.onerror = () => reject(new Error('WebSocket failed'));
        ws.onclose = () => resolve();
      });

      await refresh();
    } catch {
      // Fallback to REST if WebSocket fails
      try {
        const result = await indexPapers();
        setIndexResult(
          `Indexé ${result.indexed.length} papiers — ${result.total_chunks} chunks`
        );
        await refresh();
      } catch (err: any) {
        setIndexResult(`Erreur: ${err.message || 'Indexation échouée'}`);
      }
    }
    setIndexing(false);
    setIndexProgress(null);
  };

  const handleDelete = async (filename: string) => {
    try {
      await deletePaper(filename);
      await refresh();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Bibliothèque</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Gérez vos PDFs et indexez-les pour la recherche
          </p>
        </div>

        <button
          onClick={handleIndex}
          disabled={indexing || papers.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${indexing ? 'animate-spin' : ''}`} />
          {indexing ? 'Indexation...' : 'Indexer tout'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={FileText} label="PDFs" value={papers.length} />
          <StatCard icon={Database} label="Papiers indexés" value={stats.num_papers} />
          <StatCard icon={HardDrive} label="Chunks" value={stats.num_chunks} />
        </div>
      )}

      {/* Index progress bar */}
      {indexing && indexProgress && indexProgress.total > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700 dark:text-gray-200 font-medium">
              Indexation {indexProgress.current}/{indexProgress.total}
            </span>
            <span className="text-gray-500 dark:text-gray-400 text-xs truncate ml-2">
              {indexProgress.paper}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div
              className="bg-amber-500 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${(indexProgress.current / indexProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Index result message */}
      {indexResult && (
        <div className={`px-4 py-3 rounded-lg text-sm ${
          indexResult.startsWith('Erreur')
            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
        }`}>
          {indexResult}
        </div>
      )}

      {/* Upload zone */}
      <UploadZone onUploaded={refresh} />

      {/* PDF list */}
      <div>
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-3">
          Fichiers PDF ({papers.length})
        </h2>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Chargement...</div>
        ) : papers.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            Aucun PDF. Uploadez des articles pour commencer.
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {papers.map((paper) => {
              const isIndexed = indexed.some(
                (i) => i.docname.includes(paper.filename.replace('.pdf', ''))
              );
              return (
                <div
                  key={paper.filename}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {paper.filename}
                      </p>
                      <p className="text-xs text-gray-400">
                        {paper.size_mb} MB
                        {isIndexed && (
                          <span className="ml-2 text-green-600">● Indexé</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(paper.filename)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-amber-500" />
        <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  );
}
