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
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const WORDS_PATH = join(ROOT, 'data', 'words.json');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/import-csv.mjs <path-to-csv> [--dry-run]');
  process.exit(1);
}

// ── CSV Parser (handles quoted fields with commas/newlines) ──────────────────

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'; i++; // escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim()); field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field.trim()); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        if (ch === '\r') i++; // skip \n after \r
      } else {
        field += ch;
      }
    }
  }
  // last field / row
  row.push(field.trim());
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

// ── Field Helpers ────────────────────────────────────────────────────────────

/** Split a semicolon-separated cell into an array, trimming each value */
function splitSemi(val) {
  if (!val) return [];
  return val.split(';').map(s => s.trim()).filter(Boolean);
}

/** Parse "quenya:Atan; telerin:form" → { quenya: "Atan", telerin: "form" } */
function parseCognates(val) {
  if (!val) return {};
  const obj = {};
  for (const pair of val.split(';')) {
    const [lang, ...rest] = pair.split(':');
    if (lang && rest.length) obj[lang.trim()] = rest.join(':').trim();
  }
  return obj;
}

/** Parse "form|gloss|type; form|gloss|type" → [{ form, gloss, type }] */
function parseElements(val) {
  if (!val) return [];
  return val.split(';').map(chunk => {
    const parts = chunk.split('|').map(s => s.trim());
    return { form: parts[0] || '', gloss: parts[1] || '', type: parts[2] || '' };
  }).filter(e => e.form);
}

/**
 * Parse a development chain string into the structured array.
 *
 * Supports two formats:
 *
 *   Plain:    "CE *atanō > OS *atano > S adan"
 *   Linked:   "mbelektā [>](https://eldamo.org/…/word-123.html) mbelekta > belaith"
 *
 * [>](url) is a linked rule — the eldamo_id is extracted from the URL.
 * A bare > is an unlinked rule (eldamo_id "").
 */
function parseDevelopment(val) {
  if (!val) return [];

  // Replace [>](url) with a placeholder, collecting URLs in order
  const linkedUrls = [];
  const normalized = val.replace(/\[>\]\(([^)]*)\)/g, (_m, url) => {
    linkedUrls.push(url);
    return '\x01';          // single-char placeholder
  });

  // Split on placeholder (\x01) and bare >
  const parts = normalized.split(/\x01|>/);
  const separators = [...normalized.matchAll(/\x01|>/g)];
  let urlIdx = 0;

  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const form = parts[i].trim();
    if (form) result.push({ form, eldamo_id: '' });
    if (i < separators.length) {
      if (separators[i][0] === '\x01') {
        const url = linkedUrls[urlIdx++];
        const m = url.match(/word-(\d+)/);
        result.push({ rule: '>', eldamo_id: m ? m[1] : '' });
      } else {
        result.push({ rule: '>', eldamo_id: '' });
      }
    }
  }
  return result;
}

/** Derive a URL-safe slug from a sindarin headword */
function slugify(sindarin) {
  return sindarin
    .toLowerCase()
    .replace(/-$/, '')        // trailing hyphen (verb convention)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Column → Field Mapping ────────────────────────────────────────────────

/**
 * Expected CSV columns (header names, case-insensitive):
 *
 *  uuid, sindarin, spellings, ipa, tengwar, cirth,
 *  english, grammar, gender, category, ids_chapter, type, source, status,
 *  noldorin_form, eldamo_id, notes, references,
 *  inflection_base, inflection_singular, inflection_plural,
 *  root_refs, primitive_form, primitive_eldamo_id,
 *  development, elements, quettamorphosis_url,
 *  cognates,
 *  conjugation_class, conjugation_irregular
 */

const HEADER_MAP = {
  uuid: 'uuid',
  sindarin: 'sindarin',
  spellings: 'spellings',
  ipa: 'ipa',
  tengwar: 'tengwar',
  cirth: 'cirth',
  english: 'english',
  grammar: 'grammar',
  gender: 'gender',
  category: 'category',
  ids_chapter: 'ids_chapter',
  type: 'type',
  source: 'source',
  status: 'status',
  noldorin_form: 'noldorin_form',
  eldamo_id: 'eldamo_id',
  notes: 'notes',
  references: 'references',
  inflection_base: 'inflection_base',
  inflection_singular: 'inflection_singular',
  inflection_plural: 'inflection_plural',
  root_refs: 'root_refs',
  primitive_form: 'primitive_form',
  primitive_eldamo_id: 'primitive_eldamo_id',
  development: 'development',
  elements: 'elements',
  quettamorphosis_url: 'quettamorphosis_url',
  cognates: 'cognates',
  conjugation_class: 'conjugation_class',
  conjugation_irregular: 'conjugation_irregular',
  mutation_marker: 'mutation_marker',
  hidden: 'hidden',
};

/** Convert a row object (header→value) into a words.json entry */
function rowToWord(r) {
  const sindarin = r.sindarin || '';
  const grammarArr = splitSemi(r.grammar).map(g => g.toLowerCase());
  const isVerb = grammarArr.includes('verb');

  // Inflection: null for verbs, object for nouns/adjectives
  let inflection = null;
  if (!isVerb && (r.inflection_base || r.inflection_singular || r.inflection_plural)) {
    inflection = {
      base: r.inflection_base || sindarin,
      singular: r.inflection_singular || '',
      plural: r.inflection_plural || '',
    };
  }

  // Primitive
  const primitiveForm = r.primitive_form || '';
  const primitive = primitiveForm
    ? { form: primitiveForm, eldamo_id: r.primitive_eldamo_id || '' }
    : null;

  // Conjugation
  let conjugation = null;
  if (r.conjugation_class) {
    conjugation = {
      class: r.conjugation_class,
      irregular: (r.conjugation_irregular || '').toLowerCase() === 'true',
    };
  }

  return {
    uuid: r.uuid || randomUUID(),
    id: slugify(sindarin),
    mutation_marker: r.mutation_marker || '',
    sindarin,
    spellings: parseCognates(r.spellings),
    ipa: r.ipa || '',
    tengwar: r.tengwar || '',
    cirth: r.cirth || '',
    english: splitSemi(r.english),
    grammar: grammarArr,
    inflection,
    gender: r.gender || '',
    category: r.category || '',
    ids_chapter: r.ids_chapter || r.category || '',
    type: r.type || '',
    source: r.source || '',
    status: r.status || '',
    noldorin_form: r.noldorin_form || '',
    eldamo_id: r.eldamo_id || '',
    etymology: {
      root_refs: splitSemi(r.root_refs),
      primitive,
      development: parseDevelopment(r.development),
      elements: parseElements(r.elements),
      quettamorphosis_url: r.quettamorphosis_url || '',
    },
    cognates: parseCognates(r.cognates),
    conjugation,
    notes: r.notes || '',
    references: splitSemi(r.references),
    hidden: r.hidden || '',
  };
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
