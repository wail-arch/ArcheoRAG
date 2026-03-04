import { Loader2, Search, BookOpen, PenTool, CheckCircle, AlertCircle } from 'lucide-react';
import type { WSStatus, WSStage } from '../hooks/useWebSocket';

interface StatusBarProps {
  status: WSStatus;
}

const stageConfig: Record<WSStage, { icon: typeof Loader2; color: string; label: string }> = {
  idle: { icon: CheckCircle, color: 'text-gray-400', label: '' },
  connecting: { icon: Loader2, color: 'text-blue-500', label: 'Connexion...' },
  searching: { icon: Search, color: 'text-blue-500', label: 'Recherche dans les documents...' },
  gathering: { icon: BookOpen, color: 'text-amber-500', label: 'Analyse des preuves...' },
  answering: { icon: PenTool, color: 'text-purple-500', label: 'Rédaction de la réponse...' },
  done: { icon: CheckCircle, color: 'text-green-500', label: 'Terminé' },
  error: { icon: AlertCircle, color: 'text-red-500', label: 'Erreur' },
};

export default function StatusBar({ status }: StatusBarProps) {
  if (status.stage === 'idle') return null;

  const config = stageConfig[status.stage];
  const Icon = config.icon;
  const isAnimating = !['idle', 'done', 'error'].includes(status.stage);

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
      <Icon className={`w-5 h-5 ${config.color} ${isAnimating ? 'animate-spin' : ''}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${config.color}`}>
          {status.message || config.label}
        </p>
        {status.progress > 0 && status.progress < 1 && (
          <div className="mt-1 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${status.progress * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
