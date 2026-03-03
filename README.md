# ArcheoQA

**Local RAG platform for archaeology researchers** — ask questions about your PDF collection and get cited answers powered by PaperQA2.

[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](https://fastapi.tiangolo.com/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

<!-- Add a screenshot here: ![ArcheoQA Screenshot](docs/screenshot.png) -->

---

## Features

- **Cited Q&A** — two modes: Direct (fast, single-pass) and Agent (iterative search + gather + answer loop)
- **Real-time streaming** — WebSocket-based status updates as the system searches, gathers evidence, and generates answers
- **Paper filtering** — scope questions to specific papers via a multi-select dropdown
- **Dark mode** — system-preference detection + manual toggle, persisted across sessions
- **Export answers** — copy to clipboard or download as Markdown with full citations
- **Persistent chat history** — conversations survive page refreshes (localStorage, max 50 entries)
- **Drag & drop upload** — add PDFs directly from the browser
- **Indexation progress bar** — WebSocket-streamed progress, paper by paper
- **Cumulative cost tracking** — session cost displayed in the sidebar
- **Clickable suggestions** — pre-built archaeology questions to get started

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **LLM** | GPT-5.2 (OpenAI) |
| **Embeddings** | text-embedding-3-large (OpenAI) |
| **Enrichment** | Gemini 3 Pro (Google AI — OCR + vision) |
| **PDF Parsing** | Docling (GPU-accelerated) |
| **RAG Engine** | [PaperQA2](https://github.com/Future-House/paper-qa) by FutureHouse |
| **Backend** | FastAPI + Uvicorn + WebSockets |
| **Frontend** | React 19 + TypeScript + Tailwind CSS v4 + Vite |
| **Routing** | React Router v7 |
| **Icons** | Lucide React |

---

## Architecture

```
archeoqa/
├── backend/                  # FastAPI backend
│   ├── app.py                # Entry point
│   ├── api/
│   │   ├── routes_qa.py      # POST /api/ask + WebSocket /api/ws/ask
│   │   ├── routes_papers.py  # CRUD papers + WebSocket /api/ws/index
│   │   └── routes_settings.py
│   └── services/
│       ├── qa_service.py     # PaperQA2 Docs wrapper + agent
│       └── config.py         # Model settings (GPT-5.2, embeddings, etc.)
│
├── frontend/                 # React SPA
│   └── src/
│       ├── pages/            # ChatPage, LibraryPage, SettingsPage
│       ├── components/       # AnswerCard, ChatInput, Sidebar, etc.
│       └── hooks/            # useWebSocket, useApi
│
├── data/
│   └── papers/               # Drop your PDFs here
│
└── .env                      # API keys (not committed)
```

---

## Prerequisites

- **Python** >= 3.11
- **Node.js** >= 18
- **OpenAI API key** (required — for GPT-5.2 + embeddings)
- **Google AI API key** (optional — enables Gemini 3 Pro for OCR/vision enrichment of figures and tables)
- **GPU recommended** — Docling PDF parsing benefits from CUDA (tested on RTX 3070 Ti)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/archeoqa.git
cd archeoqa
```

### 2. Configure API keys

```bash
cp .env.example .env
```

Edit `.env` and add your keys:

```env
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...          # optional
PERPLEXITY_API_KEY=...      # optional
```

### 3. Install backend

```bash
# Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate   # Linux/Mac
# .venv\Scripts\activate    # Windows

# Install all dependencies (includes PaperQA2 + Docling + FastAPI)
pip install -r backend/requirements.txt
```

### 4. Install frontend

```bash
cd frontend
npm install
cd ..
```

### 5. Start the app

Open two terminals:

```bash
# Terminal 1 — Backend (port 8000)
uvicorn backend.app:app --port 8000

# Terminal 2 — Frontend (port 5173)
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Quick Start

1. **Add PDFs** — drop PDF files into `data/papers/` or use the drag & drop zone in the Library page
2. **Index** — click "Index All" in the Library page and wait for the progress bar to complete
3. **Ask** — go to Chat, type a question (or click a suggestion), and get a cited answer

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-5.2 and embeddings |
| `GOOGLE_API_KEY` | No | Google AI key for Gemini 3 Pro (OCR + vision enrichment) |
| `PERPLEXITY_API_KEY` | No | Perplexity key (alternative embeddings) |
| `PAPERS_DIR` | No | Custom path for PDFs (default: `./data/papers`) |

### UI Settings

Visit the **Settings** page (`/settings`) to configure:

- LLM model (generator + summary)
- Embedding model
- Enrichment model
- Evidence count and max sources
- Temperature

Settings are persisted in `data/settings.json`.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/papers` | List PDF files in papers directory |
| `POST` | `/api/papers/upload` | Upload a PDF |
| `POST` | `/api/papers/index` | Index all PDFs |
| `GET` | `/api/papers/indexed` | List indexed papers with docnames |
| `DELETE` | `/api/papers/{filename}` | Delete a PDF |
| `POST` | `/api/ask` | Ask a question (REST) |
| `WS` | `/api/ws/ask` | Ask a question (streaming) |
| `WS` | `/api/ws/index` | Stream indexation progress |
| `GET` | `/api/settings` | Get current settings |
| `PUT` | `/api/settings` | Update settings |
| `GET` | `/health` | Health check |

Interactive API docs available at [http://localhost:8000/docs](http://localhost:8000/docs).

---

## License

This project is built on top of [PaperQA2](https://github.com/Future-House/paper-qa) by [FutureHouse](https://www.futurehouse.org/), licensed under the [Apache License 2.0](LICENSE).

---

## Acknowledgments

- [PaperQA2](https://github.com/Future-House/paper-qa) — the RAG engine powering ArcheoQA
- [Docling](https://github.com/DS4SD/docling) — high-quality PDF parsing with table/figure extraction
- [LiteLLM](https://github.com/BerriAI/litellm) — unified LLM API routing
