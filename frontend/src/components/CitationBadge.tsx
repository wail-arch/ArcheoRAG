interface CitationBadgeProps {
  index: number;
  score: number;
  onClick?: () => void;
}

export default function CitationBadge({ index, score, onClick }: CitationBadgeProps) {
  // Color based on relevance score
  const getScoreColor = (score: number) => {
    if (score >= 8) return 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700';
    if (score >= 5) return 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600';
  };

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity ${getScoreColor(score)}`}
      title={`Pertinence: ${score}/10`}
    >
      <span>{index}</span>
      <span className="font-bold">{score}/10</span>
    </button>
  );
}
