#!/usr/bin/env node
/**
 * NS-Dictionary Build Script
 * Generates static HTML pages from word data JSON.
 * Supports incremental builds via a manifest of content hashes.
 *
 * Usage:
 *   node build.mjs          # incremental build
 *   node build.mjs --full   # full rebuild
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { conjugate } from './lib/conjugator.mjs';

const ROOT = dirname(new URL(import.meta.url).pathname);
const OUT = join(ROOT, 'docs');
const DATA = join(ROOT, 'data', 'words.json');
const ROOTS_DATA = join(ROOT, 'data', 'roots.json');
const MANIFEST_PATH = join(ROOT, '.build-manifest.json');
const FULL = process.argv.includes('--full');
const SITE_URL = 'https://sindarin.dictionary.elvish.nz';
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function hash(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function readTemplate(name) {
  return readFileSync(join(ROOT, 'templates', `${name}.html`), 'utf-8');
}

/** Minimal Mustache-like renderer (handles {{var}}, {{#block}}...{{/block}}) */
function render(template, data) {
  data = { build_date: BUILD_DATE, ...data };
  // Handle {{#block}}...{{/block}} (truthy/array sections)
  let result = template.replace(
    /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, inner) => {
      const val = resolve(data, key);
      if (Array.isArray(val)) return val.map(item => render(inner, { ...data, ...item })).join('');
      if (val) return render(inner, data);
      return '';
    }
  );
  // Handle {{^block}}...{{/block}} (inverted/falsy sections)
  result = result.replace(
    /\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, inner) => {
      const val = resolve(data, key);
      if (!val || (Array.isArray(val) && val.length === 0)) return render(inner, data);
      return '';
    }
  );
  // Handle {{{var}}} — unescaped (raw HTML)
  result = result.replace(/\{\{\{([^}]+)\}\}\}/g, (_, key) => {
    const val = resolve(data, key.trim());
    return val != null ? String(val) : '';
  });
  // Handle {{var}} — escaped
  result = result.replace(/\{\{([^#/^][^}]*)\}\}/g, (_, key) => {
    const val = resolve(data, key.trim());
    return val != null ? escapeHtml(String(val)) : '';
  });
  return result;
}

function resolve(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Normalize to NFD so stacked combining marks render correctly */
function nfd(s) {
  return s ? s.normalize('NFD') : '';
}

function writeOut(relPath, content) {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const CATEGORY_LABELS = {
  physical_world: 'Physical World', body: 'Body', motion: 'Motion',
  people: 'People', kinship: 'Kinship', animals: 'Animals',
  food: 'Food & Drink', clothing: 'Clothing', dwelling: 'Dwelling',
  agriculture: 'Agriculture', spatial: 'Spatial Relations', quantity: 'Quantity',
  time: 'Time', sense: 'Sense & Perception', emotion: 'Emotion',
  cognition: 'Cognition', speech: 'Speech & Language', social: 'Social & Political',
  warfare: 'Warfare', law: 'Law', religion: 'Religion & Belief',
  quality: 'Quality', possession: 'Possession', tools: 'Tools & Technology',
  music: 'Music & Art',
  grammar: 'Grammar', different: 'Difference & Comparison',
  size: 'Size', 'spatial relations': 'Spatial Relations',
};

const SOURCE_NAMES = {
  tolkien: 'Tolkien',
  gnomish: 'Gnomish',
  noldorin: 'Noldorin',
  quenya: 'Quenya',
  quenya_neologism: 'Quenya neologism',
  primitive_elvish: 'Primitive Elvish',
  ancient_telerin: 'Ancient Telerin',
  old_sindarin: 'Old Sindarin',
  sindarin_compound: 'Sindarin compound',
  eldamo: 'Eldamo',
  FJNS: 'FJNS',
};

function buildTypeSourceText(type, source) {
  const sourceName = SOURCE_NAMES[source] || source || 'unknown';
  switch (type) {
    case 'attested':      return 'Attested in writing';
    case 'restored':      return `Restored from ${sourceName}`;
    case 'reconstructed': return `Reconstructed from ${sourceName}`;
    case 'neologism':     return `Neologism. Source: ${sourceName}`;
    default:              return '';
  }
}

const STATUS_LABELS = {
  accepted: 'Accepted',
  experimental: 'Experimental',
  questioned: 'Questioned',
};

// ── Prepare Word Data ────────────────────────────────────────────────────────

function prepareWordData(word, rootsMap) {
  const cognates_list = Object.entries(word.cognates || {}).map(
    ([language, form]) => ({ language, form })
  );

  // Resolve root references
  const resolved_roots = (word.etymology?.root_refs || [])
    .map(ref => rootsMap[ref])
    .filter(Boolean);

  // Auto-conjugate verbs, then apply overrides
  // Schema: conjugation.class triggers auto-generation.
  //   conjugation.overrides.tenses.{tense}.{person} overrides a specific cell.
  //   conjugation.overrides.forms.{key} overrides a specific other-form.
  //   An override value of "" marks a defective form (displayed as "—").
  //   An override value of null or absent → use the auto-generated form.
  if (word.conjugation?.class) {
    const autoConj = conjugate(word.sindarin, word.conjugation.class);
    if (autoConj) {
      const overrides = word.conjugation.overrides || {};

      // Merge tense overrides
      if (autoConj.tenses) {
        for (const tense of Object.keys(autoConj.tenses)) {
          const tenseOverrides = overrides.tenses?.[tense];
          if (tenseOverrides) {
            for (const [person, val] of Object.entries(tenseOverrides)) {
              if (val === '') {
                autoConj.tenses[tense][person] = '—'; // defective
              } else if (val != null) {
                autoConj.tenses[tense][person] = val;  // override
              }
            }
          }
        }
        // Check if overrides add entirely new tenses (e.g. a custom "past" on a derived verb)
        if (overrides.tenses) {
          for (const tense of Object.keys(overrides.tenses)) {
            if (!autoConj.tenses[tense]) {
              autoConj.tenses[tense] = {};
              for (const [person, val] of Object.entries(overrides.tenses[tense])) {
                autoConj.tenses[tense][person] = val === '' ? '—' : val;
              }
            }
          }
        }
      }

      // Merge form overrides
      if (autoConj.forms && overrides.forms) {
        for (const [key, val] of Object.entries(overrides.forms)) {
          if (val === '') {
            autoConj.forms[key] = '—'; // defective
          } else if (val != null) {
            autoConj.forms[key] = val;  // override
          }
        }
      }

      word = { ...word, conjugation: { ...word.conjugation, ...autoConj } };
    }
  }

  // Build conjugation data for template
  const PERSON_LABELS = {
    sg1: '1st sg.', sg2f: '2nd sg. fam.', sg2p: '2nd sg. pol.', sg2arch: '2nd sg. arch.',
    sg3: '3rd sg.',
    pl1e: '1st pl. excl.', pl1i: '1st pl. incl.',
    pl2f: '2nd pl. fam.', pl2p: '2nd pl. pol.', pl3: '3rd pl.',
  };
  const PERSON_ORDER = ['sg1','sg2f','sg2p','sg2arch','sg3','pl1e','pl1i','pl2f','pl2p','pl3'];
  const TENSE_LABELS = {
    present: 'Present', past: 'Past', future: 'Future',
    past_transitive: 'Past (transitive)', past_intransitive: 'Past (intransitive)',
  };
  const TENSE_ORDER = ['present','past','past_transitive','past_intransitive','future'];
  const FORM_LABELS = {
    pres_act_part: 'Present active participle', past_act_part: 'Past active participle',
    pass_part_sg: 'Passive past participle (sg.)', pass_part_pl: 'Passive past participle (pl.)',
    imperative: 'Imperative', infinitive: 'Infinitive', gerund: 'Gerund / verbal noun',
  };
  const FORM_ORDER = ['pres_act_part','past_act_part','pass_part_sg','pass_part_pl','imperative','infinitive','gerund'];

  // Build tense tables: array of { tense_label, persons: [{ person_label, form }] }
  const conjugation_tenses = [];
  if (word.conjugation?.tenses) {
    for (const key of TENSE_ORDER) {
      const tense = word.conjugation.tenses[key];
      if (!tense) continue;
      conjugation_tenses.push({
        tense_label: TENSE_LABELS[key] || key,
        persons: PERSON_ORDER.filter(p => tense[p]).map(p => ({
          person_label: PERSON_LABELS[p], form: tense[p],
        })),
      });
    }
  }

  // Build other forms rows
  const conjugation_forms = [];
  if (word.conjugation?.forms) {
    for (const key of FORM_ORDER) {
      if (word.conjugation.forms[key]) {
        conjugation_forms.push({
          form_label: FORM_LABELS[key] || key,
          form: word.conjugation.forms[key],
        });
      }
    }
  }

  // Alternative spellings (dialect-keyed object → list of { dialect, form })
  const dialectLabels = { north: 'North Sindarin', gondorian: 'Gondorian Sindarin', classic: 'Classic Sindarin' };
  const altSpellings = Object.entries(word.spellings || {}).map(
    ([dialect, form]) => ({ dialect, dialect_label: dialectLabels[dialect] || dialect, form })
  );

  // Inflection: show the "other" form with a label
  // Both empty → nothing. plural filled → show "pl. X". singular filled → show "sg. X".
  // Both filled (edge case) → show "pl. {plural}" only, singular ignored.
  const inf = word.inflection;
  let inflection_label = '';
  let inflection_form = '';
  let has_inflection = false;
  if (inf) {
    if (inf.plural) {
      inflection_label = 'plural';
      inflection_form = inf.plural;
      has_inflection = true;
    } else if (inf.singular) {
      inflection_label = 'singular';
      inflection_form = inf.singular;
      has_inflection = true;
    }
  }

  // Primitive: now an object { form, eldamo_id }
  const prim = word.etymology?.primitive;
  const has_primitive = !!(prim && prim.form);
  const primitive_form = nfd(prim?.form || '');
  const primitive_eldamo_id = prim?.eldamo_id || '';

  // Development chain: array of { form, eldamo_id } and { rule, eldamo_id }
  // Build into HTML string with links
  const dev = word.etymology?.development || [];
  const has_development = dev.length > 0;
  let development_html = '';
  if (has_development) {
    development_html = dev.map(step => {
      if (step.rule) {
        // Rule arrow — link if it has an eldamo_id
        if (step.eldamo_id) {
          return ` <a href="https://eldamo.org/content/words/word-${escapeHtml(step.eldamo_id)}.html" class="dev-rule-link" target="_blank" rel="noopener">›</a> `;
        }
        return ' <span class="dev-rule">›</span> ';
      } else {
        // Form — link if it has an eldamo_id
        if (step.eldamo_id) {
          return `<a href="https://eldamo.org/content/words/word-${escapeHtml(step.eldamo_id)}.html" class="dev-form-link" target="_blank" rel="noopener">${escapeHtml(nfd(step.form))}</a>`;
        }
        return `<span class="dev-form">${escapeHtml(nfd(step.form))}</span>`;
      }
    }).join('');
  }

  // Grammar: normalise to array, produce joined string for display
  const grammarArr = Array.isArray(word.grammar) ? word.grammar : [word.grammar].filter(Boolean);
  const grammarJoined = grammarArr.join(', ');

  // Format IPA: single-char → [x], multi-char → /xxx/
  const rawIpa = word.ipa || '';
  const ipa_display = rawIpa
    ? (rawIpa.length === 1 ? `[${rawIpa}]` : `/${rawIpa}/`)
    : '';

  const has_roots = resolved_roots.length > 0;

  return {
    ...word,
    ipa: ipa_display,
    grammar: grammarJoined,
    root: '../',
    english_joined: word.english.join(', '),
    category_label: CATEGORY_LABELS[word.category] || word.category,
    type_source_text: buildTypeSourceText(word.type, word.source),
    has_confidence: word.confidence !== null && word.confidence !== undefined,
    confidence_stars: word.confidence !== null && word.confidence !== undefined
      ? '★'.repeat(word.confidence) + '☆'.repeat(5 - word.confidence)
      : '',
    confidence_label: word.confidence !== null && word.confidence !== undefined
      ? ['Unreviewed', 'Dubious', 'Debated', 'Accepted', 'Established', 'Recommended'][word.confidence] || ''
      : '',
    status_label: STATUS_LABELS[word.status] || '',
    has_etymology: !!(word.etymology && (word.etymology.root_refs?.length || word.etymology.elements?.length || has_primitive || has_development)),
    has_roots,
    resolved_roots,
    has_primitive,
    primitive_form,
    primitive_eldamo_id,
    has_development,
    development_html,
    has_elements: !!(word.etymology?.elements?.length),
    has_cognates: cognates_list.length > 0,
    cognates_list,
    has_conjugation: !!(word.conjugation),
    conjugation_tenses,
    has_conjugation_tenses: conjugation_tenses.length > 0,
    conjugation_forms,
    has_conjugation_forms: conjugation_forms.length > 0,
    has_inflection,
    inflection_label,
    inflection_form,

    has_references: !!(word.references?.length),
    references_joined: (word.references || []).join(', '),
    has_etymology_section: !!(has_roots || has_primitive || has_development || word.etymology?.quettamorphosis_url || word.etymology?.elements?.length),
    has_references_section: !!(word.eldamo_id || word.references?.length),
    has_alt_spellings: altSpellings.length > 0,
    alt_spellings: altSpellings,
    in_swadesh100: word.swadesh100 !== null && word.swadesh100 !== undefined,
    in_swadesh207: word.swadesh207 !== null && word.swadesh207 !== undefined,
    meta_description: `${word.sindarin} — ${grammarJoined}. Meaning: ${word.english.join(', ')}. Neo-Sindarin dictionary entry with etymology and references.`,
    canonical_url: `${SITE_URL}/words/${word.id}.html`,
  };
}

// ── Build List Data ──────────────────────────────────────────────────────────

/** Join grammar array for display */
function grammarLabel(w) {
  const g = Array.isArray(w.grammar) ? w.grammar : [w.grammar].filter(Boolean);
  return g.join(', ');
}

function buildSindarinEnglishList(words) {
  const sorted = [...words].sort((a, b) => a.sindarin.localeCompare(b.sindarin));
  const byLetter = {};
  for (const w of sorted) {
    const letter = w.sindarin[0].toUpperCase();
    (byLetter[letter] ??= []).push(w);
  }
  const letters = Object.keys(byLetter).sort();
  return {
    page_title: 'Sindarin - English',
    meta_description: 'Complete Sindarin to English word list. Browse all Neo-Sindarin entries alphabetically.',
    canonical_url: `${SITE_URL}/sindarin-english.html`,
    root: '',
    has_letter_nav: true,
    letters: letters.map(l => ({ letter: l })),
    sections: letters.map(letter => ({
      section_id: letter,
      section_title: letter,
      words: byLetter[letter].map(w => ({
        id: w.id, primary: w.sindarin, secondary: w.english.join(', '),
        grammar: grammarLabel(w), root: '',
      })),
    })),
  };
}

function buildEnglishSindarinList(words) {
  const entries = [];
  for (const w of words) {
    for (const eng of w.english) {
      entries.push({ ...w, english_single: eng });
    }
  }
  entries.sort((a, b) => a.english_single.localeCompare(b.english_single));
  const byLetter = {};
  for (const e of entries) {
    const letter = e.english_single[0].toUpperCase();
    (byLetter[letter] ??= []).push(e);
  }
  const letters = Object.keys(byLetter).sort();
  return {
    page_title: 'English - Sindarin',
    meta_description: 'English to Sindarin word list. Look up English words and find their Neo-Sindarin translations.',
    canonical_url: `${SITE_URL}/english-sindarin.html`,
    root: '',
    has_letter_nav: true,
    letters: letters.map(l => ({ letter: l })),
    sections: letters.map(letter => ({
      section_id: letter,
      section_title: letter,
      words: byLetter[letter].map(e => ({
        id: e.id, primary: e.english_single, secondary: e.sindarin,
        grammar: grammarLabel(e), root: '',
      })),
    })),
  };
}

function buildByGrammarList(words) {
  const byGrammar = {};
  for (const w of words) {
    const gArr = Array.isArray(w.grammar) ? w.grammar : [w.grammar].filter(Boolean);
    for (const g of gArr) {
      (byGrammar[g] ??= []).push(w);
    }
  }
  const grammars = Object.keys(byGrammar).sort();
  return {
    page_title: 'Words by Grammar',
    meta_description: 'Neo-Sindarin words organized by grammatical type — nouns, verbs, adjectives, and more.',
    canonical_url: `${SITE_URL}/by-grammar.html`,
    root: '',
    has_letter_nav: false,
    sections: grammars.map(g => ({
      section_id: g,
      section_title: g.charAt(0).toUpperCase() + g.slice(1) + (g.charAt(g.length - 1) === 'x' ? 'e' : '') + 's',
      words: byGrammar[g].sort((a, b) => a.sindarin.localeCompare(b.sindarin)).map(w => ({
        id: w.id, primary: w.sindarin, secondary: w.english.join(', '),
        grammar: grammarLabel(w), root: '',
      })),
    })),
  };
}

function buildByCategoryList(words) {
  const byCat = {};
  for (const w of words) {
    const cat = w.ids_chapter || w.category || 'uncategorized';
    (byCat[cat] ??= []).push(w);
  }
  const cats = Object.keys(byCat).sort();
  return {
    page_title: 'Words by Category',
    meta_description: 'Neo-Sindarin words organized by semantic category — nature, people, actions, and more.',
    canonical_url: `${SITE_URL}/by-category.html`,
    page_subtitle: 'Organized by IDS semantic chapters',
    root: '',
    has_letter_nav: false,
    sections: cats.map(c => ({
      section_id: c,
      section_title: CATEGORY_LABELS[c] || c.charAt(0).toUpperCase() + c.slice(1),
      words: byCat[c].sort((a, b) => a.sindarin.localeCompare(b.sindarin)).map(w => ({
        id: w.id, primary: w.sindarin, secondary: w.english.join(', '),
        grammar: grammarLabel(w), root: '',
      })),
    })),
  };
}

function buildSwadeshList(words, field, title, description, filename) {
  const filtered = words.filter(w => w[field] !== null && w[field] !== undefined);
  filtered.sort((a, b) => a[field] - b[field]);
  return {
    page_title: title,
    meta_description: description,
    canonical_url: `${SITE_URL}/${filename}`,
    page_subtitle: `${filtered.length} words`,
    root: '',
    has_letter_nav: false,
    sections: [{
      section_id: 'all',
      section_title: title,
      words: filtered.map(w => ({
        id: w.id, primary: w.sindarin, secondary: w.english.join(', '),
        grammar: grammarLabel(w), root: '', rank: w[field],
      })),
    }],
  };
}

// ── Load Data ────────────────────────────────────────────────────────────────

const words = JSON.parse(readFileSync(DATA, 'utf-8'));
const roots = JSON.parse(readFileSync(ROOTS_DATA, 'utf-8'));
const rootsMap = Object.fromEntries(roots.map(r => [r.id, r]));
const wordTemplate = readTemplate('word');
const listTemplate = readTemplate('list');
const indexTemplate = readTemplate('index');
const searchTemplate = readTemplate('search');

let oldManifest = {};
if (!FULL && existsSync(MANIFEST_PATH)) {
  try { oldManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')); } catch { /* ignore */ }
}
const newManifest = {};

// ── Copy Static Assets ───────────────────────────────────────────────────────

// Clean old word pages before rebuilding
const wordsDir = join(OUT, 'words');
if (existsSync(wordsDir)) rmSync(wordsDir, { recursive: true });

cpSync(join(ROOT, 'static'), OUT, { recursive: true });
console.log('✓ Copied static assets');

// ── Group Words by Slug (merge homonyms) ─────────────────────────────────────

const wordsBySlug = {};
for (const word of words) {
  const slug = word.id;
  (wordsBySlug[slug] ??= []).push(word);
}

// ── Build Word Pages ─────────────────────────────────────────────────────────

let built = 0, skipped = 0;

for (const [slug, group] of Object.entries(wordsBySlug)) {
  const groupJson = JSON.stringify(group);
  const h = hash(groupJson);

  // Determine last-modified date: carry forward old date if content unchanged, otherwise today
  const oldEntry = oldManifest[`page:${slug}`];
  const oldHash = typeof oldEntry === 'object' ? oldEntry.hash : oldEntry;
  const oldDate = typeof oldEntry === 'object' ? oldEntry.date : null;
  const wordDate = (oldHash === h && oldDate) ? oldDate : BUILD_DATE;

  newManifest[`page:${slug}`] = { hash: h, date: wordDate };

  if (!FULL && oldHash === h) {
    skipped++;
    continue;
  }

  // Use first entry for shared header data (sindarin, ipa, tengwar, cirth)
  const first = group[0];
  const senses = group.map((word, i) => {
    const senseData = prepareWordData(word, rootsMap);
    senseData.sense_heading = group.length > 1 ? `Sense ${i + 1}` : '';
    return senseData;
  });

  // Format IPA for shared header
  const rawIpa = first.ipa || '';
  const ipa_display = rawIpa
    ? (rawIpa.length === 1 ? `[${rawIpa}]` : `/${rawIpa}/`)
    : '';

  const englishSummary = group.map(w => w.english.join(', ')).join('; ');
  const grammarSummary = [...new Set(senses.map(s => s.grammar).filter(Boolean))].join(', ') || '';

  const pageData = {
    sindarin: first.sindarin,
    mutation_marker: first.mutation_marker || '',
    ipa: ipa_display,
    tengwar: first.tengwar || '',
    cirth: first.cirth || '',
    root: '../',
    has_alt_spellings: senses[0].has_alt_spellings,
    alt_spellings: senses[0].alt_spellings,
    meta_description: `${first.sindarin} — ${grammarSummary}. Meaning: ${englishSummary}. Neo-Sindarin dictionary entry with etymology and references.`,
    canonical_url: `${SITE_URL}/words/${slug}.html`,
    build_date: wordDate,
    last_modified: first.last_modified || wordDate,
    senses,
  };

  const html = render(wordTemplate, pageData);
  writeOut(`words/${slug}.html`, html);
  built++;
}

console.log(`✓ Word pages: ${built} built, ${skipped} unchanged`);

// ── Build List Pages (always rebuilt — they depend on all words) ─────────────

const listHash = hash(JSON.stringify(words));
newManifest['__lists__'] = listHash;

if (FULL || oldManifest['__lists__'] !== listHash) {
  writeOut('sindarin-english.html', render(listTemplate, buildSindarinEnglishList(words)));
  writeOut('english-sindarin.html', render(listTemplate, buildEnglishSindarinList(words)));
  writeOut('by-grammar.html', render(listTemplate, buildByGrammarList(words)));
  writeOut('by-category.html', render(listTemplate, buildByCategoryList(words)));
  writeOut('swadesh-100.html', render(listTemplate, buildSwadeshList(words, 'swadesh100', 'Swadesh 100', 'The Swadesh 100 core vocabulary list in Neo-Sindarin.', 'swadesh-100.html')));
  writeOut('swadesh-207.html', render(listTemplate, buildSwadeshList(words, 'swadesh207', 'Swadesh 207', 'The extended Swadesh 207 vocabulary list in Neo-Sindarin.', 'swadesh-207.html')));
  console.log('✓ List pages rebuilt');
} else {
  console.log('✓ List pages unchanged');
}

// ── Build Index Page ─────────────────────────────────────────────────────────

writeOut('index.html', render(indexTemplate, { word_count: words.length }));
console.log('✓ Index page built');

// ── Build Search Page ───────────────────────────────────────────────────────

const searchData = words.map(w => ({
  id: w.id,
  s: w.sindarin,
  e: w.english.join(', '),
  g: grammarLabel(w),
}));

writeOut('search.html', render(searchTemplate, { search_data: JSON.stringify(searchData) }));
console.log('✓ Search page built');

// ── Build Sitemap ────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

const sitemapEntries = [
  { loc: '/',                      changefreq: 'weekly',  priority: '1.0' },
  { loc: '/sindarin-english.html',  changefreq: 'weekly',  priority: '0.8' },
  { loc: '/english-sindarin.html',  changefreq: 'weekly',  priority: '0.8' },
  { loc: '/by-grammar.html',       changefreq: 'weekly',  priority: '0.6' },
  { loc: '/by-category.html',      changefreq: 'weekly',  priority: '0.6' },
  { loc: '/swadesh-100.html',     changefreq: 'monthly', priority: '0.6' },
  { loc: '/swadesh-207.html',     changefreq: 'monthly', priority: '0.6' },
  { loc: '/search.html',           changefreq: 'monthly', priority: '0.5' },
];

for (const slug of Object.keys(wordsBySlug)) {
  sitemapEntries.push({ loc: `/words/${slug}.html`, changefreq: 'monthly', priority: '0.7' });
}

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map(e => `  <url>
    <loc>${SITE_URL}${e.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

writeOut('sitemap.xml', sitemapXml);
console.log(`✓ Sitemap built (${sitemapEntries.length} URLs)`);

// ── Save Manifest ────────────────────────────────────────────────────────────

writeFileSync(MANIFEST_PATH, JSON.stringify(newManifest, null, 2), 'utf-8');
console.log(`\nBuild complete. Output: ${OUT}`);
