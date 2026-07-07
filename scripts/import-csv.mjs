#!/usr/bin/env node
/**
 * CSV → words.json importer
 *
 * Usage:
 *   node scripts/import-csv.mjs data/words.csv          # merge into words.json
 *   node scripts/import-csv.mjs data/words.csv --dry-run # preview without writing
 *
 * Behaviour:
 *   - Matches rows to existing words by uuid.
 *   - If a row has a uuid that exists in words.json → updates that entry.
 *   - If a row has no uuid (empty) → creates a new entry with a fresh uuid.
 *   - Existing words.json entries whose uuid is NOT in the CSV are kept unchanged
 *     (the CSV does not need to contain every word).
 *   - The CSV never deletes words — only adds or updates.
 *
 * CSV format: see README.md § CSV Import Format for the full column list.
 * Multi-value fields use semicolon separators within a cell.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseCSV, HEADER_MAP, rowToWord } from '../lib/csv-parser.mjs';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const WORDS_PATH = join(ROOT, 'data', 'words.json');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/import-csv.mjs <path-to-csv> [--dry-run]');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const csvText = readFileSync(csvPath, 'utf-8');
const csvRows = parseCSV(csvText);

if (csvRows.length < 2) {
  console.error('CSV must have a header row and at least one data row.');
  process.exit(1);
}

// Build header index
const headers = csvRows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
const dataRows = csvRows.slice(1);

// Convert each row to a keyed object
const rowObjects = dataRows.map(cols => {
  const obj = {};
  headers.forEach((h, i) => {
    const mapped = HEADER_MAP[h];
    if (mapped) obj[mapped] = cols[i] || '';
  });
  return obj;
});

// Load existing words
const existing = existsSync(WORDS_PATH)
  ? JSON.parse(readFileSync(WORDS_PATH, 'utf-8'))
  : [];
const byUuid = new Map(existing.map(w => [w.uuid, w]));

let added = 0, updated = 0, kept = 0;

// Process CSV rows
for (const r of rowObjects) {
  if (!r.sindarin) continue; // skip blank rows

  const word = rowToWord(r);

  if (r.uuid && byUuid.has(r.uuid)) {
    // Update existing — preserve any fields the CSV doesn't cover
    const old = byUuid.get(r.uuid);
    // Merge: CSV values overwrite, but keep conjugation overrides from JSON
    const merged = { ...old, ...word };
    // Preserve conjugation overrides if they exist in JSON but not in CSV
    if (old.conjugation?.overrides && !word.conjugation?.overrides) {
      merged.conjugation = { ...word.conjugation, overrides: old.conjugation.overrides };
    }
    byUuid.set(r.uuid, merged);
    updated++;
  } else {
    // New word
    byUuid.set(word.uuid, word);
    added++;
  }
}

// Count kept (untouched by CSV)
kept = existing.length - updated;

// Assemble final array: preserve order of existing, append new at end
const existingUuids = new Set(existing.map(w => w.uuid));
const result = [];
for (const w of existing) {
  result.push(byUuid.get(w.uuid));
}
for (const [uuid, w] of byUuid) {
  if (!existingUuids.has(uuid)) result.push(w);
}

console.log(`CSV: ${dataRows.length} rows → ${added} new, ${updated} updated, ${kept} kept`);

if (DRY_RUN) {
  console.log('(dry run — no files written)');
  console.log('\nNew/updated words:');
  for (const r of rowObjects) {
    if (!r.sindarin) continue;
    const tag = (r.uuid && existing.some(w => w.uuid === r.uuid)) ? 'UPDATE' : 'NEW';
    console.log(`  [${tag}] ${r.sindarin}`);
  }
} else {
  writeFileSync(WORDS_PATH, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  console.log(`✓ Wrote ${result.length} words to ${WORDS_PATH}`);
}
