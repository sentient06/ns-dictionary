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
import { csvTextToWords } from './lib/csv-parser.mjs';

const ROOT = dirname(new URL(import.meta.url).pathname);
const OUT = join(ROOT, 'docs');
const DATA = join(ROOT, 'data', 'words.json');
const ROOTS_DATA = join(ROOT, 'data', 'roots.json');
const MANIFEST_PATH = join(ROOT, '.build-manifest.json');
const FULL = process.argv.includes('--full');
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTQcRY-S8AOXcFLucMvZ95qyaqMK5rGjYzKgUye5FryhxWhymuzgFgZ-HrdC2sFOcljjgHZSjgPwySE/pub?output=csv';

// ── Helpers ──────────────────────────────────────────────────────────────────

function hash(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function readTemplate(name) {
  return readFileSync(join(ROOT, 'templates', `${name}.html`), 'utf-8');
}

/** Minimal Mustache-like renderer (handles {{var}}, {{#block}}...{{/block}}) */
function render(template, data) {
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

const SOURCE_LABELS = {
  tolkien: '',
  gnomish: 'from Gnomish',
  noldorin: 'from Noldorin',
  quenya: 'from Quenya',
  quenya_neologism: 'from Q. neologism',
  primitive_elvish: 'from PE root',
  ancient_telerin: 'from A. Telerin',
  old_sindarin: 'from Old Sindarin',
  sindarin_compound: 'S. compound',
  eldamo: 'from Eldamo',
  elaran: 'by Elaran',
  telpefindele: 'by Telpefindelë',
  FJNS: 'from FJNS',
};

const TYPE_LABELS = {
  attested: 'Attested',
  reconstructed: 'Reconstructed',
  neologism: 'Neologism',
  restored: 'Restored',
};

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
  const primitive_form = prim?.form || '';
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
          return `<a href="https://eldamo.org/content/words/word-${escapeHtml(step.eldamo_id)}.html" class="dev-form-link" target="_blank" rel="noopener">${escapeHtml(step.form)}</a>`;
        }
        return `<span class="dev-form">${escapeHtml(step.form)}</span>`;
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

  return {
    ...word,
    ipa: ipa_display,
    grammar: grammarJoined,
    root: '../',
    english_joined: word.english.join(', '),
    category_label: CATEGORY_LABELS[word.category] || word.category,
    type_label: TYPE_LABELS[word.type] || word.type,
    source_label: SOURCE_LABELS[word.source] ?? (word.source || ''),
    status_label: STATUS_LABELS[word.status] || '',
    has_etymology: !!(word.etymology && (word.etymology.root_refs?.length || word.etymology.elements?.length || has_primitive || has_development)),
    has_roots: resolved_roots.length > 0,
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
    has_alt_spellings: altSpellings.length > 0,
    alt_spellings: altSpellings,
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
    page_title: 'Sindarin → English',
    root: '',
    has_letter_nav: true,
    letters: letters.map(l => ({ letter: l })),
    sections: letters.map(letter => ({
      section_id: letter,
      section_title: letter,
      words: byLetter[letter].map(w => ({
        id: w.uuid, primary: w.sindarin, secondary: w.english.join(', '),
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
    page_title: 'English → Sindarin',
    root: '',
    has_letter_nav: true,
    letters: letters.map(l => ({ letter: l })),
    sections: letters.map(letter => ({
      section_id: letter,
      section_title: letter,
      words: byLetter[letter].map(e => ({
        id: e.uuid, primary: e.english_single, secondary: e.sindarin,
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
    root: '',
    has_letter_nav: false,
    sections: grammars.map(g => ({
      section_id: g,
      section_title: g.charAt(0).toUpperCase() + g.slice(1) + 's',
      words: byGrammar[g].sort((a, b) => a.sindarin.localeCompare(b.sindarin)).map(w => ({
        id: w.uuid, primary: w.sindarin, secondary: w.english.join(', '),
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
    page_subtitle: 'Organized by IDS semantic chapters',
    root: '',
    has_letter_nav: false,
    sections: cats.map(c => ({
      section_id: c,
      section_title: CATEGORY_LABELS[c] || c,
      words: byCat[c].sort((a, b) => a.sindarin.localeCompare(b.sindarin)).map(w => ({
        id: w.uuid, primary: w.sindarin, secondary: w.english.join(', '),
        grammar: grammarLabel(w), root: '',
      })),
    })),
  };
}


// ── Fetch & Convert Data ─────────────────────────────────────────────────────

console.log('Fetching data from Google Sheets…');
const csvResponse = await fetch(SHEET_URL);
if (!csvResponse.ok) {
  console.error(`Failed to fetch CSV: ${csvResponse.status} ${csvResponse.statusText}`);
  process.exit(1);
}
const csvText = await csvResponse.text();
const words = csvTextToWords(csvText);
writeFileSync(DATA, JSON.stringify(words, null, 2) + '\n', 'utf-8');
console.log(`✓ Fetched ${words.length} words from Google Sheets`);

const roots = JSON.parse(readFileSync(ROOTS_DATA, 'utf-8'));
const rootsMap = Object.fromEntries(roots.map(r => [r.id, r]));
const wordTemplate = readTemplate('word');
const listTemplate = readTemplate('list');

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

// ── Build Word Pages ─────────────────────────────────────────────────────────

let built = 0, skipped = 0;

for (const word of words) {
  const wordJson = JSON.stringify(word);
  const h = hash(wordJson);
  const manifestKey = word.uuid || word.id;
  newManifest[manifestKey] = h;

  if (!FULL && oldManifest[manifestKey] === h) {
    skipped++;
    continue;
  }

  const data = prepareWordData(word, rootsMap);
  const html = render(wordTemplate, data);
  writeOut(`words/${word.uuid}.html`, html);
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
  console.log('✓ List pages rebuilt');
} else {
  console.log('✓ List pages unchanged');
}

// ── Build Index Page ─────────────────────────────────────────────────────────

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NS Dictionary — A Neo-Sindarin Lexicon</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/tengwar.css">
  <link rel="stylesheet" href="css/cirth.css">
</head>
<body>
  <header class="site-header">
    <a href="index.html" class="site-title">NS Dictionary</a>
    <nav class="site-nav">
      <a href="sindarin-english.html">Sindarin → English</a>
      <a href="english-sindarin.html">English → Sindarin</a>
      <a href="by-grammar.html">By Grammar</a>
      <a href="by-category.html">By Category</a>
      <a href="search.html">Search</a>
    </nav>
  </header>
  <main class="main-content">
    <h1 class="page-title">NS Dictionary</h1>
    <p>A Neo-Sindarin lexicon containing <strong>${words.length}</strong> entries.</p>
    <p style="margin-top:1rem">Words attested by Tolkien, reconstructions from Noldorin, Gnomish, and Quenya, and carefully constructed neologisms — with etymologies, cognates, and phonetic development references.</p>
    <div style="margin-top:2rem; display:flex; flex-wrap:wrap; gap:1rem;">
      <a href="sindarin-english.html" class="tag" style="font-size:0.85rem; padding:0.5rem 1rem; text-decoration:none;">Sindarin → English</a>
      <a href="english-sindarin.html" class="tag" style="font-size:0.85rem; padding:0.5rem 1rem; text-decoration:none;">English → Sindarin</a>
      <a href="by-grammar.html" class="tag" style="font-size:0.85rem; padding:0.5rem 1rem; text-decoration:none;">By Grammar</a>
      <a href="by-category.html" class="tag" style="font-size:0.85rem; padding:0.5rem 1rem; text-decoration:none;">By Category</a>
    </div>
  </main>
  <footer class="site-footer">
    NS Dictionary — A Neo-Sindarin Lexicon · Not affiliated with the Tolkien Estate
  </footer>
</body>
</html>`;
writeOut('index.html', indexHtml);
console.log('✓ Index page built');

// ── Build Search Page ───────────────────────────────────────────────────────

const searchData = words.map(w => ({
  id: w.uuid,
  s: w.sindarin,
  e: w.english.join(', '),
  g: grammarLabel(w),
}));

const searchHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search — NS Dictionary</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/tengwar.css">
  <link rel="stylesheet" href="css/cirth.css">
  <style>
    .search-box { width: 100%; padding: 0.6rem 1rem; font-family: var(--font-sans);
      font-size: 0.95rem; border: 2px solid var(--border); border-radius: 4px;
      background: var(--parchment-light); color: var(--ink); }
    .search-box:focus { outline: none; border-color: var(--accent); }
    .search-hint { font-size: 0.78rem; color: var(--ink-muted); margin-top: 0.35rem;
      font-family: var(--font-sans); }
    .search-error { color: #a33; font-size: 0.8rem; margin-top: 0.3rem;
      font-family: var(--font-sans); }
    .search-status { font-size: 0.8rem; color: var(--ink-muted); margin: 0.8rem 0 0.4rem;
      font-family: var(--font-sans); }
    .search-field-toggle { margin: 0.6rem 0; font-family: var(--font-sans); font-size: 0.8rem;
      color: var(--ink-light); display: flex; gap: 1rem; flex-wrap: wrap; }
    .search-field-toggle label { cursor: pointer; display: flex; align-items: center; gap: 0.3rem; }
  </style>
</head>
<body>
  <header class="site-header">
    <a href="index.html" class="site-title">NS Dictionary</a>
    <nav class="site-nav">
      <a href="sindarin-english.html">Sindarin → English</a>
      <a href="english-sindarin.html">English → Sindarin</a>
      <a href="by-grammar.html">By Grammar</a>
      <a href="by-category.html">By Category</a>
      <a href="search.html">Search</a>
    </nav>
  </header>
  <main class="main-content">
    <h1 class="page-title">Search</h1>
    <input type="text" class="search-box" id="q" placeholder="Type a regex pattern…" autofocus>
    <div class="search-hint">Regular expressions supported — e.g. <code>^gal</code>, <code>th[aeiou]n</code>, <code>tree|wood</code></div>
    <div class="search-field-toggle">
      Search in:
      <label><input type="checkbox" id="fSin" checked> Sindarin</label>
      <label><input type="checkbox" id="fEng" checked> English</label>
    </div>
    <div id="error" class="search-error"></div>
    <div id="status" class="search-status"></div>
    <ul id="results" class="word-list"></ul>
  </main>
  <footer class="site-footer">
    NS Dictionary — A Neo-Sindarin Lexicon · Not affiliated with the Tolkien Estate
  </footer>
  <script>
  (function(){
    var W=${JSON.stringify(searchData)};
    var q=document.getElementById('q'),res=document.getElementById('results'),
        err=document.getElementById('error'),stat=document.getElementById('status'),
        fSin=document.getElementById('fSin'),fEng=document.getElementById('fEng');
    function run(){
      var v=q.value; err.textContent=''; stat.textContent=''; res.innerHTML='';
      if(!v){stat.textContent=W.length+' words total';return;}
      var re;
      try{re=new RegExp(v,'i');}catch(e){err.textContent='Invalid regex: '+e.message;return;}
      var sin=fSin.checked,eng=fEng.checked,hits=[];
      for(var i=0;i<W.length;i++){
        var w=W[i],m=false;
        if(sin&&re.test(w.s))m=true;
        if(eng&&re.test(w.e))m=true;
        if(m)hits.push(w);
      }
      stat.textContent=hits.length+' of '+W.length+' words';
      var h='';
      for(var j=0;j<hits.length;j++){
        var w=hits[j];
        h+='<li><span><a href="words/'+w.id+'.html" class="word-entry-sindarin">'+esc(w.s)+'</a> '
          +'<span class="word-entry-grammar">'+esc(w.g)+'</span></span>'
          +'<span class="word-entry-english">'+esc(w.e)+'</span></li>';
      }
      res.innerHTML=h;
    }
    function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    q.addEventListener('input',run);
    fSin.addEventListener('change',run);
    fEng.addEventListener('change',run);
    run();
  })();
  </script>
</body>
</html>`;
writeOut('search.html', searchHtml);
console.log('✓ Search page built');

// ── Save Manifest ────────────────────────────────────────────────────────────

writeFileSync(MANIFEST_PATH, JSON.stringify(newManifest, null, 2), 'utf-8');
console.log(`\nBuild complete. Output: ${OUT}`);
