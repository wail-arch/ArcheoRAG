# ArcheoRAG Handoff

## Current State
The system now has:
- PaperQA-managed persistent indexing.
- CUDA local embedding support for faster indexing.
- Stable paper filtering and strict paper targeting.
- Targeted comparative answers with structured cards.
- Citation cleanup for raw PaperQA chunk references.
- Evidence Matrix V1 with quality metadata and researcher curation.
- Matrix UI with filters, evidence expansion, notes, and verification.
- Lightweight paper manifest in `archeoqa/data/analysis/paper_manifest.json`, derived from the index and Evidence Matrix without LLM calls.
- Compare Selected Papers button in Chat, using the existing manual `paper_filter`.
- Compare button supports a user-specified angle when the input box is filled; otherwise it uses the standard broad comparison prompt.
- Selected comparisons now use balanced per-paper retrieval plus optional Matrix assistance. Matrix notes guide retrieval/synthesis only; final citations still come from PaperQA contexts.

## Recently Fixed
- Manual paper filters no longer leak into unrelated papers.
- Questions like `Compare Pereira 2010 et Fregel 2017` auto-resolve papers.
- Ambiguous or missing paper references return clarification with cost `0.0`.
- Comparison cards preserve the paper order from the question.
- Fregel-style aDNA comparisons are prompted to separate IAM, KEB, and TOR.
- Pereira-style papers are framed as phylogeographic/demographic inference from modern mtDNA, not direct archaeological proof.
- Failed PaperQA index entries are retried instead of being silently skipped by "continue indexing".
- Ambiguous mention suggestions now include likely candidates, e.g. `Fran 2017` suggests `François 2018 — La genèse du langage et des langues` instead of searching globally.
- Balanced selected-paper comparisons retrieve evidence per paper, filter obvious bibliography/reference contexts when alternatives exist, and prevent source leakage.
- Matrix-assisted comparison was validated qualitatively: the Matrix-assisted three-paper answer was more complete on data types and methodological limits than the non-assisted baseline, while still citing PaperQA sources.

## Known UX Issues
- The Chat paper filter currently displays PaperQA-extracted titles when available, not always the PDF filename. Example: the PDF `Ancient genomes from North Africa evidence prehistoric migrations to the Maghreb from both the Levant and Europe.pdf` appears as `Neolithization of North Africa involved the migration of people from both the Levant and Europe (2017)`. This is technically correct metadata, but confusing for users who search by filename.
- Local unpushed UI work has started to improve the paper filter: alphabetical sorting, larger dropdown, and full-title tooltips. Before pushing, test whether this is enough or whether the filter should show `Author Year — title` plus `PDF: filename`.

## Known Local Runtime Files
Do not commit:
- `archeoqa/data/indexes/`
- `archeoqa/data/index_metadata.json`
- `archeoqa/data/analysis/*.json`
- uploaded PDFs in `archeoqa/data/papers/`
- `archeoqa/data/settings.json`

## Recommended Next Tests
Use the normal Compare button for selected-paper comparisons. For Fregel/Pereira, select:
```text
Neolithization of North Africa involved the migration of people from both the Levant and Europe (2017)
Population expansion in the North African Late Pleistocene signalled by mitochondrial DNA haplogroup U6 (2010)
```

Then test the Compare button with empty input and with a specific angle:
```text
sur la chronologie des migrations
```

```text
sur les types de données utilisées : mtDNA moderne, aDNA, autosomal
```

For Matrix-assisted comparison, also test with:
```text
Genetics and the African past
```

and this angle:
```text
sur les types de données utilisées et les limites méthodologiques
```

Expected targeting badges: manual/auto targeted search, balanced comparative answer, and `Assistée par matrice` when Matrix rows are available.

Then test broad corpus questions:
```text
Compare les preuves archéologiques et génétiques utilisées pour discuter les migrations préhistoriques vers le Maghreb.
```

## Next Product Step
Do not spend more quota finishing the remaining Matrix rows unless needed. Next likely product steps are Matrix cheap mode / selected-paper Matrix build, then Gap Finder or Difference Finder on top of the Matrix and manifest.
