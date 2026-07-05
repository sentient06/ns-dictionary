# NS Dictionary

A Neo-Sindarin dictionary static site generator. Includes words attested by Tolkien, reconstructions from Noldorin, Gnomish, and Quenya, references to Primitive Eldarin roots, and neologisms — with etymologies, cognates, tengwar/cirth spellings, and phonetic development links.

## Project Structure

```
ns-dictionary/
├── data/
│   ├── words.json          # All word entries
│   └── roots.json          # Shared PE roots & primitive words
├── lib/
│   └── conjugator.mjs      # Verb conjugation engine (basic, derived, half-strong)
├── templates/
│   ├── word.html           # Single word page template
│   └── list.html           # List page template (all list views)
├── static/
│   ├── css/
│   │   ├── style.css       # Parchment-style theme
│   │   ├── tengwar.css     # Tengwar @font-face declarations
│   │   └── cirth.css       # Cirth @font-face declarations
│   ├── tengwar/            # Tengwar font files (.eot, .woff, .ttf, .svg)
│   └── cirth/              # Cirth font files
├── build.mjs               # Build script (incremental support)
├── docs/                   # Generated output (GitHub Pages source)
├── .build-manifest.json    # Content hashes for incremental builds (git-ignored)
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions: build & deploy on push
└── package.json
```

## Quick Start

**Requirements:** Node.js ≥ 18

```bash
# Build the site (incremental — only changed words rebuilt)
npm run build

# Full rebuild (regenerates all pages)
npm run build:full

# Preview locally
npm run serve
# → opens at http://localhost:3000

# Clean generated files
npm run clean
```

## Data Schema

### `data/words.json`

An array of word objects. Each word has the following fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, used as the HTML filename (`words/{id}.html`) |
| `sindarin` | string | Sindarin headword form |
| `spellings` | object | Dialect-keyed alternative spellings: `{ "north": "form", "gondorian": "form" }`. Keys: `north` (North Sindarin), `gondorian` (Gondorian Sindarin). The main `sindarin` field is the Classic Sindarin form. |
| `ipa` | string | IPA pronunciation |
| `tengwar` | string | Tengwar spelling (empty if not yet added) |
| `cirth` | string | Cirth/rune spelling (empty if not yet added) |
| `english` | string[] | English glosses |
| `grammar` | string[] | Parts of speech: `["noun"]`, `["noun", "adjective"]`. Values: `"noun"`, `"verb"`, `"adjective"`, `"adverb"`, `"preposition"`, `"pronoun"`, `"number"`, `"conjunction"`, `"article"`, `"interjection"`, etc. |
| `inflection` | object\|null | Noun/adjective inflection (see below). `null` for verbs. |
| `gender` | string | Grammatical gender (if applicable) |
| `category` | string | Semantic category key (see Categories below) |
| `ids_chapter` | string | IDS semantic chapter key (typically same as `category`) |
| `type` | string | **`"attested"`**, **`"reconstructed"`**, or **`"neologism"`** |
| `source` | string | Origin of the word (see Sources below) |
| `status` | string | For neologisms: `""`, `"accepted"`, or `"experimental"` |
| `noldorin_form` | string | Original Noldorin form, if different from Sindarin |
| `eldamo_id` | string | Numeric Eldamo ID (e.g. `"1527889125"`) → links to `eldamo.org/content/words/word-{id}.html` |
| `etymology` | object | Etymology block (see below) |
| `cognates` | object | Key-value pairs: `{ "quenya": "form", "telerin": "form", ... }` |
| `conjugation` | object\|null | Verb conjugation data (see below) |
| `notes` | string | Free-text notes |
| `references` | string[] | Source abbreviations: `"LotR"`, `"Silm"`, `"Etym"`, `"PE17"`, etc. |

#### `type` Values

| Value | Meaning |
|---|---|
| `attested` | Directly attested in Tolkien's writings; has an Eldamo page |
| `reconstructed` | Reconstructed from an older source language (see `source`) |
| `neologism` | Newly coined word for Neo-Sindarin |

#### `source` Values

| Value | Meaning |
|---|---|
| `tolkien` | Attested by Tolkien |
| `gnomish` | Reconstructed from Gnomish (typically has Eldamo page) |
| `noldorin` | Reconstructed from Noldorin (may differ phonologically; use `noldorin_form`) |
| `quenya` | Reconstructed from attested Quenya |
| `quenya_neologism` | Based on a Quenya neologism (treated as Sindarin neologism) |
| `primitive_elvish` | Neologism derived from PE roots |
| `ancient_telerin` | Neologism derived from Ancient Telerin |
| `old_sindarin` | Neologism derived from Old Sindarin |
| `sindarin_compound` | Neologism formed as a Sindarin compound |

#### `status` Values (neologisms only)

| Value | Meaning |
|---|---|
| `""` | Not applicable (attested/reconstructed words) |
| `accepted` | Broadly accepted in the Neo-Sindarin community |
| `experimental` | Debated or liable to change |

#### Inflection Object (nouns/adjectives only)

| Field | Type | Description |
|---|---|---|
| `base` | string | The headword form |
| `singular` | string | Singular form (only filled when the base is a plural) |
| `plural` | string | Plural form (only filled when the base is a singular — the common case) |

Logic: if `plural` is provided, the base is the singular. If `singular` is provided, the base is the plural (rare, for pluralia tantum words). The "other" form is displayed as a label under the headword (e.g. `PLURAL Edain`).

```json
"inflection": {
  "base": "Adan",
  "singular": "",
  "plural": "Edain"
}
```

#### Etymology Object

| Field | Type | Description |
|---|---|---|
| `root_refs` | string[] | Array of IDs referencing entries in `data/roots.json` |
| `primitive` | object\|null | Primitive Eldarin form: `{ "form": "*atanō", "eldamo_id": "" }` |
| `development` | array | Phonetic development chain (see below) |
| `elements` | array | Morpheme breakdown for compounds/neologisms (see below) |
| `quettamorphosis_url` | string | Link to Quettamorphosis for phonetic development details |

The `development` array alternates between form and rule steps. Each step can link to Eldamo:

```json
"development": [
  { "form": "CE *atanō", "eldamo_id": "" },
  { "rule": ">", "eldamo_id": "" },
  { "form": "OS *atano", "eldamo_id": "" },
  { "rule": ">", "eldamo_id": "" },
  { "form": "S adan", "eldamo_id": "" }
]
```

Fill in `eldamo_id` on any step to make it a clickable link. Rules render as `›` arrows.

Each element in `elements`:

| Field | Type | Description |
|---|---|---|
| `form` | string | The morpheme (e.g. `"presta-"`, `"-nnen"`) |
| `gloss` | string | Meaning of the element |
| `type` | string | Morpheme type: `"verb_stem"`, `"suffix"`, `"prefix"`, `"root"`, `"noun_stem"`, etc. |

#### Conjugation Object (verbs only, `null` for non-verbs)

| Field | Type | Description |
|---|---|---|
| `class` | string | Verb class: `"basic"`, `"derived"`, or `"half-strong"` |
| `irregular` | boolean | Whether the verb has irregular/overridden forms |
| `overrides` | object | Optional. Per-cell overrides (see below) |

Setting `class` is all that's needed for a regular verb — the conjugation engine (`lib/conjugator.mjs`) auto-generates all tenses and forms at build time:

```json
"conjugation": {
  "class": "derived",
  "irregular": false
}
```

##### Verb Classes

| Class | Also known as | Description | Example |
|---|---|---|---|
| `basic` | I-stem | Consonant-final root verbs | `car-` (to do) |
| `derived` | A-stem | Vowel-final verbs ending in `-a` | `presta-` (to affect) |
| `half-strong` | -tā verbs | Derived from CE suffix *-tā* | `tangada-` (to make firm) |

##### Person/Number Slots

Each tense is a map of 10 person keys:

| Key | Label | Suffix (present, derived) |
|---|---|---|
| `sg1` | 1st sg. | `-n` |
| `sg2f` | 2nd sg. fam. | `-g` |
| `sg2p` | 2nd sg. pol. | `-l` |
| `sg2arch` | 2nd sg. arch. | `-dh` |
| `sg3` | 3rd sg. | (nothing) |
| `pl1e` | 1st pl. excl. | `-f` |
| `pl1i` | 1st pl. incl. | `-b` |
| `pl2f` | 2nd pl. fam. | `-gir` |
| `pl2p` | 2nd pl. pol. | `-dhir` |
| `pl3` | 3rd pl. | `-r` |

##### Generated Tenses

| Tense key | Generated for |
|---|---|
| `present` | basic, derived |
| `past` | basic (single past) |
| `past_transitive` | derived |
| `past_intransitive` | derived |
| `future` | basic, derived |

##### Generated Other Forms

| Key | Label |
|---|---|
| `pres_act_part` | Present active participle |
| `past_act_part` | Past active participle |
| `pass_part_sg` | Passive past participle (sg.) |
| `pass_part_pl` | Passive past participle (pl.) |
| `imperative` | Imperative |
| `infinitive` | Infinitive |
| `gerund` | Gerund / verbal noun |

##### Overrides (irregular verbs)

Use `overrides` to replace, extend, or mark individual forms as defective:

```json
"conjugation": {
  "class": "basic",
  "irregular": true,
  "overrides": {
    "tenses": {
      "past": {
        "sg3": "special-form",
        "pl3": ""
      }
    },
    "forms": {
      "gerund": "custom-gerund",
      "imperative": ""
    }
  }
}
```

Override rules:
- **`"some-form"`** — replaces the auto-generated value with this string
- **`""`** (empty string) — marks the form as **defective** (displayed as `—`)
- **absent or `null`** — uses the auto-generated form unchanged
- Overrides can also add entirely new tenses not produced by the engine

### `data/roots.json`

An array of Primitive Eldarin roots and words, shared across multiple word entries.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID, referenced by `etymology.root_refs` in words |
| `form` | string | Root form as conventionally written (e.g. `"AT(AT)"`, `"GALAD"`) |
| `gloss` | string | Meaning of the root |
| `language` | string | `"primitive_elvish"`, `"ancient_telerin"`, `"old_sindarin"`, etc. |
| `eldamo_id` | string | Numeric Eldamo ID (if the root has an Eldamo page) |
| `notes` | string | Free-text notes |

Multiple words can reference the same root via `root_refs`, and a single word can reference multiple roots.

#### Semantic Categories

Used in `category` and `ids_chapter` fields:

`physical_world`, `body`, `motion`, `people`, `kinship`, `animals`, `food`, `clothing`, `dwelling`, `agriculture`, `spatial`, `quantity`, `time`, `sense`, `emotion`, `cognition`, `speech`, `social`, `warfare`, `law`, `religion`, `quality`, `possession`, `tools`, `music`

## Generated Pages

The build produces the following pages in `docs/`:

| Page | Description |
|---|---|
| `index.html` | Home page with word count and navigation |
| `sindarin-english.html` | All words sorted alphabetically by Sindarin, split by first letter |
| `english-sindarin.html` | All words sorted by English gloss, split by first letter |
| `by-grammar.html` | Words grouped by part of speech |
| `by-category.html` | Words grouped by IDS semantic chapter |
| `words/{id}.html` | Individual word page with full details |

## Incremental Builds

The build script maintains a `.build-manifest.json` file containing SHA-256 hashes of each word's JSON data.

- `npm run build` — compares each word's current hash against the manifest. Only words whose data has changed are regenerated. Existing HTML files for unchanged words are preserved.
- `npm run build:full` — ignores the manifest and regenerates everything.
- List pages and the index are rebuilt whenever any word data changes.

## GitHub Pages Deployment

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main` that changes files in `data/`, `templates/`, `static/`, or `build.mjs`. It:

1. Caches `.build-manifest.json` and `docs/` between runs for incremental builds
2. Runs `node build.mjs` (incremental)
3. Deploys the `docs/` folder to GitHub Pages

To enable: go to your GitHub repo → Settings → Pages → Source → **GitHub Actions**.

You can also trigger a manual deploy via the **workflow_dispatch** event in the Actions tab.

## CSV Import

The import script reads a CSV file and merges it into `data/words.json`. Words are matched by `uuid`.

```bash
# Preview what would change (no files written)
node scripts/import-csv.mjs path/to/words.csv --dry-run

# Import for real
node scripts/import-csv.mjs path/to/words.csv
```

**Merge rules:**
- Row with matching `uuid` → updates that word (overwrites all CSV-provided fields)
- Row with empty `uuid` → creates a new word with a generated UUID
- Words in `words.json` not present in the CSV → kept unchanged
- The CSV never deletes words

### CSV Column Reference

| Column | Maps to | Format |
|---|---|---|
| `uuid` | `uuid` | UUID string (leave empty for new words) |
| `sindarin` | `sindarin` | Headword |
| `spellings` | `spellings` | Dialect-keyed pairs: `north:beren; gondorian:beren` |
| `ipa` | `ipa` | IPA string |
| `tengwar` | `tengwar` | Tengwar spelling |
| `cirth` | `cirth` | Cirth spelling |
| `english` | `english` | Semicolon-separated: `bold; daring` |
| `grammar` | `grammar` | Semicolon-separated: `noun; adjective` |
| `gender` | `gender` | Grammatical gender |
| `category` | `category` | Semantic category key |
| `ids_chapter` | `ids_chapter` | IDS chapter (defaults to `category`) |
| `type` | `type` | `attested`, `reconstructed`, `neologism` |
| `source` | `source` | See Sources table above |
| `status` | `status` | `accepted`, `experimental`, or empty |
| `noldorin_form` | `noldorin_form` | Original Noldorin form |
| `eldamo_id` | `eldamo_id` | Numeric Eldamo ID |
| `notes` | `notes` | Free text |
| `references` | `references` | Semicolon-separated: `LotR; Silm; Etym` |
| `inflection_base` | `inflection.base` | Base form (defaults to sindarin) |
| `inflection_singular` | `inflection.singular` | Singular form |
| `inflection_plural` | `inflection.plural` | Plural form |
| `root_refs` | `etymology.root_refs` | Semicolon-separated root IDs: `atat; ber` |
| `primitive_form` | `etymology.primitive.form` | Primitive form: `*atanō` |
| `primitive_eldamo_id` | `etymology.primitive.eldamo_id` | Eldamo ID for primitive |
| `development` | `etymology.development` | Chain: `CE *atanō > OS *atano > S adan` |
| `elements` | `etymology.elements` | Pipe-separated triples: `presta-\|to affect\|verb_stem; -nnen\|past ptcp\|suffix` |
| `quettamorphosis_url` | `etymology.quettamorphosis_url` | Full URL |
| `cognates` | `cognates` | Colon pairs: `quenya:Atan; telerin:Adân` |
| `conjugation_class` | `conjugation.class` | `basic`, `derived`, `half-strong` (empty for non-verbs) |
| `conjugation_irregular` | `conjugation.irregular` | `true` or `false` |

> **Note:** Conjugation overrides (`overrides.tenses`, `overrides.forms`) are too complex for CSV columns. Edit them directly in `words.json` after import.

### UUID Tracking

Every word has a stable `uuid` field (v4 UUID) that persists even if the Sindarin headword or URL slug (`id`) changes. The build manifest (`.build-manifest.json`) uses UUIDs to track which pages need regeneration.

## External Links

- **Eldamo**: Words with an `eldamo_id` link to `https://eldamo.org/content/words/word-{eldamo_id}.html`
- **Quettamorphosis**: Words with a `quettamorphosis_url` link to the phonetic development tool
- **Roots**: Roots in `data/roots.json` with an `eldamo_id` also link to their Eldamo pages
