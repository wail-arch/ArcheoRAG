/**
 * WebSocket hook for streaming Q&A with status updates.
 */

import { useCallback, useRef, useState } from 'react';
import type { AskResponse } from './useApi';

export type WSStage = 'idle' | 'connecting' | 'searching' | 'gathering' | 'answering' | 'done' | 'error';

export interface WSStatus {
  stage: WSStage;
  message: string;
  progress: number;
}

export interface UseWebSocketReturn {
  status: WSStatus;
  result: AskResponse | null;
  error: string | null;
  ask: (question: string, useAgent?: boolean, paperFilter?: string[]) => void;
  isLoading: boolean;
}

export function useQAWebSocket(): UseWebSocketReturn {
  const [status, setStatus] = useState<WSStatus>({
    stage: 'idle',
    message: '',
    progress: 0,
  });
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const ask = useCallback((question: string, useAgent = false, paperFilter?: string[]) => {
    // Reset state
    setResult(null);
    setError(null);
    setStatus({ stage: 'connecting', message: 'Connecting...', progress: 0 });

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/ask`;

    // Close previous connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus({ stage: 'searching', message: 'Sending question...', progress: 0.1 });
      ws.send(JSON.stringify({ question, use_agent: useAgent, paper_filter: paperFilter || null }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status':
          setStatus({
            stage: data.stage as WSStage,
            message: data.message,
            progress: data.progress,
          });
          break;

        case 'answer':
          setResult(data.data as AskResponse);
          setStatus({ stage: 'done', message: 'Answer ready', progress: 1 });
          ws.close();
          break;

        case 'error':
          setError(data.message);
          setStatus({ stage: 'error', message: data.message, progress: 0 });
          ws.close();
          break;
      }
    };

    ws.onerror = () => {
      setError('Connexion échouée — le backend ne répond pas. Lancez : uvicorn backend.app:app --port 8000');
      setStatus({ stage: 'error', message: 'Connexion échouée', progress: 0 });
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, []);

  const isLoading = !['idle', 'done', 'error'].includes(status.stage);

  return { status, result, error, ask, isLoading };
}
