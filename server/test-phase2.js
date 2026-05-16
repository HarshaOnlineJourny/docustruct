#!/usr/bin/env node
/**
 * Test Phase 2: Query function organization filtering
 * Run: npm --prefix server run test:phase2
 */

import {
  db,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplateAI,
  listDocuments,
  listRecords,
  getFieldStats,
  createOrganization,
} from './src/db.js';

console.log('\n[TEST] Phase 2: Query Function Organization Filtering\n');

try {
  let passed = 0;
  let failed = 0;

  // Setup: Create two organizations
  console.log('[Setup] Creating test organizations...');
  const org1 = createOrganization('Test Org 1');
  const org2 = createOrganization('Test Org 2');
  console.log(`[✓] Created Org 1 (id=${org1.id}) and Org 2 (id=${org2.id})`);

  // Test 1: createTemplate requires organizationId
  console.log('\n[Test 1] createTemplate requires organizationId');
  try {
    createTemplate({
      name: 'Test Template',
      fields: [{ name: 'test', label: 'Test', type: 'text' }],
      // Missing organizationId
    });
    console.log('[✗] Should have thrown error for missing organizationId');
    failed++;
  } catch (e) {
    if (e.message.includes('organizationId')) {
      console.log('[✓] Correctly rejects missing organizationId');
      passed++;
    } else {
      console.log(`[✗] Wrong error: ${e.message}`);
      failed++;
    }
  }

  // Test 2: Create templates in each org
  console.log('\n[Test 2] Create templates in different organizations');
  const tpl1 = createTemplate({
    name: 'Org1 Template',
    fields: [
      { name: 'field1', label: 'Field 1', type: 'text' },
      { name: 'field2', label: 'Field 2', type: 'number' },
    ],
    organizationId: org1.id,
  });
  const tpl2 = createTemplate({
    name: 'Org2 Template',
    fields: [{ name: 'field1', label: 'Field 1', type: 'text' }],
    organizationId: org2.id,
  });
  console.log(`[✓] Created template in Org 1 (id=${tpl1.id})`);
  console.log(`[✓] Created template in Org 2 (id=${tpl2.id})`);
  passed += 2;

  // Test 3: listTemplates filters by organization
  console.log('\n[Test 3] listTemplates filters by organization');
  const org1Templates = listTemplates(org1.id);
  const org2Templates = listTemplates(org2.id);
  const org1HasOwn = org1Templates.some((t) => t.id === tpl1.id);
  const org1HasOther = org1Templates.some((t) => t.id === tpl2.id);
  const org2HasOwn = org2Templates.some((t) => t.id === tpl2.id);
  const org2HasOther = org2Templates.some((t) => t.id === tpl1.id);

  if (org1HasOwn && !org1HasOther) {
    console.log('[✓] Org 1 sees only its templates');
    passed++;
  } else {
    console.log('[✗] Org 1 filter failed');
    failed++;
  }

  if (org2HasOwn && !org2HasOther) {
    console.log('[✓] Org 2 sees only its templates');
    passed++;
  } else {
    console.log('[✗] Org 2 filter failed');
    failed++;
  }

  // Test 4: getTemplate validates ownership
  console.log('\n[Test 4] getTemplate validates ownership');
  const canGetOwnTemplate = getTemplate(tpl1.id, org1.id);
  const cannotGetOtherTemplate = getTemplate(tpl2.id, org1.id);

  if (canGetOwnTemplate && canGetOwnTemplate.id === tpl1.id) {
    console.log('[✓] Can fetch own template');
    passed++;
  } else {
    console.log('[✗] Cannot fetch own template');
    failed++;
  }

  if (cannotGetOtherTemplate === null) {
    console.log('[✓] Returns null for unauthorized access');
    passed++;
  } else {
    console.log('[✗] Should return null for unauthorized access');
    failed++;
  }

  // Test 5: listDocuments requires organizationId
  console.log('\n[Test 5] listDocuments requires organizationId');
  try {
    listDocuments({});
    console.log('[✗] Should have thrown error');
    failed++;
  } catch (e) {
    if (e.message.includes('organizationId')) {
      console.log('[✓] Correctly requires organizationId');
      passed++;
    } else {
      console.log(`[✗] Wrong error: ${e.message}`);
      failed++;
    }
  }

  // Test 6: listRecords requires organizationId
  console.log('\n[Test 6] listRecords requires organizationId');
  try {
    listRecords({});
    console.log('[✗] Should have thrown error');
    failed++;
  } catch (e) {
    if (e.message.includes('organizationId')) {
      console.log('[✓] Correctly requires organizationId');
      passed++;
    } else {
      console.log(`[✗] Wrong error: ${e.message}`);
      failed++;
    }
  }

  // Test 7: getFieldStats validates ownership
  console.log('\n[Test 7] getFieldStats validates ownership');
  try {
    const stats = getFieldStats(tpl1.id, org1.id);
    console.log('[✓] Can fetch stats for own template');
    passed++;
  } catch (e) {
    console.log(`[✗] Failed to fetch own stats: ${e.message}`);
    failed++;
  }

  try {
    const stats = getFieldStats(tpl2.id, org1.id);
    console.log('[✗] Should have thrown error for unauthorized access');
    failed++;
  } catch (e) {
    if (e.message.includes('unauthorized')) {
      console.log('[✓] Correctly rejects unauthorized access');
      passed++;
    } else {
      console.log(`[✗] Wrong error: ${e.message}`);
      failed++;
    }
  }

  // Test 8: updateTemplateAI validates ownership
  console.log('\n[Test 8] updateTemplateAI validates ownership');
  try {
    // Update own template (should work)
    const updated = updateTemplateAI(
      tpl1.id,
      { ai_prompt: 'test prompt' },
      org1.id
    );
    console.log('[✓] Can update own template');
    passed++;
  } catch (e) {
    console.log(`[✗] Failed to update own template: ${e.message}`);
    failed++;
  }

  try {
    // Try to update other org's template (should fail)
    const updated = updateTemplateAI(
      tpl1.id,
      { ai_prompt: 'malicious prompt' },
      org2.id
    );
    console.log('[✗] Should have rejected unauthorized update');
    failed++;
  } catch (e) {
    if (e.message.includes('unauthorized')) {
      console.log('[✓] Correctly rejects unauthorized update');
      passed++;
    } else {
      console.log(`[✗] Wrong error: ${e.message}`);
      failed++;
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Test Results] ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);

  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  console.error('[✗] FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
}
