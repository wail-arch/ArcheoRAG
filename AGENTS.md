# ArcheoRAG Agent Memory

## Project Goal
ArcheoRAG is a local archaeology research assistant built on PaperQA2. PaperQA remains the retrieval and citation engine; ArcheoRAG adds reliable local indexing, paper targeting, evidence extraction, researcher curation, and PhD-oriented comparison workflows.

## Core Reliability Rules
- Never answer from model memory when a paper/context is required.
- Preserve PaperQA citations and keep answers grounded in retrieved contexts.
- If a user names papers, resolve them to indexed papers before retrieval. If resolution is ambiguous, ask for clarification instead of searching the whole corpus.
- Filtered or targeted answers must not leak sources from unselected papers.
- Prefer clear refusal or clarification over a plausible answer from the wrong documents.
- Local index files, papers, settings, and analysis JSON are runtime data and should not be committed.

## Current Architecture
- Backend: FastAPI in `archeoqa/backend`.
- Frontend: Vite/React in `archeoqa/frontend`.
- Paper storage: `archeoqa/data/papers`.
- PaperQA index storage: `archeoqa/data/indexes` local only.
- Evidence Matrix persistence: `archeoqa/data/analysis/*.json` local only.
- Main QA service: `archeoqa/backend/services/qa_service.py`.
- Paper resolver: `archeoqa/backend/services/paper_resolver.py`.
- Evidence Matrix service: `archeoqa/backend/services/analysis_service.py`.
- Paper manifest service: `archeoqa/backend/services/paper_manifest_service.py`; it derives runtime metadata in `archeoqa/data/analysis/paper_manifest.json` from the index and Evidence Matrix without LLM calls.
- Selected-paper comparisons use a balanced per-paper retrieval path in `qa_service.py`: gather evidence separately for each selected/resolved paper, keep sources isolated to those papers, then synthesize the final comparison.
- The balanced comparison path has a conservative context-quality filter to drop bibliography/reference-like contexts only when enough better contexts remain for the same paper.
- Matrix-assisted comparisons may use Evidence Matrix/manifest notes as non-citable guidance, but final answers must still cite PaperQA contexts only and must fall back cleanly when Matrix data is missing.

## Development Commands
Backend:
```powershell
cd C:\Users\Wail\Desktop\archeorag
.\archeoqa\.venv\Scripts\python.exe -m uvicorn archeoqa.backend.app:app --reload --port 8000
```

Frontend:
```powershell
cd C:\Users\Wail\Desktop\archeorag\archeoqa\frontend
npm run dev
```

Validation:
```powershell
.\archeoqa\.venv\Scripts\python.exe -m compileall archeoqa\backend
cd archeoqa\frontend
npm run lint
npm run build
```

## GPU / Indexing Notes
- Local embedding defaults to `st-multi-qa-MiniLM-L6-cos-v1` with CUDA when available.
- PaperQA managed directory index is used; later Index All runs should sync/skip unchanged papers.
- Full rebuild is only for changed indexing config or explicit rebuild.
- Use the project venv for backend commands; using a different Python/PaperQA install can make the app report that the index must be rebuilt even when the index is valid.
- Evidence Matrix builds are expensive because they run multiple PaperQA/LLM passes per paper. Do not rebuild it casually; use partial existing Matrix data when possible.
- For targeted Matrix completion, prefer selected-paper cheap builds from the Matrix page. Cheap mode builds only chosen papers with one combined extraction pass and preserves existing rows unless force is requested.

## Product Direction
The next research features should build on the Evidence Matrix instead of rereading PDFs repeatedly:
- Gap Finder
- Similarity Finder
- Difference Finder
- Contradiction Detector
