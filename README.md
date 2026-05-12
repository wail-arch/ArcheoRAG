# ArcheoRAG / ArcheoQA

Local research assistant for archaeology papers, built on top of
[PaperQA2](https://github.com/Future-House/paper-qa). It indexes a local PDF
corpus, answers with citations, supports strict paper targeting, and adds a
curatable Evidence Matrix for corpus-level research work.

[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](https://fastapi.tiangolo.com/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

> Status: active research prototype. Core indexing, cited Q&A, paper targeting,
> comparative answers, and Evidence Matrix curation are implemented. Gap finding,
> similarity/difference workflows, and contradiction detection are planned next.

---

## Features

- **PaperQA2-backed cited Q&A** with rapid and agent modes.
- **Persistent managed index** using PaperQA's directory index under
  `archeoqa/data/indexes`.
- **Incremental indexing**: unchanged files are skipped, new PDFs are added, and
  deleted PDFs are removed after sync.
- **Full rebuild/reset controls** for index corruption or changed core settings.
- **Strict paper targeting**: questions like `Compare Pereira 2010 et Fregel 2017`
  are resolved to indexed papers before retrieval. If resolution is ambiguous,
  the backend asks for clarification instead of silently searching the whole
  corpus.
- **Structured comparative answers** for targeted multi-paper questions, with
  normalized citations and no internal PaperQA IDs in the UI.
- **Manual paper filter** in Chat, still taking priority over auto-targeting.
- **Evidence Matrix** that extracts archaeology metadata per indexed paper:
  regions, sites, periods, date ranges, methods, materials, evidence types,
  claims, limits, uncertainties, and supporting contexts.
- **Researcher curation** for the matrix: edit/delete extracted items, add notes,
  verify rows/fields, and preserve manual corrections across rebuilds.
- **French UI** with Library, Chat, Matrix, and Settings pages.
- **Local GPU-friendly embeddings** through SentenceTransformers when CUDA is
  available.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| RAG engine | PaperQA2 |
| Backend | FastAPI, Uvicorn, WebSockets |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| LLM routing | LiteLLM |
| Default LLM | `gpt-5.2` |
| Default embeddings | `st-multi-qa-MiniLM-L6-cos-v1` via SentenceTransformers |
| PDF parsing | PaperQA/Docling integration |
| Persistence | Local files under `archeoqa/data/` |

---

## Repository Layout

```text
ArcheoRAG/
├── AGENTS.md                 # Agent/developer operating notes
├── HANDOFF.md                # Current project state and next steps
├── ENGINEERING_GUIDE.md      # Engineering quality guide
├── README.md
└── archeoqa/
    ├── backend/
    │   ├── app.py
    │   ├── api/
    │   │   ├── routes_qa.py
    │   │   ├── routes_papers.py
    │   │   ├── routes_analysis.py
    │   │   └── routes_settings.py
    │   └── services/
    │       ├── qa_service.py
    │       ├── paper_resolver.py
    │       ├── paper_service.py
    │       ├── analysis_service.py
    │       └── config.py
    ├── frontend/
    │   └── src/
    │       ├── pages/
    │       ├── components/
    │       ├── hooks/
    │       └── utils/
    └── data/
        ├── papers/           # Local PDFs, ignored by Git except .gitkeep
        ├── indexes/          # PaperQA index, ignored by Git
        └── analysis/         # Matrix JSON/overrides, ignored by Git
```

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- OpenAI API key for answer generation
- Optional Google AI API key for multimodal/enrichment paths
- Optional NVIDIA GPU + CUDA PyTorch for faster local embeddings/indexing

Runtime data, indexes, PDFs, local settings, and `.env` files are ignored by Git.

---

## Installation

### 1. Clone

```bash
git clone https://github.com/wail-arch/ArcheoRAG.git
cd ArcheoRAG/archeoqa
```

### 2. Configure environment

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```env
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...          # optional
PERPLEXITY_API_KEY=...      # optional
PAPERS_DIR=./data/papers
```

### 3. Install backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

On Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

For CUDA acceleration, install a CUDA-enabled PyTorch build in the same virtual
environment, then verify:

```powershell
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

### 4. Install frontend

```bash
cd frontend
npm install
cd ..
```

---

## Run Locally

Open two terminals from `ArcheoRAG/archeoqa`.

Backend:

```bash
uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Quick backend checks:

```powershell
curl.exe http://127.0.0.1:8000/health
curl.exe http://127.0.0.1:8000/api/papers/stats
curl.exe http://127.0.0.1:8000/api/analysis/matrix/status
```

---

## Typical Workflow

1. Put PDFs in `archeoqa/data/papers/` or upload them from the Library page.
2. Click **Indexer tout**.
3. Ask general questions in Chat, or select/cite specific papers for strict
   paper-targeted answers.
4. Build the **Matrice** after indexing to extract structured evidence.
5. Review/edit/verify matrix rows before relying on them for future gap,
   similarity, or difference analysis.

Indexing is persistent. You do not need to re-index everything on every app
start. Re-run **Indexer tout** to sync changes, or **Reconstruire** when the app
marks a rebuild as required.

---

## Configuration

Environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Key used by LiteLLM/OpenAI models |
| `GOOGLE_API_KEY` | No | Enables Google enrichment model paths |
| `PERPLEXITY_API_KEY` | No | Reserved optional provider key |
| `PAPERS_DIR` | No | PDF directory, default `./data/papers` |
| `PQA_INDEX_DIR` | No | PaperQA index directory, default `./data/indexes` |
| `LOCAL_EMBEDDING_DEVICE` | No | `cuda` by default for local SentenceTransformers |
| `LOCAL_EMBEDDING_BATCH_SIZE` | No | Batch size for local embeddings, default `64` |

Settings changed from the UI are merged into `archeoqa/data/settings.json`.
Changing core indexing settings marks the index/matrix stale instead of silently
reusing incompatible data.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/papers` | List PDFs in the papers directory |
| `POST` | `/api/papers/upload` | Upload a PDF |
| `DELETE` | `/api/papers/{filename}` | Delete a PDF and mark/sync index state |
| `POST` | `/api/papers/index` | Sync the PaperQA directory index |
| `POST` | `/api/papers/rebuild` | Clear and rebuild the PaperQA index |
| `GET` | `/api/papers/indexed` | List indexed papers with stable identifiers |
| `GET` | `/api/papers/stats` | Index stats, readiness, stale/rebuild metadata |
| `WS` | `/api/ws/index` | Stream indexing progress |
| `POST` | `/api/ask` | Ask a question over REST |
| `WS` | `/api/ws/ask` | Ask a streaming question |
| `GET` | `/api/settings` | Read safe settings metadata |
| `PUT` | `/api/settings` | Merge settings updates |
| `GET` | `/api/analysis/matrix/status` | Matrix availability/staleness status |
| `GET` | `/api/analysis/matrix` | Read persisted matrix rows |
| `POST` | `/api/analysis/matrix/build` | Build or refresh the matrix |
| `POST` | `/api/analysis/matrix/reset` | Clear generated matrix rows |
| `PATCH` | `/api/analysis/matrix/rows/{file_location}` | Apply curation edits/notes |
| `POST` | `/api/analysis/matrix/rows/{file_location}/verify` | Verify a row or field |

Interactive docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

---

## Reliability Notes

- Explicit paper-targeted questions never fall back silently to global retrieval.
- If a cited paper mention is unresolved or ambiguous, the API returns a
  clarification response with cost `0`.
- Targeted comparison answers validate that displayed citations belong to the
  resolved or manually selected papers.
- Evidence Matrix extraction keeps only items supported by retrieved PaperQA
  contexts and records quality/curation metadata.
- Manual matrix corrections are stored separately from generated extraction and
  reapplied after rebuilds.

---

## Development Checks

Backend:

```powershell
py -3 -m compileall archeoqa\backend
py -3 -c "from archeoqa.backend.app import app; print(app.title); print(len(app.routes))"
```

Frontend:

```powershell
cd archeoqa\frontend
npm run lint
npm run build
```

Git secret-sensitive local data should remain ignored:

```powershell
git check-ignore -v archeoqa\.env archeoqa\data\settings.json archeoqa\data\indexes\test archeoqa\data\analysis\evidence_matrix.json archeoqa\data\papers\test.pdf
```

---

## Roadmap

- [x] PaperQA managed persistent indexing
- [x] Strict paper resolver and targeted retrieval
- [x] Structured targeted comparison answers
- [x] Evidence Matrix V1
- [x] Evidence Matrix curation and verification
- [ ] Dedicated selected-paper comparison action
- [ ] Gap Finder using the Evidence Matrix
- [ ] Similarity and difference finder
- [ ] Contradiction detector
- [ ] Zotero/import integrations

---

## License

This project is built on top of [PaperQA2](https://github.com/Future-House/paper-qa)
by [FutureHouse](https://www.futurehouse.org/) and is licensed under the
[Apache License 2.0](LICENSE).

---

## Acknowledgments

- [PaperQA2](https://github.com/Future-House/paper-qa) for the RAG engine.
- [Docling](https://github.com/docling-project/docling) for PDF parsing support
  through the PaperQA stack.
- [LiteLLM](https://github.com/BerriAI/litellm) for model routing.
