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

## Recently Fixed
- Manual paper filters no longer leak into unrelated papers.
- Questions like `Compare Pereira 2010 et Fregel 2017` auto-resolve papers.
- Ambiguous or missing paper references return clarification with cost `0.0`.
- Comparison cards preserve the paper order from the question.
- Fregel-style aDNA comparisons are prompted to separate IAM, KEB, and TOR.
- Pereira-style papers are framed as phylogeographic/demographic inference from modern mtDNA, not direct archaeological proof.

## Known Local Runtime Files
Do not commit:
- `archeoqa/data/indexes/`
- `archeoqa/data/index_metadata.json`
- `archeoqa/data/analysis/*.json`
- uploaded PDFs in `archeoqa/data/papers/`
- `archeoqa/data/settings.json`

## Recommended Next Tests
Use Rapid mode first for targeted paper comparisons:
```text
Compare African Past et Pereira 2010 : quelles différences méthodologiques et interprétatives présentent-ils ?
```

```text
Compare uniquement Pereira 2010 et Fregel 2017 sous forme de tableau : hypothèse, données, période, population/source, limite.
```

Then test broad corpus questions:
```text
Compare les preuves archéologiques et génétiques utilisées pour discuter les migrations préhistoriques vers le Maghreb.
```

## Next Product Step
Before Gap Finder, finish evaluating comparative Q&A quality across several paper pairs. After that, build a dedicated Compare Selected Papers flow that retrieves and summarizes each selected paper separately before synthesis.
