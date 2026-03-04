import { useEffect, useState } from 'react';
import { Save, CheckCircle, AlertCircle, Key, Cpu, Sliders } from 'lucide-react';
import { getSettings, updateSettings, type AppSettings } from '../hooks/useApi';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Editable fields
  const [llm, setLlm] = useState('');
  const [summaryLlm, setSummaryLlm] = useState('');
  const [embedding, setEmbedding] = useState('');
  const [enrichmentLlm, setEnrichmentLlm] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [perplexityKey, setPerplexityKey] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const s = await getSettings();
      setSettings(s);
      setLlm(s.llm);
      setSummaryLlm(s.summary_llm);
      setEmbedding(s.embedding);
      setEnrichmentLlm(s.enrichment_llm);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const update: Record<string, unknown> = {};
      if (llm !== settings?.llm) update.llm = llm;
      if (summaryLlm !== settings?.summary_llm) update.summary_llm = summaryLlm;
      if (embedding !== settings?.embedding) update.embedding = embedding;
      if (enrichmentLlm !== settings?.enrichment_llm) update.enrichment_llm = enrichmentLlm;
      if (openaiKey) update.openai_api_key = openaiKey;
      if (googleKey) update.google_api_key = googleKey;
      if (perplexityKey) update.perplexity_api_key = perplexityKey;

      const updated = await updateSettings(update);
      setSettings(updated);
      setOpenaiKey('');
      setGoogleKey('');
      setPerplexityKey('');
      setMessage({ type: 'success', text: 'Paramètres sauvegardés' });
    } catch (err: any) {
      setMessage({ type: 'error', text: `Erreur: ${err.message || 'Sauvegarde échouée'}` });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Chargement des paramètres...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 max-w-3xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Paramètres</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configurez les modèles LLM et les clés API
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* Models section */}
      <Section icon={Cpu} title="Modèles">
        <Field label="LLM Générateur" value={llm} onChange={setLlm} hint="Pour les réponses (ex: gpt-5, claude-opus-4.6-20250514)" />
        <Field label="LLM Résumé" value={summaryLlm} onChange={setSummaryLlm} hint="Pour résumer les preuves" />
        <Field label="Embedding" value={embedding} onChange={setEmbedding} hint="Modèle d'embedding (ex: text-embedding-3-large)" />
        <Field label="LLM Enrichissement (Vision)" value={enrichmentLlm} onChange={setEnrichmentLlm} hint="Pour OCR + description d'images (ex: gemini/gemini-3-pro)" />
      </Section>

      {/* API Keys section */}
      <Section icon={Key} title="Clés API">
        <Field
          label="OpenAI API Key"
          value={openaiKey}
          onChange={setOpenaiKey}
          type="password"
          placeholder={settings?.has_openai_key ? '••••••••  (configurée)' : 'sk-...'}
          hint="Pour GPT-5 et embeddings OpenAI"
        />
        <Field
          label="Google AI API Key"
          value={googleKey}
          onChange={setGoogleKey}
          type="password"
          placeholder={settings?.has_google_key ? '••••••••  (configurée)' : 'AIza...'}
          hint="Pour Gemini 3 Pro (enrichissement visuel)"
        />
        <Field
          label="Perplexity API Key"
          value={perplexityKey}
          onChange={setPerplexityKey}
          type="password"
          placeholder={settings?.has_perplexity_key ? '••••••••  (configurée)' : 'pplx-...'}
          hint="Pour pplx-embed embeddings (optionnel)"
        />
      </Section>

      {/* Info section */}
      <Section icon={Sliders} title="Info">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Dossier PDFs:</span>
            <p className="font-mono text-xs text-gray-700 dark:text-gray-300 mt-1">{settings?.papers_dir}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Multimodal:</span>
            <p className="text-gray-700 dark:text-gray-300 mt-1">{settings?.multimodal}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Sources max:</span>
            <p className="text-gray-700 dark:text-gray-300 mt-1">{settings?.answer_max_sources}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Evidence K:</span>
            <p className="text-gray-700 dark:text-gray-300 mt-1">{settings?.evidence_k}</p>
          </div>
        </div>
      </Section>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors font-medium"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
      </div>
    </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <Icon className="w-5 h-5 text-amber-600" />
        <h2 className="font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-800 outline-none transition-all text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500"
      />
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
