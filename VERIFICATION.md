# Verification

## AI Onboarding Wizard (latest)

Manual checklist for the new flow:

```
# 1. Schema migrates cleanly (existing DB at v5)
cd server && node src/index.js
#    -> log shows "DocuStruct listening on ..." with no error
#    -> sqlite3 data/docustruct.sqlite "SELECT value FROM schema_meta;"
#       returns 6
#    -> sqlite3 data/docustruct.sqlite "SELECT COUNT(*) FROM templates;"
#       returns 0  (existing templates were wiped per product decision)

# 2. Wizard happy path
#    Open the UI, click "Create with AI" on the Templates page
#    a. Upload 1-3 PDFs, type an optional hint, click "Analyze with AI"
#    b. Confirm review screen shows: proposed name, fields, preview rows
#       extracted from the first PDF, editable extraction prompt
#    c. Click "Create template"
#    d. Lands on /data?template=<new id> with the imported records visible

# 3. Future imports use the saved AI prompt
#    Go to Imports, pick the new template, upload another PDF
#    -> import runs through visionRescue (no deterministic engine path)
#    -> Status page logs an AI call with task=visionRescue

# 4. Edit template -> AI prompt is editable
#    Templates -> Edit -> "AI extraction prompt" textarea
#    Tweak it, save, re-extract one document, confirm new behavior
```

The "Manual" template path is preserved as the secondary action ("Manual
template" button on the Templates page); manual templates do NOT route
through vision unless the user explicitly toggles `?ai_vision=1` on import.

## What's tested in-tree

Two zero-dependency test scripts run against the engine internals. They don't
need `npm install` — Node ≥ 18 is enough.

```
cd server
node src/extraction/cleaners.test.mjs   # 17 cases (text / number / amount / date)
node src/extraction/engine.test.mjs     # column-detection + row-mode end-to-end on synthetic lines
```

Latest run in this build:

```
Cleaner tests: 17/17 passed
  ✓ buildColumns + findColumnIndexForCell handle the messer row
  ✓ row mode produced 3 records with cleaned values
Engine synthetic tests passed.
```

The synthetic test for the engine constructs three rows shaped like the Messer
PDF (policy / holder / date / amount), saves a 4-field row prototype with
`column_index` per field, and confirms the engine emits **three** records with
the right values cleaned by type — including `$5.00 → 5` and
`01/01/2023 → 2023-01-01`.

The synthetic test for `buildColumns` covers the trickiest case in the Messer
layout: two `$5.00` columns (premium and credit) being identified as separate
columns and resolved by occurrence index.

## Verifying against the real PDFs

To run the engine end-to-end on your three sample PDFs:

```
cd server
npm install
mkdir -p data/samples
# Copy the three sample PDFs from your knowledge folder into data/samples
# with these exact names:
#   data/samples/messer_aetna_renewal.pdf
#   data/samples/hcsc_bcbs_commission.pdf
#   data/samples/iha_ambetter_commissions.pdf
npm run seed       # creates the DB, copies samples into uploads, saves training mappings
npm run extract    # runs extraction against each seeded template, prints per-row sample
```

Or set `MESSER_SAMPLE`, `HCSC_SAMPLE`, `IHA_SAMPLE` env vars to point at any
absolute paths.

Then start the dev servers:

```
# terminal 1
cd server && npm run dev          # Express on :4000

# terminal 2
cd client && npm install && npm run dev   # Vite on :5173
```

Open http://localhost:5173 and visit **Data Grid** to see records, **Review**
to test extraction interactively, or **Status** to watch import progress.

## Per-PDF expectations

Each template was seeded with explicit `column_index` and `occurrence` values
chosen so that ambiguous repeated cells are resolved correctly.

### Messer Renewal (Aetna) — row mode
- Prototype anchor: `RAY, JENNIFER` (page 1).
- Engine should emit **~30 records** (the renewal table on pages 1–2).
- Repeated `$5.00` cells are differentiated: premium = 1st occurrence,
  credit = 2nd occurrence on the prototype row.
- Extra non-row lines (totals, "End of Statement", page header) are filtered
  out by `isCandidateRow` (date+numeric token-shape filter).

### HCSC / BCBS Commission Detail — known difficult, partially supported
- **Multi-line records.** Each policy occupies *two* visual lines (account /
  acct-name / orig-eff / calc-method / contracts / pol-mos / pd-from-dt /
  comm-amt / product on top, and group-no / product-name / pr-eff /
  funding-type / pd-to-dt / comm-rate / ytd-premium / ytd-commission
  underneath). The current engine treats each visual line as its own
  record — so expect ~2× the record count and many half-empty rows. A
  proper fix needs sub-cell training to declare "the row directly below
  also belongs to this record". Tracked as a follow-up.
- **Tight line spacing** previously caused the line clusterer to merge text
  from completely different parts of the page (e.g. footers + data rows).
  Mitigated by lowering `LINE_TOLERANCE` to 0.3 and adapting downward to
  one-third of the page's median y-gap. If you still see clearly wrong
  clustering, run `npm run inspect -- /path/to/file.pdf --page N` from the
  `server/` folder to see the raw item coordinates and the detected line
  structure.
- For now, train on simpler 1-line layouts where possible. The engine works
  but the data quality is poor for HCSC-style PDFs until multi-line records
  ship.

### IHA Agent Commissions (Ambetter) — row mode
- Prototype anchor: `Joyner, Tommie` (page 1).
- ~40 transaction rows across the two pages. Agent subtotal headers
  (alphabetic only, no dates / amounts) are filtered out.

## Known limitations (MVP boundaries)

These match the spec — surfaced here so they're explicit:

1. **Multi-line records (HCSC).** The engine treats each visual row as a
   record. It doesn't yet stitch two-line records into one. Workarounds: use
   the Review screen to spot-check, or train a different field set that's
   readable from one line.
2. **Group headers (IHA agent subtotals).** Filtered out by shape, but if a
   group header happens to share the row shape it could leak through. The
   data grid's per-cell confidence flags low-confidence values.
3. **Scanned PDFs.** Marked `needs_ocr` and skipped — OCR is the next engine
   layer.
4. **Different layouts within the same template.** Column inference is per
   PDF (each row gets its own `buildColumns`), but if a row has a missing
   column (e.g., a sparse "credit" cell), the column index can shift. The
   shape filter avoids most of these but they can produce empty cells.

## Sanity checks beyond the engine

- `node --check src/index.js` — confirms the Express entrypoint parses.
- The SQLite schema is recreated idempotently from `db.js`'s
  `CREATE TABLE IF NOT EXISTS` block; deleting `data/docustruct.sqlite` is a
  safe reset.
