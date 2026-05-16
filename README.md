# DocuStruct

Local-first, self-service PDF data standardization. Define a template, train it from one
sample PDF by selecting the values that belong to each field, preview the extraction,
bulk import more PDFs, review and correct results, and export structured data.

## Why

Every insurance carrier publishes commission statements in a different layout, but the
underlying data is conceptually similar (policy number, policyholder, effective date,
commission amount, etc.). DocuStruct lets a non-developer point at a sample PDF, label
the values once, and then process every PDF that follows the same shape.

## Architecture

```
docustruct/
├── server/                  Express + SQLite + extraction engine
│   ├── data/
│   │   ├── docustruct.sqlite     (created on first run)
│   │   ├── uploads/              (PDF storage)
│   │   └── samples/              (bundled sample PDFs)
│   └── src/
│       ├── index.js              Express app entrypoint
│       ├── db.js                 SQLite setup + schema
│       ├── routes/               REST endpoints
│       └── extraction/           PDF extraction engine
└── client/                  Vite + React (plain CSS)
    └── src/
        ├── App.jsx
        ├── api.js                fetch wrapper
        └── pages/                Templates, Training, Review,
                                  Import, Status, DataGrid
```

## Quick start

```
# Backend
cd server
npm install
npm run dev          # http://localhost:4000

# Frontend (new terminal)
cd client
npm install
npm run dev          # http://localhost:5173
```

The client proxies `/api` to the server, so you can use the UI without setting any
environment variables.

## Workflow

1. **Templates** — create a template (organization, state, category, year) and define
   the output fields you want, with field types (text, number, date, amount).
2. **Training** — upload one sample PDF and click on the values that map to each field.
   DocuStruct stores the raw selection plus inferred anchors and row patterns.
3. **Review** — re-run extraction on the sample PDF and confirm the result. Correct any
   wrong values; corrections are saved against the template.
4. **Import** — bulk upload more PDFs that share the same layout. Each upload is a
   processing batch with per-document status.
5. **Status** — watch processing progress and inspect any documents flagged as needing
   OCR or as failed.
6. **Data Grid** — browse extracted records across PDFs, filter by template /
   organization / year / status / date, and export CSV.

## Extraction strategy

1. Parse the PDF to text. Lines are normalized; whitespace is collapsed.
2. For each field, use the saved training selection to infer:
   - an **anchor** (a stable nearby string, like a column header or label), and
   - a **row pattern** (column position, regex shape) for repeating rows.
3. If the trained sample line maps multiple fields at once, treat it as a transaction
   row and scan the PDF for repeated rows that match the pattern.
4. If the trained primary field repeats across pages, split the PDF into record blocks.
5. If neither applies, fall back to document-level field extraction (one value per PDF).
6. Clean values by field type and return record-level data with field-level source
   metadata, warnings, and confidence.

## MVP boundaries

- Text-based PDFs are supported now.
- Scanned / image-only PDFs are detected and marked as needing OCR (engine is the next
  layer).
- No specialized table extraction yet — column inference is heuristic.
- Training currently learns from one sample. Future versions should learn stronger rules
  from repeated user corrections.
