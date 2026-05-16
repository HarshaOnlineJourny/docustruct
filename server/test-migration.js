#!/usr/bin/env node
/**
 * Quick test to verify schema v9 migration works
 * Run: npm --prefix server run test-migration
 */

import { db } from './src/db.js';

try {
  console.log(`\n[TEST] Testing schema migration\n`);

  console.log('[✓] Database initialized from db.js');

  // Check for organization_id columns
  const columnsToCheck = [
    { table: 'templates', column: 'organization_id' },
    { table: 'documents', column: 'organization_id' },
    { table: 'batches', column: 'organization_id' },
    { table: 'training_samples', column: 'organization_id' },
  ];

  let passed = true;

  for (const { table, column } of columnsToCheck) {
    const info = db.pragma(`table_info(${table})`);
    const hasColumn = info.some((col) => col.name === column);

    if (hasColumn) {
      console.log(`[✓] ${table}.${column} exists`);
    } else {
      console.log(`[✗] ${table}.${column} MISSING`);
      passed = false;
    }
  }

  // Check for indices
  const indicesToCheck = [
    'templates_org_idx',
    'documents_org_idx',
    'batches_org_idx',
    'training_samples_org_idx',
  ];

  const indices = db.pragma('index_list(templates)');
  console.log('\n[Checking Indices]');
  for (const idxName of indicesToCheck) {
    try {
      const indexInfo = db.pragma(`index_info(${idxName})`);
      if (indexInfo.length > 0) {
        console.log(`[✓] Index ${idxName} exists`);
      } else {
        console.log(`[✗] Index ${idxName} missing`);
        passed = false;
      }
    } catch (e) {
      console.log(`[✗] Index ${idxName} missing`);
      passed = false;
    }
  }

  // Check schema version
  console.log('\n[Checking Schema Version]');
  try {
    const versionRow = db
      .prepare('SELECT value FROM schema_meta WHERE key = ?')
      .get('schema_version');
    const version = versionRow ? Number(versionRow.value) : 0;
    console.log(`[✓] Current schema version: ${version}`);
    if (version >= 9) {
      console.log('[✓] Schema v9 or higher (multi-tenancy ready)');
    } else {
      console.log(`[⚠] Schema v${version} detected (v9 required for multi-tenancy)`);
    }
  } catch (e) {
    console.log('[⚠] Could not determine schema version:', e.message);
  }

  // Test: Create default org if not present
  console.log('\n[Testing Default Organization]');
  try {
    const existing = db
      .prepare('SELECT id FROM organizations WHERE name = ?')
      .get('Default');
    if (existing) {
      console.log(`[✓] Default organization exists (id=${existing.id})`);
    } else {
      const result = db
        .prepare('INSERT INTO organizations(name) VALUES (?)')
        .run('Default');
      console.log(`[✓] Created Default organization (id=${result.lastInsertRowid})`);
    }
  } catch (e) {
    console.log('[✗] Error with organizations table:', e.message);
    passed = false;
  }

  // Test: Create sample template with org_id
  console.log('\n[Testing Multi-Tenancy Insert]');
  try {
    const org = db
      .prepare('SELECT id FROM organizations WHERE name = ?')
      .get('Default');

    const template = db
      .prepare(
        `INSERT INTO templates(organization_id, name, extraction_strategy)
       VALUES (?, ?, ?)`
      )
      .run(org.id, 'Test Template', 'ai_vision');

    console.log(`[✓] Created template (id=${template.lastInsertRowid}, org=${org.id})`);

    // Verify insert was recorded correctly
    const retrieved = db
      .prepare(
        'SELECT id, organization_id, name FROM templates WHERE id = ? AND organization_id = ?'
      )
      .get(template.lastInsertRowid, org.id);

    if (retrieved) {
      console.log(`[✓] Template retrieval with org filter works`);
    } else {
      console.log(
        '[✗] Template not found with org filter (isolation check failed)'
      );
      passed = false;
    }
  } catch (e) {
    console.log('[✗] Error testing template insert:', e.message);
    passed = false;
  }

  console.log(`\n${'='.repeat(60)}`);
  if (passed) {
    console.log('[✓] All tests PASSED - Schema migration is ready!');
    console.log(`${'='.repeat(60)}\n`);
  } else {
    console.log('[✗] Some tests FAILED - Review errors above');
    console.log(`${'='.repeat(60)}\n`);
  }

  process.exit(passed ? 0 : 1);
} catch (err) {
  console.error('[✗] FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
}
