# DocuStruct Roadmap

Single source of truth for the strategic direction. Last revised April 2026.

## Product thesis

A layered, self-improving extraction engine wrapped in a multi-tenant
white-label SaaS. AI is a strategic differentiator but used **selectively**:
deterministic extraction stays free, fast and reliable; AI escalates only
when cheaper layers can't confidently answer.

Three principles that constrain every architectural decision:

1. **AI is a layer, not a substitute.** Deterministic extraction always runs
   first. AI is opt-in escalation.
2. **AI is pluggable.** Tenants bring their own keys and pick their own
   provider (OpenAI, Anthropic, Azure, Google, Ollama, …). We never
   pass-through their tokens or lock them in.
3. **Architecture is multi-tenant from day one.** Every domain concept is
   conceptually owned by an organization. Adding `organization_id` later is
   mechanical; rebuilding business logic that assumed single-tenancy is not.

## Extraction tier model

| Layer | Cost | What it does | When |
|---|---|---|---|
| **L1 — Deterministic** | Free, ms | Token slice, anchor reads, type cleaners. Today's engine. | Always first. |
| **L2 — Learned patterns** | Free, ms | Per-(template, field) historical patterns, correction-derived rules, confidence model. | When L1 confidence < threshold AND a learned pattern exists. |
| **L3 — AI fallback** | $$, seconds | LLM call with column context, surrounding row, field type, allowed values. | When L1 + L2 still can't confidently answer AND tenant has AI configured AND budget allows. |

Cell-level cache: hash `(template_id, field_id, normalized_cell_text, surrounding_context)` → result. Same cell text on the next import is free.

## Where AI earns its keep

High-value, low-volume tasks worth a model call:

1. **Hostile PDF rescue** — vision-capable LLM reads BCBS-style scrambled text PDFs.
2. **Ambiguous-cell extraction** — when L1+L2 confidence is low for a cell.
3. **Auto-template suggestion** — given 1–3 unlabeled PDFs, propose a starter template.
4. **Correction generalization** — when a user corrects N rows, ask the LLM to generalize the rule, then propagate.
5. **Field-type inference** — auto-suggest field types in template creation.

What we **don't** use AI for: clean tabular extraction (token slice already works), value cleaning (regex is fine), confidence math, repeated cells (cache).

## AI provider abstraction

```
AIService
├── ProviderRegistry
│   ├── OpenAIAdapter      (gpt-4o, gpt-4o-mini)
│   ├── AnthropicAdapter   (claude-sonnet, haiku)
│   ├── AzureOpenAIAdapter
│   ├── GoogleAdapter      (gemini)
│   └── OllamaAdapter      (local, free)
├── PromptBuilder      (per task type)
├── ResponseParser     (structured JSON)
├── Cache              (LRU + persisted)
├── CostMeter          (tokens × price)
└── BudgetGuard        (daily / monthly caps)
```

Per-tenant configuration: `provider`, encrypted `api_key`, `model`, `confidence_threshold`, `max_calls_per_import`, `monthly_budget_usd`. Default for unconfigured tenants: deterministic-only — graceful degradation.

## Multi-tenancy without paying for it now

The data model and middleware behave as if multi-tenancy is already there:

- Every domain table ships with `organization_id` from the start. Single-tenant dev sets `org_id = 1`.
- Settings live in `(organization_id, key)`. AI config is one such key.
- Secrets (API keys) live in `org_secrets`, encrypted with a server-side key.
- A `current_org` request context wraps every query.

When real multi-tenancy lands, we add: auth (sessions/JWT), org-creation flow, RBAC, branding fields, custom domains. **No business logic changes.**

## Three tracks

Each phase ships independently.

### Track 1 — Self-improving engine

- **T1.A** Multi-sample training: templates have N samples; engine picks the best-performing pattern per field. *(in flight)*
- **T1.B** Per-(template, field) success/error counters → real confidence score replaces heuristics.
- **T1.C** Correction propagation: "apply this fix to N matching rows" prompt; persist correction patterns; apply on future imports.
- **T1.D** Review queue surfacing low-confidence rows; user corrections feed back into the success counters.

### Track 2 — AI integration

- **T2.A** Provider abstraction skeleton + Settings UI for BYO key. No real calls yet. *(in flight)*
- **T2.B** OpenAI + Anthropic adapters; confidence-triggered AI escalation hook in the engine; cell-level cache.
- **T2.C** Cost meter + monthly budget guard + per-import call cap; visible in Settings and on the Status page.
- **T2.D** Auto-template suggestion (LLM reads N PDFs, proposes template).
- **T2.E** Hostile-PDF rescue (vision LLM for BCBS-style PDFs).

### Track 3 — Multi-tenant SaaS foundation

- **T3.A** `organization_id` columns + tenancy middleware.
- **T3.B** Auth (email + password, SSO later), session management, RBAC (admin / operator / viewer).
- **T3.C** Postgres migration path (SQLite stays for local dev).
- **T3.D** S3-compatible file storage abstraction (local FS for dev).
- **T3.E** White-label branding (logo, colors, app name, custom domain).
- **T3.F** Agency hierarchy (agency → sub-orgs).
- **T3.G** Usage events + Stripe metered billing.

## Current sprint

Phases in flight: **T1.A** (multi-sample training) + **T2.A** (AI scaffold).

Demo story at end of sprint: *"It learns from each PDF you train it on and the AI service is ready to plug in."*

## Status (track by track)

- T1.A — **shipped** (multi-sample training)
- T1.B — **shipped** (per-field success / error / AI counters; field accuracy badge in Templates)
- T1.C — **shipped** (Layer 1: same-batch correction propagation. Source row text persisted per record; corrections propose other matching rows; one-click batch-apply. Layer 2: corrections promote to a new training sample using canonical column / token recovery; user picks "re-extract this file" / "re-extract all files for this template" / skip; manual corrections preserved across re-extractions)
- T1.D — **shipped** (Review queue page surfaces records below threshold; inline corrections)
- T2.A — **shipped** (provider abstraction skeleton + Settings UI)
- T2.B — **shipped** (HTTP wiring for OpenAI / Anthropic / Ollama, async escalation pass, mock-provider integration test)
- T2.C — **shipped** (AI cost surfaced on Status page: provider, MTD spend, recent calls, cache hits)
- T2.D — **shipped** (auto-template suggestion: upload N PDFs → LLM proposes a starter template you edit and create)
- T2.E — **shipped** (AI vision rescue. Anthropic Claude takes the PDF natively as a `document` block and returns structured rows. Toggle on Review + Import. Handles multi-line / scanned / hostile PDFs all in one path. Cost logged per call.)
- T-Train — **shipped** (training UX guardrails. Inline type-validation warnings ("RAY, JENNIFER doesn't look like a date"). Cross-row consistency hint when other rows in the same column have more tokens. Pre-save check via confirm modal flagging unmapped primary fields, single-field maps, and type mismatches.)
- T-Source.A/B — **shipped** (Source Highlighter. New `/api/data/records/:id/source` endpoint computes per-cell bounding boxes from the canonical column layout. Client `PdfPagePreview` renders the PDF page via pdfjs-dist with colored SVG overlays. Side drawer in Data Grid opens on a per-row "View source" click. Borrowed from Unstract — see `LEARNINGS-FROM-UNSTRACT.md`.)
- T-Source.v2 — **shipped** (Side-by-side layout: field cards on the left, PDF viewer on the right. Multi-page nav (◀ / ▶ / page input / total). Zoom controls (+/−/Fit). Click a field card → PDF jumps to that box and emphasises it; click a box on the PDF → field card highlights. Esc / backdrop / × close the drawer. Drawer widens to 96vw / 1280px to give the PDF real estate.)
- T-Onboard — **shipped** (AI Onboarding Wizard. Schema v6 adds `extraction_strategy` ['ai_vision' | 'manual'], `ai_prompt`, `ai_provider`, `ai_model` to `templates`. Default for new templates is `ai_vision`. Wizard flow: upload 1-3 PDFs + optional natural-language hint → AI proposes name + fields → vision pass extracts a preview from the first PDF → user reviews / edits / confirms → template is created and the same PDFs are imported as the first batch. Future imports auto-route through `visionRescueWithAI` using the saved per-template prompt; the deterministic engine is bypassed entirely for AI templates. Existing v5 templates are dropped on migration per product decision. Manual click-train remains as a secondary path; the AI prompt is editable post-creation under Templates → Edit.)
- T3.* — planned, single-tenant for now

## Decisions log

- **2026-04-29** AI is layered escalation, not substitute. Deterministic + learned patterns first; AI only when needed.
- **2026-04-29** BYO key from day one. Settings encrypted at rest. Default config = no AI.
- **2026-04-29** Architecture is multi-tenant-shaped before multi-tenancy ships. Every domain table will carry `organization_id`.
- **2026-04-29** BCBS-style PDFs deferred to T2.E (vision-LLM rescue) — not text-extractable in their current form.
- **2026-05-08** New default = AI onboarding. Templates created via the wizard run AI vision on every import using a saved per-template prompt. Manual click-train still supported via the "Manual template" button, but it's no longer the front door. Existing v5 templates were wiped on migration to keep the demo coherent.
