import { useCallback, useState } from 'react';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { uploadPaper } from '../hooks/useApi';

interface UploadZoneProps {
  onUploaded?: () => void;
}

export default function UploadZone({ onUploaded }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const pdfs = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) {
        setMessage({ type: 'error', text: 'Seuls les fichiers PDF sont acceptés' });
        return;
      }

      setUploading(true);
      setMessage(null);

      let successCount = 0;
      for (const file of pdfs) {
        try {
          await uploadPaper(file);
          successCount++;
        } catch (err: any) {
          setMessage({ type: 'error', text: `Erreur: ${err.message || 'Upload échoué'}` });
        }
      }

      if (successCount > 0) {
        setMessage({
          type: 'success',
          text: `${successCount} PDF${successCount > 1 ? 's' : ''} uploadé${successCount > 1 ? 's' : ''}`,
        });
        onUploaded?.();
      }

      setUploading(false);
    },
    [onUploaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
        isDragging
          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
          : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 hover:border-gray-400 dark:hover:border-gray-500'
      }`}
      onClick={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf';
        input.multiple = true;
        input.onchange = (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files) handleFiles(files);
        };
        input.click();
      }}
    >
      {uploading ? (
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Upload en cours...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Upload className="w-10 h-10 text-gray-400" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-semibold text-amber-600 dark:text-amber-400">Cliquez</span> ou glissez vos PDFs ici
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">PDF uniquement</p>
        </div>
      )}

      {message && (
        <div
          className={`mt-3 flex items-center gap-2 justify-center text-sm ${
            message.type === 'success' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}
    </div>
  );
}
