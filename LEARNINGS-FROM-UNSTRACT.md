# Learnings from Unstract

Analysis of [Zipstack/unstract](https://github.com/Zipstack/unstract) and what
we should borrow, skip, or stay deliberately different on.

## What Unstract is

Open-source no-code platform for unstructured-to-structured extraction. Built
on Django/Python — different stack from ours, but the product shape overlaps.
Their core architectural pillars:

| Pillar | What it is |
|---|---|
| **Prompt Studio** | No-code UI: write *one natural-language prompt per field* ("Extract the policy number"). LLM does all extraction. |
| **Challenge mode** | Second LLM call validates the first to reduce hallucinations. |
| **LLMWhisperer** | Their commercial PDF→LLM-friendly text preprocessor. |
| **Adapters** (X2Text / LLM / Vector DB / Embeddings) | Pluggable interfaces for swapping providers. |
| **Highlighter** | UI shows where each extracted value came from in the source PDF, with bounding boxes. |
| **Workflows + tools** | Chain extractions, route to outputs (DB, S3, webhook, API). |
| **Output connectors** | Push results to MySQL, Postgres, Snowflake, S3, REST webhooks. |
| **Multi-tenant orgs** | First-class organizations, RBAC, project model. |
| **Vector DB / RAG** | For very long documents — chunk, embed, retrieve before LLM. |
| **Prompt versioning + diffing** | A/B test prompts per field. |
| **Multimodal docs** | PDF + image + Word treated uniformly. |

## What we should borrow (in priority order)

### 1. Source Highlighter — **shipping now**

Unstract's "trust signal" feature: every extracted value is shown with a
colored box on the source PDF. Massive credibility boost during demos and
during user corrections. We have all the data we need (`source_text` on every
record from T1.C, plus `column_index` + token range from training mappings).

### 2. Challenge mode for AI cells — *next sprint*

When the deterministic engine produces a low-confidence cell and AI
escalation kicks in, today we send one LLM call. Challenge mode sends two:
"extract X" then "verify that X is …". Accept only when both agree.
Doubles the cost but kills hallucinations. Worth it as a Settings toggle.

### 3. Output connectors — *near term*

Beyond CSV: S3 upload, webhook POST, "send via email", "drop in folder".
What agency users will ask for once they've extracted real data. One per
release.

### 4. Prompt-per-field training mode — *medium term*

Alternative to click-train. Some testers will prefer "write a sentence
describing what you want" over "click on the row." Keep both modes; the
user picks per template. Hooks into the AI provider abstraction (T2.A).

### 5. Multi-page record stitching — *medium term*

Records that span across a page break. Smart "this record continues" logic,
not full RAG.

### 6. Highlight + correct in one motion — *medium term*

Click a value in the Data Grid → see it boxed on the source PDF → drag the
box if wrong → that becomes a correction event AND a training signal
(closes T1.C Layer 2 from the visual side).

## What we explicitly skip

- **Vector DB / RAG.** Commission statements are 1–10 pages. Anthropic's
  200K context window swallows them whole. Operational burden not justified.
- **Full plugin SDK / external tool authoring.** Premature.
- **LLMWhisperer-style preprocessing service.** Their commercial moat;
  Anthropic's native PDF beta moots most of the need for us.
- **Multimodal everything.** Stay PDF-focused until traction says otherwise.

## Where DocuStruct stays deliberately different

These are the choices that make us *not* a clone of Unstract:

1. **Deterministic-first, AI-as-fallback.**
   Unstract is LLM-first; every extraction starts with a model call. We run
   a free deterministic engine first and only escalate to AI for the cells
   that need it. Cheaper at scale, faster, more predictable, and pleasant
   for clean tabular PDFs that don't need AI at all.

2. **Click-to-train with sub-cell token selection.**
   Unstract's primary training UX is prompt authoring. We let users *click*
   on the right token, with shift-click for ranges. This is faster for
   visual learners and produces deterministic mappings that don't drift.

3. **Correction propagation + position-recovery learning.**
   We turn user corrections into:
   - Same-batch fixes ("apply to N matching rows")
   - New training samples (the engine learns the canonical position)
   - User-controlled re-extraction (just-this-file vs all-files)

   Unstract logs corrections but doesn't close the loop the same way.

4. **Per-(template, field) success counters drive confidence.**
   Our confidence number is `1 − corrections/extractions`, not a
   heuristic. Visible accuracy badges per field on the Templates page.

5. **BYO-key as a first-class concept.**
   Tenants paste their OpenAI/Anthropic key, see their MTD spend, set a
   budget cap, and we never proxy their tokens. Unstract supports BYO key
   too but it's not as central.

## Roadmap impact

Adding Source Highlighter now slots in alongside the existing tracks:

- **T-Source.A** — server: per-cell bounding boxes from canonical column
  layout. Source endpoint returns `{file_url, page, boxes: [...]}`.
- **T-Source.B** — client: `<PdfPagePreview>` component using `pdfjs-dist`.
  Side drawer in Data Grid. Optional tab in Training.
- **T-Source.C** *(later)* — drag-to-correct. Adjusting a box becomes a
  training-update event.

Challenge mode (#2 above) and Output connectors (#3) drop in as future Track
2 / Track 4 items respectively. Multi-tenancy (Track 3) remains medium
priority per your call.

## Decisions log

- **2026-05-02** Source Highlighter is the next concrete Unstract-inspired
  feature; LEARNINGS-FROM-UNSTRACT.md captures this analysis so it's not
  lost.
- We stay PDF-first and deterministic-first. Unstract's model is broader and
  heavier; ours is narrower and tighter.
