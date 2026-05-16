// Seed three carrier templates and their training mappings using bundled sample
// PDFs. Run with: npm run seed
//
// To use your own sample PDFs, drop them into server/data/samples/ with these
// canonical filenames (or set the env vars below to absolute paths):
//
//   MESSER_SAMPLE   -> messer_aetna_renewal.pdf
//   HCSC_SAMPLE     -> hcsc_bcbs_commission.pdf
//   IHA_SAMPLE      -> iha_ambetter_commissions.pdf
import fs from 'node:fs';
import path from 'node:path';
import { db, SAMPLES_DIR, UPLOADS_DIR, getTemplate } from './db.js';
import { extractText, buildColumns, findColumnIndexForCell } from './extraction/pdfText.js';

// Each seed defines:
//   - the template (name, fields with types)
//   - a `rowAnchor` string that uniquely identifies the prototype row
//   - per-field cell descriptors: a substring of the prototype row plus
//     occurrence index (1-based) used when the same value appears multiple
//     times (e.g. two "$5.00" cells)
const samples = [
  {
    key: 'messer_aetna',
    file: process.env.MESSER_SAMPLE || path.join(SAMPLES_DIR, 'messer_aetna_renewal.pdf'),
    template: {
      name: 'Messer Renewal Statement (Aetna)',
      organization: 'Messer Financial Group',
      state: 'ALL',
      category: 'Commission Statement',
      year: 2025,
      notes: 'Tabular renewal statement, one row per policy.',
      fields: [
        { name: 'policy_no',      label: 'Policy No',     type: 'text',   is_primary: true },
        { name: 'policyholder',   label: 'Policyholder',  type: 'text' },
        { name: 'product',        label: 'Product',       type: 'text' },
        { name: 'writing_agent',  label: 'Writing Agent', type: 'text' },
        { name: 'effective_date', label: 'Effective',     type: 'date' },
        { name: 'paid_to_date',   label: 'Paid-To',       type: 'date' },
        { name: 'premium',        label: 'Premium',       type: 'amount' },
        { name: 'rate',           label: 'Rate',          type: 'number' },
        { name: 'credit',         label: 'Credit',        type: 'amount' },
        { name: 'debit',          label: 'Debit',         type: 'amount' },
      ],
    },
    rowAnchor: 'RAY, JENNIFER',
    cells: {
      policy_no:      { token: 'NG101596946900',     occurrence: 1, header: 'Policy No.' },
      policyholder:   { token: 'RAY, JENNIFER',      occurrence: 1, header: 'Policyholder' },
      product:        { token: 'Aetna ACA',          occurrence: 1, header: 'Product' },
      writing_agent:  { token: 'PRZYBYLSKI, HEATHER',occurrence: 1, header: 'Writing Agent' },
      effective_date: { token: '01/01/2023',         occurrence: 1, header: 'Effective' },
      paid_to_date:   { token: '10/31/2025',         occurrence: 1, header: 'Paid-To' },
      premium:        { token: '$5.00',              occurrence: 1, header: 'Premium' },
      rate:           { token: '100.00%',            occurrence: 1, header: 'Rate' },
      credit:         { token: '$5.00',              occurrence: 2, header: 'Credit' },
      debit:          { token: '$0.00',              occurrence: 1, header: 'Debit' },
    },
  },
  {
    key: 'hcsc_bcbs',
    file: process.env.HCSC_SAMPLE || path.join(SAMPLES_DIR, 'hcsc_bcbs_commission.pdf'),
    template: {
      name: 'HCSC / BlueCross BlueShield Commission Detail',
      organization: 'Health Care Service Corporation',
      state: 'TX',
      category: 'Commission Detail',
      year: 2025,
      notes: 'Multi-line records grouped by producer.',
      fields: [
        { name: 'account_policy', label: 'Acct/Policy',   type: 'text', is_primary: true },
        { name: 'account_name',   label: 'Acct/Pol Name', type: 'text' },
        { name: 'orig_eff_dt',    label: 'Orig Eff Dt',   type: 'date' },
        { name: 'contracts',      label: 'Contracts',     type: 'number' },
        { name: 'split_pct',      label: 'Split %',       type: 'number' },
        { name: 'pol_mos',        label: 'Pol Mos',       type: 'number' },
        { name: 'pd_from_dt',     label: 'Pd From Dt',    type: 'date' },
        { name: 'comm_amt',       label: 'Comm Amt',      type: 'amount' },
      ],
    },
    rowAnchor: 'GATES',
    cells: {
      account_policy: { token: '0943059850',      occurrence: 1, header: 'Acct/Policy' },
      account_name:   { token: 'GATES',           occurrence: 1, header: 'Acct/Pol Name' },
      orig_eff_dt:    { token: '02/01/25',        occurrence: 1, header: 'Orig Eff Dt' },
      contracts:      { token: '1',               occurrence: 1, header: 'Contracts' },
      split_pct:      { token: '100.00',          occurrence: 1, header: 'Split %' },
      pol_mos:        { token: '1',               occurrence: 2, header: 'Pol' },
      pd_from_dt:     { token: '02/01/25',        occurrence: 2, header: 'Pd From Dt' },
      comm_amt:       { token: '$25.00',          occurrence: 1, header: 'Comm Amt' },
    },
  },
  {
    key: 'iha_ambetter',
    file: process.env.IHA_SAMPLE || path.join(SAMPLES_DIR, 'iha_ambetter_commissions.pdf'),
    template: {
      name: 'IHA Agent Commissions (Ambetter)',
      organization: 'Independent Health Agents',
      state: 'ALL',
      category: 'Commission Statement',
      year: 2025,
      notes: 'Grouped by primary agent with subtotals; transactions are flat rows.',
      fields: [
        { name: 'receive_date',   label: 'Receive Date', type: 'date' },
        { name: 'billing_date',   label: 'Billing Date', type: 'date' },
        { name: 'carrier_name',   label: 'Carrier',      type: 'text' },
        { name: 'policy_type',    label: 'Policy Type',  type: 'text' },
        { name: 'policy_number',  label: 'Policy #',     type: 'text', is_primary: true },
        { name: 'effective_date', label: 'Effective',    type: 'date' },
        { name: 'client_name',    label: 'Client',       type: 'text' },
        { name: 'transaction',    label: 'Transaction',  type: 'text' },
        { name: 'agent_comm',     label: 'Agent Comm',   type: 'amount' },
      ],
    },
    rowAnchor: 'Joyner, Tommie',
    cells: {
      receive_date:   { token: '08/25/2025',     occurrence: 1, header: 'Receive Date' },
      billing_date:   { token: '07/01/2025',     occurrence: 1, header: 'Billing Date' },
      carrier_name:   { token: 'Ambetter',       occurrence: 1, header: 'CarrierName' },
      policy_type:    { token: 'MED',            occurrence: 1, header: 'Policy Type' },
      policy_number:  { token: 'U70740259',      occurrence: 1, header: 'Policy Number' },
      effective_date: { token: '08/01/2024',     occurrence: 1, header: 'Effective Date' },
      client_name:    { token: 'Joyner, Tommie', occurrence: 1, header: 'ClientName' },
      transaction:    { token: 'Commission',     occurrence: 1, header: 'Transaction' },
      agent_comm:     { token: '$40.000',        occurrence: 1, header: 'Agent Comm' },
    },
  },
];

async function seedOne(seed) {
  if (!fs.existsSync(seed.file)) {
    console.warn(`  ! Skipping ${seed.template.name} — sample PDF not found at ${seed.file}`);
    return;
  }
  const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(seed.template.name);
  if (existing) {
    console.log(`  - Already exists: ${seed.template.name} (id=${existing.id})`);
    return;
  }

  const insertTpl = db.prepare(
    `INSERT INTO templates(name, organization, state, category, year, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertField = db.prepare(
    `INSERT INTO fields(template_id, name, label, type, is_primary, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const tplId = insertTpl.run(
    seed.template.name,
    seed.template.organization,
    seed.template.state,
    seed.template.category,
    seed.template.year,
    seed.template.notes
  ).lastInsertRowid;

  seed.template.fields.forEach((f, i) =>
    insertField.run(tplId, f.name, f.label, f.type, f.is_primary ? 1 : 0, i)
  );

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const targetName = `seed_${seed.key}_${path.basename(seed.file)}`;
  const target = path.join(UPLOADS_DIR, targetName);
  fs.copyFileSync(seed.file, target);

  const sampleId = db
    .prepare(
      `INSERT INTO training_samples(template_id, file_path, original_name)
       VALUES (?, ?, ?)`
    )
    .run(tplId, targetName, path.basename(seed.file)).lastInsertRowid;

  const parsed = await extractText(target);
  const protoLine = parsed.lines.find((l) => l.text.includes(seed.rowAnchor));
  if (!protoLine) {
    console.warn(`  ! Could not find row anchor "${seed.rowAnchor}" in ${seed.template.name}`);
    return;
  }

  const protoColumns = buildColumns(protoLine);
  const mappingInsert = db.prepare(
    `INSERT INTO training_mappings
       (sample_id, field_id, selection_text, prototype_line_text,
        column_index, line_index, page_index, anchor_text, anchor_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const fields = db
    .prepare('SELECT id, name FROM fields WHERE template_id = ? ORDER BY sort_order')
    .all(tplId);

  let mapped = 0;
  let missing = [];
  for (const f of fields) {
    const cell = seed.cells[f.name];
    if (!cell) continue;
    const colIdx = findColumnIndexForCell(protoColumns, cell.token, cell.occurrence || 1);
    if (colIdx == null) {
      missing.push(`${f.name}=${cell.token}#${cell.occurrence || 1}`);
    }
    mappingInsert.run(
      sampleId,
      f.id,
      cell.token,
      protoLine.text,
      colIdx, // null is fine — extractor falls back to text matching
      protoLine.lineIndex,
      protoLine.pageIndex,
      cell.header || null,
      cell.header ? 'header' : null
    );
    if (colIdx != null) mapped++;
  }

  console.log(
    `  + Seeded ${seed.template.name} (id=${tplId}, ${mapped}/${fields.length} columns mapped)` +
      (missing.length ? `  [unmatched: ${missing.join(', ')}]` : '')
  );
}

async function main() {
  console.log('Seeding DocuStruct templates…');
  for (const seed of samples) {
    await seedOne(seed);
  }
  const t = getTemplate(1);
  if (t) console.log('Done. Run `npm run extract` for a quick verification, or start the server.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
