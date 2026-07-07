# NS Dictionary

A Neo-Sindarin dictionary — static site generator. Includes words attested by Tolkien, reconstructions from Noldorin, Gnomish, and Quenya, references to Primitive Eldarin roots, and neologisms — with etymologies, cognates, Tengwar/Cirth spellings, phonetic development chains, and automatic verb conjugation.

## Quick Start

**Requirements:** Node.js ≥ 18

```bash
# Full rebuild (regenerates all pages from data/words.json)
npm run build:full

# Incremental build (only changed words rebuilt)
npm run build

# Preview locally
npm run serve
# → http://localhost:3000

# Clean generated files
npm run clean
```

## How It Works

### Data Flow

1. **Source of truth** — a published Google Sheets CSV
2. **Sync** — a GitHub Actions cron job fetches the CSV every 6 hours, converts it to JSON, and commits `data/words.json` if anything changed
3. **Build** — the commit triggers a second workflow that builds the static site and deploys to GitHub Pages
4. **Manual** — you can also import a local CSV with `node scripts/import-csv.mjs <file>` or trigger either workflow manually from the Actions tab

### Homonym Merging

Words that produce the same URL slug (e.g. two entries for *man* — "who" and "what") are automatically merged into a single page with numbered senses. Each sense retains its own etymology, tags, references, and notes.

### IPA Display

IPA strings are formatted automatically:
- Multi-character: displayed in slashes — `/la.ew/`
- Single character: displayed in brackets — `[n]`

### Mutation Markers

Words with a primitive initial mutation (e.g. *delch* [nd-]) display the marker next to the headword, following Eldamo conventions.

## Manual Commands

| Command | Description |
|---|---|
| `npm run build` | Incremental build — only regenerates pages whose data changed |
| `npm run build:full` | Full rebuild — regenerates all pages |
| `npm run serve` | Start a local server at `http://localhost:3000` |
| `npm run clean` | Delete `docs/` and `.build-manifest.json` |
| `node scripts/import-csv.mjs <file>` | Import a local CSV into `data/words.json` |
| `node scripts/import-csv.mjs <file> --dry-run` | Preview import without writing |

## Project Structure

```
ns-dictionary/
├── data/
│   ├── words.json              # All word entries (auto-synced from Google Sheets)
│   └── roots.json              # Shared PE roots & primitive words
├── lib/
│   ├── conjugator.mjs          # Verb conjugation engine
│   └── csv-parser.mjs          # Shared CSV parsing & row→word conversion
├── scripts/
│   └── import-csv.mjs          # Manual CSV → words.json importer
├── templates/
│   ├── word.html               # Word page template (supports multiple senses)
│   └── list.html               # List page template (all list views)
├── static/
│   ├── css/
│   │   ├── style.css           # Parchment-style theme
│   │   ├── tengwar.css         # Tengwar @font-face
│   │   └── cirth.css           # Cirth @font-face
│   ├── tengwar/                # Tengwar font files
│   └── cirth/                  # Cirth font files
├── build.mjs                   # Static site generator
├── .github/workflows/
│   ├── deploy.yml              # Build & deploy to GitHub Pages on push
│   └── sync-data.yml           # Fetch Google Sheets CSV & commit words.json
├── .build-manifest.json        # Content hashes for incremental builds (git-ignored)
├── .gitignore
├── CNAME                       # Custom domain (if configured)
└── package.json
```

## CI/CD Workflows

### `sync-data.yml` — Data Sync

- **Triggers:** every 6 hours (cron) or manually
- **What it does:** fetches the published Google Sheets CSV, converts it to `data/words.json`, and commits + pushes if the data changed
- **Requires:** a `PAT_TOKEN` repository secret (fine-grained PAT with Contents: Read and write) so that the push triggers the deploy workflow

### `deploy.yml` — Build & Deploy

- **Triggers:** push to `master` that changes `data/`, `templates/`, `static/`, `lib/`, or `build.mjs`, or manually
- **What it does:** runs `node build.mjs --full` and deploys `docs/` to GitHub Pages
- **Setup:** enable GitHub Pages in repo Settings → Pages → Source → **GitHub Actions**

### The Full Cycle

```
Google Sheets → (sync-data cron) → commits words.json → (deploy on push) → GitHub Pages
```

## Generated Pages

| Page | Description |
|---|---|
| `index.html` | Home page with word count and navigation |
| `sindarin-english.html` | All words sorted alphabetically by Sindarin headword |
| `english-sindarin.html` | All words sorted by English gloss |
| `by-grammar.html` | Words grouped by part of speech |
| `by-category.html` | Words grouped by IDS semantic chapter |
| `search.html` | Client-side regex search across Sindarin and English fields |
| `words/{slug}.html` | Individual word page (slug derived from headword) |

## Incremental Builds

The build script maintains `.build-manifest.json` with SHA-256 hashes of each page's data.

- `npm run build` — only rebuilds pages whose content hash changed
- `npm run build:full` — ignores the manifest and rebuilds everything
- List pages, index, and search are rebuilt whenever any word data changes
- The `docs/words/` directory is cleaned on every build to remove stale pages

## Data Schema

### `data/words.json`

An array of word objects:

| Field | Type | Description |
|---|---|---|
| `uuid` | string | Stable UUID — persists across renames |
| `id` | string | URL slug derived from headword (used as filename) |
| `mutation_marker` | string | Initial mutation marker, e.g. `"nd-"` (empty if none) |
| `sindarin` | string | Sindarin headword |
| `spellings` | object | Dialect variants: `{ "north": "form", "gondorian": "form" }` |
| `ipa` | string | IPA pronunciation (raw, without slashes/brackets) |
| `tengwar` | string | Tengwar spelling |
| `cirth` | string | Cirth spelling |
| `english` | string[] | English glosses |
| `grammar` | string[] | Parts of speech: `["noun"]`, `["noun", "adjective"]` |
| `inflection` | object\|null | Noun/adjective inflection: `{ base, singular, plural }` |
| `gender` | string | Grammatical gender |
| `category` | string | Semantic category key |
| `ids_chapter` | string | IDS semantic chapter (defaults to `category`) |
| `type` | string | `"attested"`, `"reconstructed"`, `"neologism"`, `"restored"` |
| `source` | string | Word origin (see below) |
| `status` | string | `""`, `"accepted"`, `"experimental"`, `"questioned"` |
| `noldorin_form` | string | Original Noldorin form |
| `eldamo_id` | string | Numeric Eldamo ID |
| `etymology` | object | Etymology: `{ root_refs, primitive, development, elements, quettamorphosis_url }` |
| `cognates` | object | Language-keyed cognates: `{ "quenya": "form" }` |
| `conjugation` | object\|null | Verb conjugation: `{ class, irregular, overrides }` |
| `notes` | string | Free-text notes |
| `references` | string[] | Source abbreviations |
| `hidden` | string | If non-empty, word is flagged as hidden |

#### `type` Values

| Value | Meaning |
|---|---|
| `attested` | Directly from Tolkien's writings |
| `reconstructed` | Reconstructed from an older source language |
| `neologism` | Newly coined for Neo-Sindarin |
| `restored` | Rejected by Tolkien but restored due to lack of replacement |

#### `source` Values

| Value | Display Label |
|---|---|
| `tolkien` | *(none)* |
| `gnomish` | from Gnomish |
| `noldorin` | from Noldorin |
| `quenya` | from Quenya |
| `quenya_neologism` | from Q. neologism |
| `primitive_elvish` | from PE root |
| `ancient_telerin` | from A. Telerin |
| `old_sindarin` | from Old Sindarin |
| `sindarin_compound` | S. compound |
| `eldamo` | from Eldamo |
| `elaran` | by Elaran |
| `telpefindele` | by Telpefindelë |
| `FJNS` | from FJNS |

#### `status` Values

| Value | Meaning |
|---|---|
| `""` | Not applicable (attested/reconstructed) |
| `accepted` | Broadly accepted in the community |
| `experimental` | Debated or liable to change |
| `questioned` | Validity questioned |

#### Semantic Categories

`physical_world`, `body`, `motion`, `people`, `kinship`, `animals`, `food`, `clothing`, `dwelling`, `agriculture`, `spatial`, `quantity`, `time`, `sense`, `emotion`, `cognition`, `speech`, `social`, `warfare`, `law`, `religion`, `quality`, `possession`, `tools`, `music`, `grammar`, `different`, `size`, `spatial relations`

### `data/roots.json`

Array of Primitive Eldarin roots, referenced by `etymology.root_refs`:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID |
| `form` | string | Root form (e.g. `"AT(AT)"`) |
| `gloss` | string | Meaning |
| `language` | string | `"primitive_elvish"`, `"ancient_telerin"`, etc. |
| `eldamo_id` | string | Numeric Eldamo ID |
| `notes` | string | Free-text notes |

## Verb Conjugation Engine

The build script auto-generates full conjugation tables for verbs via `lib/conjugator.mjs`.

### Verb Classes

| Class | Also known as | Description | Example |
|---|---|---|---|
| `basic` | I-stem | Consonant-final root verbs | `car-` (to do) |
| `derived` | A-stem | Vowel-final verbs ending in `-a` | `presta-` (to affect) |
| `half-strong` | -tā verbs | Derived from CE suffix *-tā* | `tangada-` (to make firm) |

### Person/Number Suffixes

| Key | Label | Suffix |
|---|---|---|
| `sg1` | 1st sg. | `-n` |
| `sg2f` | 2nd sg. familiar | `-g` |
| `sg2p` | 2nd sg. polite | `-l` |
| `sg2arch` | 2nd sg. archaic | `-dh` |
| `sg3` | 3rd sg. | *(none)* |
| `pl1e` | 1st pl. exclusive | `-f` |
| `pl1i` | 1st pl. inclusive | `-b` |
| `pl2f` | 2nd pl. familiar | `-gir` |
| `pl2p` | 2nd pl. polite | `-dhir` |
| `pl3` | 3rd pl. | `-r` |

### Overrides

Irregular verbs use `conjugation.overrides` to replace or suppress individual forms:

- `"custom-form"` — replaces the auto-generated value
- `""` (empty string) — marks as defective (displayed as `—`)
- absent/`null` — uses the auto-generated form

Overrides are too complex for CSV and must be edited directly in `words.json`.

## CSV Import

### Google Sheets (automatic)

The `sync-data.yml` workflow fetches the published CSV automatically. Only rows with a `uuid` value are imported.

### Local CSV (manual)

```bash
node scripts/import-csv.mjs path/to/words.csv           # import
node scripts/import-csv.mjs path/to/words.csv --dry-run  # preview
```

**Merge rules:**
- Row with matching `uuid` → updates that word
- Row with empty `uuid` → creates a new word with a generated UUID
- Existing words not in the CSV → kept unchanged
- The CSV never deletes words

### CSV Column Reference

| Column | Format |
|---|---|
| `uuid` | UUID string (leave empty for new words) |
| `mutation_marker` | e.g. `nd-` |
| `sindarin` | Headword |
| `spellings` | Dialect pairs: `north:beren; gondorian:beren` |
| `ipa` | IPA string (without slashes) |
| `tengwar` | Tengwar spelling |
| `cirth` | Cirth spelling |
| `english` | Semicolon-separated: `bold; daring` |
| `grammar` | Semicolon-separated: `noun; adjective` |
| `gender` | Grammatical gender |
| `category` | Semantic category key |
| `ids_chapter` | IDS chapter (defaults to `category`) |
| `type` | `attested`, `reconstructed`, `neologism`, `restored` |
| `source` | See source table above |
| `status` | `accepted`, `experimental`, `questioned`, or empty |
| `noldorin_form` | Original Noldorin form |
| `eldamo_id` | Numeric Eldamo ID |
| `notes` | Free text |
| `references` | Semicolon-separated: `LotR; PE17/44` |
| `inflection_base` | Base form (defaults to sindarin) |
| `inflection_singular` | Singular form |
| `inflection_plural` | Plural form |
| `root_refs` | Semicolon-separated root IDs |
| `primitive_form` | Primitive form |
| `primitive_eldamo_id` | Eldamo ID for primitive |
| `development` | Chain with optional links: `form [>](url) form > form` |
| `elements` | Pipe-separated triples: `form\|gloss\|type; form\|gloss\|type` |
| `quettamorphosis_url` | Full URL |
| `cognates` | Colon pairs: `quenya:Atan; telerin:Adân` |
| `conjugation_class` | `basic`, `derived`, `half-strong` |
| `conjugation_irregular` | `true` or `false` |
| `hidden` | Any non-empty value flags the word as hidden |

Column order does not matter — the import matches by header name.

## External Links

All external links use `target="_blank" rel="noopener"`.

- **Eldamo**: `https://eldamo.org/content/words/word-{eldamo_id}.html`
- **Quettamorphosis**: linked via `quettamorphosis_url` for phonetic development visualization
- **Roots**: roots in `data/roots.json` with an `eldamo_id` link to their Eldamo pages
