/**
 * Shared CSV parsing and row→word conversion logic.
 * Used by both scripts/import-csv.mjs and build.mjs.
 */

import { randomUUID } from 'node:crypto';

// ── CSV Parser (handles quoted fields with commas/newlines) ──────────────────

export function parseCSV(text) {
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

export function splitSemi(val) {
  if (!val) return [];
  return val.split(';').map(s => s.trim()).filter(Boolean);
}

export function parseCognates(val) {
  if (!val) return {};
  const obj = {};
  for (const pair of val.split(';')) {
    const [lang, ...rest] = pair.split(':');
    if (lang && rest.length) obj[lang.trim()] = rest.join(':').trim();
  }
  return obj;
}

export function parseElements(val) {
  if (!val) return [];
  return val.split(';').map(chunk => {
    const parts = chunk.split('|').map(s => s.trim());
    return { form: parts[0] || '', gloss: parts[1] || '', type: parts[2] || '' };
  }).filter(e => e.form);
}

export function parseDevelopment(val) {
  if (!val) return [];
  const linkedUrls = [];
  const normalized = val.replace(/\[>\]\(([^)]*)\)/g, (_m, url) => {
    linkedUrls.push(url);
    return '\x01';
  });
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

export function slugify(sindarin) {
  return sindarin
    .toLowerCase()
    .replace(/-$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const HEADER_MAP = {
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
export function rowToWord(r) {
  const sindarin = r.sindarin || '';
  const grammarArr = splitSemi(r.grammar).map(g => g.toLowerCase());
  const isVerb = grammarArr.includes('verb');

  let inflection = null;
  if (!isVerb && (r.inflection_base || r.inflection_singular || r.inflection_plural)) {
    inflection = {
      base: r.inflection_base || sindarin,
      singular: r.inflection_singular || '',
      plural: r.inflection_plural || '',
    };
  }

  const primitiveForm = r.primitive_form || '';
  const primitive = primitiveForm
    ? { form: primitiveForm, eldamo_id: r.primitive_eldamo_id || '' }
    : null;

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

/**
 * Convert raw CSV text → array of word objects.
 * Filters to rows that have a uuid.
 */
export function csvTextToWords(csvText) {
  const csvRows = parseCSV(csvText);
  if (csvRows.length < 2) return [];

  const headers = csvRows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const dataRows = csvRows.slice(1);

  const rowObjects = dataRows.map(cols => {
    const obj = {};
    headers.forEach((h, i) => {
      const mapped = HEADER_MAP[h];
      if (mapped) obj[mapped] = cols[i] || '';
    });
    return obj;
  });

  // Only include rows that have a uuid
  return rowObjects
    .filter(r => r.uuid && r.sindarin)
    .map(r => rowToWord(r));
}
