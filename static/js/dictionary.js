/**
 * Lookup, search, and entry previews.
 * All three read /lexicon.json, which the build generates from data/words.json.
 */
(function () {
  const lexiconUrl = document.currentScript?.dataset.lexicon || '/lexicon.json';

  const TYPE_LABELS = {
    attested: 'Attested',
    restored: 'Restored',
    reconstructed: 'Reconstructed',
    neologism: 'Neologism',
  };
  const CONF_LABELS = ['Unreviewed', 'Dubious', 'Debated', 'Accepted', 'Established', 'Recommended'];
  const STATUS_LABELS = {
    accepted: 'Accepted',
    experimental: 'Experimental',
    questioned: 'Questioned',
  };

  let lexiconPromise = null;

  function loadLexicon() {
    if (!lexiconPromise) {
      lexiconPromise = fetch(lexiconUrl).then((res) => {
        if (!res.ok) throw new Error('Could not load the lexicon');
        return res.json();
      });
    }
    return lexiconPromise;
  }

  function fold(value) {
    return (value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatIpa(raw) {
    if (!raw) return '';
    return raw.length === 1 ? '[' + raw + ']' : '/' + raw + '/';
  }

  function snippet(value, limit) {
    const text = (value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit - 1).trimEnd() + '…';
  }

  function isRegexQuery(query) {
    return /[.*+?^${}()|[\]\\]/.test(query);
  }

  function wordHref(id) {
    const inWordPage = /\/words\//.test(location.pathname);
    return (inWordPage ? '../' : '') + 'words/' + encodeURIComponent(id) + '.html';
  }

  function senseMatchesFilter(sense, filters) {
    if (filters.type === '!neologism') {
      if (sense.type === 'neologism') return false;
    } else if (filters.type && sense.type !== filters.type) {
      return false;
    }
    if (filters.grammar && sense.grammar.indexOf(filters.grammar) === -1) return false;
    if (filters.confidence) {
      const confidence = sense.confidence;
      if (filters.confidence === '3+') {
        if (confidence == null || confidence < 3) return false;
      } else if (confidence !== parseInt(filters.confidence, 10)) {
        return false;
      }
    }
    if (filters.longman === 'listed') {
      if (sense.longman !== 'true' && sense.longman !== 'maybe') return false;
    } else if (filters.longman && sense.longman !== filters.longman) {
      return false;
    }
    return true;
  }

  function scoreEntry(entry, query, fields) {
    const q = query.trim();
    if (!q) return { score: 1 };
    const regexMode = isRegexQuery(q);
    let re = null;
    if (regexMode) {
      try {
        re = new RegExp(q, 'i');
      } catch (err) {
        return { error: err.message };
      }
    }
    const foldedQuery = fold(q);
    let best = 0;

    function consider(text, points) {
      if (!text) return;
      if (regexMode) {
        if (re.test(text)) best = Math.max(best, points);
        return;
      }
      const folded = fold(text);
      if (folded === foldedQuery) best = Math.max(best, points + 15);
      else if (folded.startsWith(foldedQuery)) best = Math.max(best, points);
      else if (folded.includes(foldedQuery)) best = Math.max(best, Math.max(8, points - 18));
    }

    if (fields.sindarin) {
      if (regexMode) {
        consider(entry.sindarin, 80);
      } else {
        const head = fold(entry.sindarin.replace(/-$/, ''));
        if (head === foldedQuery) best = Math.max(best, 100);
        else if (head.startsWith(foldedQuery)) best = Math.max(best, 82);
        else if (head.includes(foldedQuery)) best = Math.max(best, 64);
      }
    }

    for (const sense of entry.senses) {
      if (fields.english) {
        for (const gloss of sense.english) consider(gloss, 56);
        consider(sense.definition, 42);
      }
      if (fields.roots) consider(sense.roots, 36);
      if (fields.notes) consider(sense.notes, 24);
      if (fields.catalogue) {
        consider(sense.ids_code, 52);
        consider(sense.conception, 52);
      }
    }

    return { score: best };
  }

  function searchLexicon(lexicon, query, fields, filters) {
    const q = query.trim();
    if (q && isRegexQuery(q)) {
      try {
        new RegExp(q, 'i');
      } catch (err) {
        return { error: err.message, hits: [] };
      }
    }

    const hits = [];
    for (const entry of lexicon) {
      const senses = entry.senses.filter((sense) => senseMatchesFilter(sense, filters));
      if (!senses.length) continue;
      const result = scoreEntry({ ...entry, senses }, q, fields);
      if (result.error) return { error: result.error, hits: [] };
      if (!q || result.score > 0) hits.push({ entry, senses, score: result.score });
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return fold(a.entry.sindarin).localeCompare(fold(b.entry.sindarin));
    });
    return { hits };
  }

  function metaLine(sense) {
    const bits = [];
    if (TYPE_LABELS[sense.type]) bits.push(TYPE_LABELS[sense.type]);
    if (sense.type === 'neologism' && sense.confidence != null && CONF_LABELS[sense.confidence]) {
      bits.push(CONF_LABELS[sense.confidence]);
    }
    if (STATUS_LABELS[sense.status]) bits.push(STATUS_LABELS[sense.status]);
    if (sense.longman === 'true') bits.push('Longman');
    else if (sense.longman === 'maybe') bits.push('Longman?');
    if (sense.ids_code) bits.push('IDS ' + sense.ids_code);
    return bits.join(' · ');
  }

  function glossOf(sense) {
    return (sense.english || []).join(', ') || sense.definition || '';
  }

  function definitionOf(sense) {
    const gloss = (sense.english || []).join(', ');
    const definition = (sense.definition || '').trim();
    if (!definition || fold(definition) === fold(gloss)) return '';
    return definition;
  }

  function renderCard(entry, options) {
    const senses = (options.senses || entry.senses).slice(0, options.expanded ? undefined : 3);
    const hiddenSenses = (options.senses || entry.senses).length - senses.length;
    const href = wordHref(entry.id);
    const ipa = formatIpa(entry.ipa);
    let html = '<article class="preview-card" data-href="' + escapeHtml(href) + '">';
    html += '<div class="preview-head">';
    html += '<a class="preview-word" href="' + escapeHtml(href) + '">' + escapeHtml(entry.sindarin) + '</a>';
    if (entry.mutation) html += '<span class="preview-mutation">[' + escapeHtml(entry.mutation) + ']</span>';
    if (ipa) html += '<span class="preview-ipa">' + escapeHtml(ipa) + '</span>';
    html += '</div>';
    if (options.scripts && (entry.tengwar || entry.cirth)) {
      html += '<div class="preview-scripts">';
      if (entry.tengwar) html += '<span class="tengwar">' + escapeHtml(entry.tengwar) + '</span>';
      if (entry.cirth) html += '<span class="cirth">' + escapeHtml(entry.cirth) + '</span>';
      html += '</div>';
    }
    for (let i = 0; i < senses.length; i++) {
      const sense = senses[i];
      const total = (options.senses || entry.senses).length;
      html += '<div class="preview-sense">';
      if (total > 1) html += '<span class="preview-num">' + (i + 1) + '</span>';
      if (sense.grammar.length) {
        html += '<span class="preview-pos">' + escapeHtml(sense.grammar.join(', ')) + '</span> ';
      }
      html += '<span class="preview-gloss">' + escapeHtml(glossOf(sense)) + '</span>';
      if (sense.inflection) html += '<span class="preview-infl">' + escapeHtml(sense.inflection) + '</span>';
      const definition = definitionOf(sense);
      if (options.expanded && definition) {
        html += '<p class="preview-definition">' + escapeHtml(snippet(definition, 280)) + '</p>';
      }
      const meta = metaLine(sense);
      if (meta) html += '<p class="preview-meta">' + escapeHtml(meta) + '</p>';
      if (options.expanded && sense.notes) {
        html += '<p class="preview-notes">' + escapeHtml(snippet(sense.notes, 180)) + '</p>';
      }
      html += '</div>';
    }
    if (hiddenSenses > 0) {
      html += '<p class="preview-more">' + hiddenSenses + ' more ' + (hiddenSenses === 1 ? 'sense' : 'senses') + '</p>';
    }
    html += '</article>';
    return html;
  }

  function bindLookup(form) {
    const input = form.querySelector('input[type="search"]');
    const panel = form.querySelector('.lookup-panel');
    if (!input || !panel) return;

    let items = [];
    let active = -1;
    let timer = 0;

    if (!panel.id) panel.id = 'lookup-' + Math.random().toString(36).slice(2, 8);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'listbox');

    function close() {
      panel.hidden = true;
      panel.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      active = -1;
      items = [];
    }

    function paint() {
      panel.querySelectorAll('.preview-card').forEach((card, index) => {
        card.classList.toggle('is-active', index === active);
        if (index === active) card.scrollIntoView({ block: 'nearest' });
      });
    }

    async function run() {
      const query = input.value.trim();
      if (!query) {
        close();
        return;
      }
      let lexicon;
      try {
        lexicon = await loadLexicon();
      } catch (err) {
        panel.hidden = false;
        panel.innerHTML = '<p class="lookup-message">' + escapeHtml(err.message) + '</p>';
        return;
      }
      if (input.value.trim() !== query) return;

      const found = searchLexicon(lexicon, query, {
        sindarin: true,
        english: true,
        roots: true,
        notes: false,
        catalogue: true,
      }, { type: '', grammar: '', confidence: '', longman: '' });

      if (found.error) {
        panel.hidden = false;
        panel.innerHTML = '<p class="lookup-message">Invalid regular expression: ' + escapeHtml(found.error) + '</p>';
        input.setAttribute('aria-expanded', 'true');
        return;
      }

      items = found.hits.slice(0, 8);
      active = -1;
      if (!items.length) {
        panel.hidden = false;
        panel.innerHTML = '<p class="lookup-message">No matches</p>';
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      panel.innerHTML = items.map((hit) => renderCard(hit.entry, {
        senses: hit.senses,
        expanded: false,
        scripts: false,
      })).join('');
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 30);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (panel.hidden || !items.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active = Math.min(items.length - 1, active + 1);
        paint();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        active = Math.max(0, active - 1);
        paint();
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        location.href = wordHref(items[active].entry.id);
      }
    });

    panel.addEventListener('mousedown', (event) => {
      const card = event.target.closest('.preview-card');
      if (!card) return;
      event.preventDefault();
      const href = event.target.closest('a')?.getAttribute('href') || card.dataset.href;
      if (href) location.href = href;
    });

    document.addEventListener('click', (event) => {
      if (!form.contains(event.target)) close();
    });

    input.addEventListener('focus', () => {
      if (input.value.trim()) run();
    });
  }

  function bindPreviews() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const host = document.createElement('div');
    host.className = 'entry-preview';
    host.hidden = true;
    document.body.appendChild(host);

    let timer = 0;
    let current = null;
    let byId = null;

    function hide() {
      host.hidden = true;
      host.innerHTML = '';
      current = null;
    }

    async function show(anchor) {
      const id = anchor.getAttribute('data-entry');
      if (!id) return;
      if (!byId) {
        try {
          const lexicon = await loadLexicon();
          byId = new Map(lexicon.map((entry) => [entry.id, entry]));
        } catch {
          return;
        }
      }
      if (current !== anchor) return;
      const entry = byId.get(id);
      if (!entry) return;
      host.innerHTML = renderCard(entry, { expanded: true, scripts: true });
      host.hidden = false;
      const width = Math.min(340, window.innerWidth - 24);
      host.style.width = width + 'px';
      const rect = anchor.getBoundingClientRect();
      const height = host.offsetHeight;
      let left = rect.right + 14;
      if (left + width > window.innerWidth - 12) left = rect.left - 14 - width;
      if (left < 12) left = 12;
      let top = Math.min(rect.top, window.innerHeight - 12 - height);
      if (top < 12) top = 12;
      host.style.left = left + 'px';
      host.style.top = top + 'px';
    }

    document.addEventListener('pointerover', (event) => {
      const anchor = event.target.closest('[data-entry]');
      if (!anchor) return;
      current = anchor;
      clearTimeout(timer);
      timer = setTimeout(() => show(anchor), 180);
    });

    document.addEventListener('pointerout', (event) => {
      const anchor = event.target.closest('[data-entry]');
      if (!anchor) return;
      const next = event.relatedTarget;
      if (next && (anchor.contains(next) || host.contains(next))) return;
      clearTimeout(timer);
      if (current === anchor) hide();
    });

    host.addEventListener('pointerleave', (event) => {
      const next = event.relatedTarget;
      if (next && next.closest && next.closest('[data-entry]') === current) return;
      hide();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hide();
    });
    window.addEventListener('scroll', () => {
      if (!host.hidden) hide();
    }, true);
  }

  function mountSearch(root) {
    const queryInput = root.querySelector('#q');
    const results = root.querySelector('#results');
    const error = root.querySelector('#error');
    const status = root.querySelector('#status');
    const grammarSelect = root.querySelector('#fGram');
    if (!queryInput || !results) return;

    const controls = {
      sindarin: root.querySelector('#fSin'),
      english: root.querySelector('#fEng'),
      roots: root.querySelector('#fRoot'),
      notes: root.querySelector('#fNotes'),
      catalogue: root.querySelector('#fCat'),
      type: root.querySelector('#fType'),
      grammar: grammarSelect,
      confidence: root.querySelector('#fConf'),
      longman: root.querySelector('#fLongman'),
    };

    const params = new URLSearchParams(location.search);
    if (params.get('q')) queryInput.value = params.get('q');

    let lexicon = null;

    function fields() {
      return {
        sindarin: controls.sindarin.checked,
        english: controls.english.checked,
        roots: controls.roots.checked,
        notes: controls.notes.checked,
        catalogue: controls.catalogue.checked,
      };
    }

    function filters() {
      return {
        type: controls.type.value,
        grammar: controls.grammar.value,
        confidence: controls.confidence.value,
        longman: controls.longman.value,
      };
    }

    function run() {
      error.textContent = '';
      if (!lexicon) {
        status.textContent = 'Loading the lexicon…';
        return;
      }
      const query = queryInput.value;
      const active = filters();
      const narrowing = query.trim() || active.type || active.grammar || active.confidence || active.longman;
      if (!narrowing) {
        status.textContent = lexicon.length + ' entries. Type a word, or narrow the list with a filter.';
        results.innerHTML = '';
        return;
      }
      const found = searchLexicon(lexicon, query, fields(), active);
      if (found.error) {
        error.textContent = 'Invalid regular expression: ' + found.error;
        status.textContent = '';
        results.innerHTML = '';
        return;
      }
      const count = found.hits.length;
      status.textContent = count + (count === 1 ? ' entry' : ' entries');
      const expanded = count <= 40;
      results.innerHTML = found.hits.map((hit) => renderCard(hit.entry, {
        senses: hit.senses,
        expanded,
        scripts: expanded,
      })).join('');
    }

    loadLexicon().then((data) => {
      lexicon = data;
      const grammars = new Set();
      for (const entry of lexicon) {
        for (const sense of entry.senses) {
          for (const grammar of sense.grammar) {
            if (grammar) grammars.add(grammar);
          }
        }
      }
      [...grammars].sort().forEach((grammar) => {
        const option = document.createElement('option');
        option.value = grammar;
        option.textContent = grammar;
        grammarSelect.appendChild(option);
      });
      run();
    }).catch((err) => {
      error.textContent = err.message;
      status.textContent = '';
    });

    Object.values(controls).concat(queryInput).forEach((control) => {
      control.addEventListener('input', run);
      control.addEventListener('change', run);
    });

    results.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const card = event.target.closest('.preview-card');
      if (card?.dataset.href) location.href = card.dataset.href;
    });
  }

  function focusSearchOnSlash() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable) return;
      const input = document.getElementById('q')
        || document.querySelector('.home-lookup input')
        || document.querySelector('.head-search input');
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    });
  }

  function boot() {
    document.querySelectorAll('form.head-search, form.lookup').forEach(bindLookup);
    if (document.querySelector('[data-entry]')) bindPreviews();
    const searchApp = document.getElementById('search-app');
    if (searchApp) mountSearch(searchApp);
    focusSearchOnSlash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
