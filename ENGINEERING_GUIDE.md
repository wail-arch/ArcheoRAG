# Engineering Guide For ArcheoRAG

## Work Style
- Make small, testable changes.
- Keep PaperQA as the retrieval authority; add ArcheoRAG reliability layers around it.
- Treat wrong-paper retrieval as a critical bug.
- Prefer deterministic logic for routing, filtering, filename safety, and paper resolution.
- Use LLMs for synthesis, not for deciding which files are allowed.

## Research UX Standards
- Answers for PhD workflows should be auditable, not just fluent.
- Every claim should be traceable to a visible source.
- Comparisons should separate hypothesis, evidence, method, period, limitation, and interpretation.
- If a field is absent from contexts, say it is not documented.
- Do not hide uncertainty. Surface it as a useful research signal.
- Evidence Matrix/manifest data can guide retrieval and synthesis, but it is not a citable source in final answers. Cite PaperQA contexts only.

## Frontend Standards
- Build the usable research workflow, not marketing pages.
- Keep dense research interfaces readable and scannable.
- Prefer structured cards/tables for comparisons.
- Avoid horizontal scrolling for normal reading workflows.
- Never show technical IDs like `pqac-*`, dockeys, hashes, or chunk ids to normal users.

## Backend Standards
- Keep file paths inside configured data directories.
- Sanitize upload/delete filenames.
- Preserve local persistence; do not force users to re-index every startup.
- Treat settings changes that affect indexing as stale-index events.
- Keep JSON storage acceptable for v1 research artifacts; move to SQLite only after schemas stabilize.
- Treat Evidence Matrix as optional enhancement data. Core Q&A and Compare must still work when Matrix/manifest files are missing or incomplete.
- Avoid expensive Matrix rebuilds during debugging; prefer using existing partial Matrix data, retrying failed rows, or building selected papers once those workflows exist.

## Git Hygiene
- Do not commit local PDFs, indexes, settings, or generated analysis JSON.
- Run backend compile and frontend lint/build before pushing when possible.
- Use clear commit messages that describe behavior, not just files.
