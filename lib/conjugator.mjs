// lib/conjugator.mjs
// Neo-Sindarin verb conjugation engine
// Extracted and adapted from Bardh's Verb Conjugator
// Verb classes: basic (I-stem), derived (A-stem), half-strong (-tā)

const PERSONS = ['sg1','sg2f','sg2p','sg2arch','sg3','pl1e','pl1i','pl2f','pl2p','pl3'];

// ── Suffix Tables ───────────────────────────────────────────────────────────

// I-stem present suffixes (connecting vowel 'i')
const I_PRES = { sg1:'in', sg2f:'ig', sg2p:'il', sg2arch:'idh', sg3:'',
  pl1e:'if', pl1i:'ib', pl2f:'igir', pl2p:'idhir', pl3:'ir' };

// I-stem past suffixes (connecting vowel 'e')
const I_PAST = { sg1:'en', sg2f:'eg', sg2p:'el', sg2arch:'edh', sg3:'',
  pl1e:'ef', pl1i:'eb', pl2f:'egir', pl2p:'edhir', pl3:'er' };

// I-stem future suffixes
const I_FUT = { sg1:'athon', sg2f:'athog', sg2p:'athol', sg2arch:'athodh', sg3:'atha',
  pl1e:'athof', pl1i:'athab', pl2f:'athogir', pl2p:'athodhir', pl3:'athar' };

// A-stem present suffixes (connecting vowel 'o', except pl1i='ab', pl3='ar')
const A_PRES = { sg1:'on', sg2f:'og', sg2p:'ol', sg2arch:'odh', sg3:'',
  pl1e:'of', pl1i:'ab', pl2f:'ogir', pl2p:'odhir', pl3:'ar' };

// A-stem past transitive suffixes (general: double-n)
const A_PAST_T = { sg1:'nnen', sg2f:'nneg', sg2p:'nnel', sg2arch:'nnedh', sg3:'nt',
  pl1e:'nnef', pl1i:'nneb', pl2f:'nnegir', pl2p:'nnedhir', pl3:'nner' };

// A-stem past transitive suffixes for haplology (anna verbs after reduction)
const A_PAST_T_HAPLO = { sg1:'nen', sg2f:'neg', sg2p:'nel', sg2arch:'nedh', sg3:'nt',
  pl1e:'nef', pl1i:'neb', pl2f:'negir', pl2p:'nedhir', pl3:'ner' };

// A-stem past transitive suffixes for V+nna pattern
const A_PAST_T_VNA = { sg1:'nnen', sg2f:'nneg', sg2p:'nnel', sg2arch:'nnedh', sg3:'nt',
  pl1e:'nnef', pl1i:'nneb', pl2f:'nnegir', pl2p:'nnedhir', pl3:'nner' };

// A-stem past intransitive suffixes
const A_PAST_I = { sg1:'ssen', sg2f:'sseg', sg2p:'ssel', sg2arch:'ssedh', sg3:'s(t)',
  pl1e:'ssef', pl1i:'sseb', pl2f:'ssegir', pl2p:'ssedhir', pl3:'sser' };

// A-stem future suffixes
const A_FUT = { sg1:'thon', sg2f:'thog', sg2p:'thol', sg2arch:'thodh', sg3:'tha',
  pl1e:'thof', pl1i:'thab', pl2f:'thogir', pl2p:'thodhir', pl3:'thar' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(verb) {
  return verb.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Build a person map from a stem + sg3 form using suffix table */
function fromStem(stem, sg3, suffixes) {
  const r = {};
  for (const p of PERSONS) {
    r[p] = p === 'sg3' ? sg3 : stem + suffixes[p];
  }
  return r;
}

function getEndingGroup(s) {
  const m = s.match(/(ph|th|dh|ng|[bdgflnrwv])$/);
  return m ? m[0] : undefined;
}

function removeNOrMPrefix(verb) {
  if ((verb.startsWith('n') || verb.startsWith('m')) && verb.length > 1) {
    const rest = verb.slice(1);
    if (['d', 'b', 'g'].includes(rest[0])) return rest;
  }
  return verb;
}

// ── Vowel / Mutation Maps ────────────────────────────────────────────────────

const VOWEL_CHANGE = { i:'í', e:'í', o:'ú', u:'ú', a:'ó', y:'ú' };
const VOWEL_CHANGE_3 = { i:'i', e:'i', o:'u', u:'u', a:'o', y:'y' };
const SPECIAL_G_MAP = { i:['i','í'], e:['e','í'], o:['o','ú'], u:['u','ú'], a:['au','ó'] };

const MUTATIONS = {
  p:'b', t:'d', c:'g', b:'v', d:'dh', g:'', m:'v', s:'h', h:'ch',
  mb:'mm', nd:'nn', ng:'ng', th:'th', rh:'thr', lh:'thl', hw:'chw',
  gw:'w', gl:'l', gr:'r', br:'vr', dr:'dhr', bl:'vl',
};

const BDG_MAP = {
  d: ['nt','nn'], g: ['nc','ng'], b: ['mp','mm'], ph: ['mp','mm'],
};

// ── I-stem Present ───────────────────────────────────────────────────────────

const I_PRES_SPECIALS = {
  gwae:  { sg1:'gwaen', sg2f:'gwaeg', sg2p:'gwael', sg2arch:'gwaedh', sg3:'gwae',
           pl1e:'gwaef', pl1i:'gwaeb', pl2f:'gwaegir', pl2p:'gwaedhir', pl3:'gwaer' },
  gwaew: { sg1:'gwaewin', sg2f:'gwaewig', sg2p:'gwaewil', sg2arch:'gwaewidh', sg3:'gwaew',
           pl1e:'gwaewif', pl1i:'gwaewib', pl2f:'gwaewigir', pl2p:'gwaewidhir', pl3:'gwaewir' },
  iav:   { sg1:'ievin', sg2f:'ievig', sg2p:'ievil', sg2arch:'ievidh', sg3:'iâv',
           pl1e:'ievif', pl1i:'ievib', pl2f:'ievigir', pl2p:'ievidhir', pl3:'ievir' },
};

function iStemApplyVowelChanges(verb, person, suffixes) {
  const vowels = verb.match(/[aeiou]/g);
  const count = vowels ? vowels.length : 0;
  const is3 = person === 'sg3';

  if (count === 1) {
    const vowelChanges3 = { a:'â', e:'ê', i:'î', o:'ô', u:'û' };
    const vowelChangesOther = { a:'e', e:'e', i:'i', o:'e', u:'y' };
    const map = is3 ? vowelChanges3 : vowelChangesOther;
    let result = verb.replace(/[aeiou]/, m => map[m] || m);
    result += suffixes[person];
    if (result.endsWith('v') && is3) result = result.slice(0, -1) + 'f';
    return result;
  }
  if (count === 2) {
    if (!is3) {
      const twoMap = { a:'e', o:'e', u:'y' };
      verb = verb.replace(/[aou]/g, m => twoMap[m] || m);
    }
    verb += suffixes[person];
    if (verb.endsWith('v') && is3) verb = verb.slice(0, -1) + 'f';
    return verb;
  }
  if (count >= 3) {
    if (!is3) {
      const threeMap = { a:'e', e:'e', i:'i', o:'e', u:'y' };
      verb = verb.replace(/[aeou]/g, m => threeMap[m] || m);
    }
    verb += suffixes[person];
    if (verb.endsWith('v') && is3) verb = verb.slice(0, -1) + 'f';
    return verb;
  }
  return verb + suffixes[person];
}

function iStemPresent(verb) {
  const base = removeNOrMPrefix(verb);
  if (I_PRES_SPECIALS[base]) return I_PRES_SPECIALS[base];

  const result = {};
  for (const p of PERSONS) {
    result[p] = iStemApplyVowelChanges(base, p, I_PRES);
  }
  return result;
}

// ── I-stem Past ──────────────────────────────────────────────────────────────

// Special past forms: [stem, sg3]  — all others = stem + I_PAST suffix
const I_PAST_SPECIALS_COMPACT = {
  sedh:  ['eidh', 'aidh'],
  sav:   ['óv', 'aw'],
  run:   ['orún', 'orun'],
  caw:   ['agów', 'agow/agaw'],
  car:   ['agór', 'agor'],
  cov:   ['ogúv', 'ogu(f)'],
  gal:   ['ólen', 'ólen'],
  iav:   ['aióv', 'iavof'],
  tog:   ['odúng', 'odunc'],
  sog:   ['sung', 'sunc'],
  nachav:['nachóv', 'nachof'],
  nev:   ['enív', 'eniw'],
  tev:   ['edív', 'ediw'],
  dev:   ['ennív', 'enniw'],
  ndev:  ['ennív', 'enniw'],
};

// Fully irregular past forms (dual forms, unusual patterns)
const I_PAST_SPECIALS_FULL = {
  gad: { sg1:'annen/gannen', sg2f:'anneg/ganneg', sg2p:'annel/gannel', sg2arch:'annedh/gannedh',
         sg3:'ant/gant', pl1e:'annef/gannef', pl1i:'anneb/ganneb',
         pl2f:'annegir/gannegir', pl2p:'annedhir/gannedhir', pl3:'anner/ganner' },
  sab: { sg1:'ammen/sammen', sg2f:'ammeg/sammeg', sg2p:'ammel/sammel', sg2arch:'ammedh/sammedh',
         sg3:'amp/samp', pl1e:'ammef/sammef', pl1i:'ammeb/sammeb',
         pl2f:'ammegir/sammegir', pl2p:'ammedhir/sammedhir', pl3:'ammer/sammer' },
  gwae: { sg1:'anwen', sg2f:'anweg', sg2p:'anwel', sg2arch:'anwedh',
          sg3:'anw', pl1e:'anwef', pl1i:'anweb',
          pl2f:'anwegir', pl2p:'anwedhir', pl3:'anwer' },
  gwaew: { sg1:'waewen', sg2f:'waeweg', sg2p:'waewel', sg2arch:'waewedh',
           sg3:'waew', pl1e:'waewef', pl1i:'waeweb',
           pl2f:'waewegir', pl2p:'waewedhir', pl3:'waewer' },
  raph: { sg1:'aró̥en', sg2f:'aró̥eneg', sg2p:'aró̥enel', sg2arch:'aró̥enedh',
          sg3:'aro̥', pl1e:'aró̥enef', pl1i:'aró̥eneb',
          pl2f:'aró̥enegir', pl2p:'aró̥enedhir', pl3:'aró̥ener' },
  tiph: { sg1:'idimmen', sg2f:'idimmeg', sg2p:'idimmel', sg2arch:'idimmedh',
          sg3:'idímp', pl1e:'idimmef', pl1i:'idimmeb',
          pl2f:'idimmegir', pl2p:'idimmedhir', pl3:'idimmer' },
  nidh: { sg1:'enidhen', sg2f:'enidheg', sg2p:'enidhel', sg2arch:'enidhedh',
          sg3:'enidh', pl1e:'enidhef', pl1i:'enidheb',
          pl2f:'enidhegir', pl2p:'enidhedhir', pl3:'enidher' },
  athraweth: { sg1:'athrawithen', sg2f:'athrawitheg', sg2p:'athrawithel', sg2arch:'athrawithedh',
               sg3:'athrawith', pl1e:'athrawithef', pl1i:'athrawitheb',
               pl2f:'athrawithegir', pl2p:'athrawithedhir', pl3:'athrawither' },
};

function iStemPast(verb, mutationMarker) {
  // Check fully-specified specials first
  if (I_PAST_SPECIALS_FULL[verb]) return I_PAST_SPECIALS_FULL[verb];

  // Check compact specials (stem + sg3 pattern)
  const compact = I_PAST_SPECIALS_COMPACT[verb];
  if (compact) return fromStem(compact[0], compact[1], I_PAST);

  // General algorithm
  const result = {};
  for (const p of PERSONS) {
    result[p] = conjugateIstemPastGeneral(verb, p, mutationMarker);
  }
  return result;
}

function conjugateIstemPastGeneral(verb, person, mutationMarker) {
  const is3 = person === 'sg3';
  const suffix = I_PAST[person];

  // Replace digraphs with placeholder for analysis
  const modVerb = verb.replace(/(dh|th|ph|ch)/g, 'X');
  const vowels = verb.match(/[aeiouy]/g);
  const vowelCount = vowels ? vowels.length : 0;

  // Two-char verbs with a vowel
  if (verb.length === 2 && vowels) {
    const v = vowels[0];
    const nv = is3 ? VOWEL_CHANGE_3[v] : VOWEL_CHANGE[v];
    return nv + verb[1] + suffix;
  }

  // Verbs starting with g (3-char, one vowel) — special mutation
  if (verb.startsWith('g') && verb.length === 3 && vowels) {
    const v = verb[1];
    if (SPECIAL_G_MAP[v]) {
      const nv = is3 ? SPECIAL_G_MAP[v][0] : SPECIAL_G_MAP[v][1];
      return nv + verb.slice(2) + suffix;
    }
  }

  // 3+ vowels with b/d/g/ph ending
  if (vowelCount >= 3 && ['b','d','g','ph'].includes(verb.slice(-1))) {
    const bdg = BDG_MAP[verb.slice(-1)];
    if (bdg) {
      const ending = is3 ? bdg[0] : bdg[1];
      return verb.slice(0, -1) + ending + suffix;
    }
  }

  // 2 vowels with b/d/g/ph ending
  if (vowelCount === 2 && ['b','d','g','ph'].includes(verb.slice(-1))) {
    const v2 = vowels[1];
    const idx = verb.indexOf(v2, verb.indexOf(vowels[0]) + 1);
    const base = verb.slice(0, idx + 1);
    const bdg = BDG_MAP[verb.slice(-1)];
    if (bdg) {
      const ending = is3 ? bdg[0] : bdg[1];
      return base + ending + suffix;
    }
  }

  // 2 vowels without b/d/g/ph ending
  if (vowelCount === 2 && !['b','d','g','ph'].includes(verb.slice(-1))) {
    const v2 = vowels[1];
    const idx = verb.indexOf(v2, verb.indexOf(vowels[0]) + 1);
    const base = verb.slice(0, idx);
    const nv = is3 ? VOWEL_CHANGE_3[v2] : VOWEL_CHANGE[v2];
    return base + nv + verb.slice(idx + 1) + suffix;
  }

  // 1 vowel, 3+ chars — vowel mutation + consonant mutation
  if (vowelCount === 1 && verb.length >= 3) {
    const v = vowels[0];
    const nv = is3 ? VOWEL_CHANGE_3[v] : VOWEL_CHANGE[v];
    // If a mutation marker is set (e.g. 'ng-'), use the historical initial for mutation lookup
    const histInitial = mutationMarker ? mutationMarker.replace(/-$/, '') : null;
    let mutC = histInitial
      ? (MUTATIONS[histInitial] ?? histInitial)
      : (MUTATIONS[modVerb.slice(0, 2)] || MUTATIONS[modVerb[0]] || modVerb[0]);
    let ending = modVerb.slice(-1);
    let prependV = v === 'i' ? 'e' : v;

    // Handle b/d/g/ph endings
    if (['g','b','d','ph'].includes(modVerb.slice(-1))) {
      const bdg = BDG_MAP[modVerb.slice(-1)];
      if (bdg) {
        ending = is3 ? bdg[0] : bdg[1];
        let conj = prependV + mutC + v + ending;
        conj = conj.replace(/X/g, () => verb.match(/(dh|th|ph|ch)/)[0]);
        return conj + suffix;
      }
    }

    let conj = prependV + mutC + nv + ending;
    conj = conj.replace(/X/g, () => verb.match(/(dh|th|ph|ch)/)[0]);
    return conj + suffix;
  }

  // Fallback
  return verb + suffix;
}

// ── I-stem Future ────────────────────────────────────────────────────────────

const I_FUT_SPECIALS = {
  gwae: { sg1:'gwathon', sg2f:'gwathog', sg2p:'gwathol', sg2arch:'gwathodh', sg3:'gwatha',
          pl1e:'gwathof', pl1i:'gwathab', pl2f:'gwathogir', pl2p:'gwathodhir', pl3:'gwathar' },
};

function iStemFuture(verb) {
  const base = removeNOrMPrefix(verb);
  if (I_FUT_SPECIALS[base]) return I_FUT_SPECIALS[base];
  const result = {};
  for (const p of PERSONS) {
    result[p] = base + I_FUT[p];
  }
  return result;
}

// ── I-stem Other Forms ───────────────────────────────────────────────────────

function iStemActivePastParticiple(verb) {
  const vowels = ['a','e','i','o','u'];
  const diphthongs = ['ae','ai','oe','ui','au','eu'];

  if (verb === 'iav') return 'ióviel';
  if (diphthongs.some(d => verb.includes(d))) return verb + 'l';
  if (verb.endsWith('ia')) return verb.slice(0, -1) + 'iel';

  const vCount = verb.split('').filter(c => vowels.includes(c)).length;

  // Find last vowel followed by single consonant
  let lastVIdx = -1;
  for (let i = verb.length - 2; i >= 0; i--) {
    if (vowels.includes(verb[i])) { lastVIdx = i; break; }
  }

  if (vCount === 1 || lastVIdx !== -1) {
    const i = Math.max(lastVIdx, 0);
    const mutV = verb[i].replace(/[aeo]/, m => ({ a:'ó', e:'í', o:'ú' }[m]));
    let tv = verb.slice(0, i) + mutV + verb.slice(i + 1);
    tv = tv.split('').map((c, idx) => {
      if (vowels.includes(c) && idx !== i) return c.replace(/[ao]/, m => ({ a:'e', o:'e' }[m]));
      return c;
    }).join('');
    return tv + 'iel';
  }
  return verb.replace(/[ao]/g, 'e').replace(/u/, 'y') + 'iel';
}

function iStemPassivePartSg(verb) {
  const diphthongs = ['ae','ai','oe','ui','au','eu'];
  const consonantChanges = { b:'mm', d:'nn', dh:'nn', f:'mm', g:'ng', l:'ll',
    n:'nn', r:'rn', th:'nn', v:'mm', w:'wn', ph:'mm' };
  if (diphthongs.some(d => verb.includes(d))) return verb + 'n';
  const end = getEndingGroup(verb) || '';
  const changed = consonantChanges[end] || end;
  return verb.slice(0, -end.length) + changed + 'en';
}

function iStemPassivePartPl(verb) {
  const diphthongs = ['ae','ai','oe','ui','au','eu'];
  const consonantChanges = { b:'mm', d:'nn', dh:'nn', f:'mm', g:'ng', l:'ll',
    n:'nn', r:'rn', th:'nn', v:'mm', w:'wn', ph:'mm' };
  if (diphthongs.some(d => verb.includes(d))) return verb + 'n';
  const end = getEndingGroup(verb) || '';
  const changed = consonantChanges[end] || end;
  let stem = verb.slice(0, -end.length) + changed;
  stem = stem.replace(/[ao]/g, 'e').replace(/u/, 'y');
  return stem + 'in';
}

function iStemForms(verb) {
  const base = removeNOrMPrefix(verb);
  const diphthongs = ['ae','ai','oe','ui','au','eu'];

  // Special: gwae
  if (base === 'gwae') {
    return {
      pres_act_part: 'gwanu', past_act_part: 'gwawn',
      pass_part_sg: 'gwanwen', pass_part_pl: 'gwenwin',
      imperative: 'gwaw', infinitive: 'gwaed', gerund: 'gwaed',
    };
  }

  const hasD = diphthongs.some(d => base.includes(d));
  return {
    pres_act_part: base + 'ol',
    past_act_part: iStemActivePastParticiple(base),
    pass_part_sg: iStemPassivePartSg(base),
    pass_part_pl: iStemPassivePartPl(base),
    imperative: base + 'o',
    infinitive: hasD ? base + 'd' : base + 'ed',
    gerund: hasD ? base + 'd' : base + 'ed',
  };
}

// ── A-stem (Derived) Present ─────────────────────────────────────────────────

function aStemPresent(verb) {
  const result = {};
  let stem = verb;
  if (stem.endsWith('a')) stem = stem.slice(0, -1);

  for (const p of PERSONS) {
    if (p === 'sg3') {
      result[p] = verb; // 3rd sg keeps the -a
    } else {
      result[p] = stem + A_PRES[p];
    }
  }
  return result;
}

// ── A-stem Past Transitive ───────────────────────────────────────────────────

const A_PAST_T_SPECIALS = {
  bachanna: fromStem('bachón', 'bachón', I_PAST),
  suilanna: fromStem('suilón', 'suilón', I_PAST),
  anna:     fromStem('ón', 'ón', I_PAST),
  gala:     { sg1:'ólen/angolen', sg2f:'óleg/angoleg', sg2p:'ólel/angolel', sg2arch:'óledh/angoledh',
              sg3:'aul/angol', pl1e:'ólef/angolef', pl1i:'óleb/angoleb',
              pl2f:'ólegir/angolegir', pl2p:'óledhir/angoledhir', pl3:'óler/angoler' },
  pannada:  fromStem('pannann', 'pannant', A_PAST_T),
  adbannada: fromStem('adbannann', 'adbannant', A_PAST_T),
  gannada:  fromStem('gannann', 'gannant', A_PAST_T),
  na:       { sg1:'nîn', sg2f:'nîg', sg2p:'nîl', sg2arch:'nîdh',
              sg3:'nî', pl1e:'nîf', pl1i:'nîb', pl2f:'nîgir', pl2p:'nîdhir', pl3:'nîr' },
};

function aStemPastTransitive(verb) {
  if (A_PAST_T_SPECIALS[verb]) return A_PAST_T_SPECIALS[verb];

  // V + nna pattern (vowel before nna)
  const vowelList = ['e','i','o','u','y'];
  if (verb.length >= 4 && vowelList.includes(verb[verb.length - 4]) && verb.endsWith('nna')) {
    const result = {};
    for (const p of PERSONS) result[p] = verb + A_PAST_T_VNA[p];
    return result;
  }

  // Haplology: anna ending
  if (verb.endsWith('anna')) {
    const result = {};
    const reduced = verb.slice(0, -4) + 'an';
    for (const p of PERSONS) {
      if (p === 'sg3') result[p] = verb + 'nt';
      else result[p] = reduced + A_PAST_T_HAPLO[p];
    }
    return result;
  }

  // Special endings: ada, nnada, ida
  let stem = verb;
  const specialEndings = ['nnada', 'ada', 'ida'];
  const endLens = { nnada: 5, ada: 2, ida: 2 };
  for (const ending of specialEndings) {
    if (stem.endsWith(ending)) {
      stem = stem.slice(0, -endLens[ending]);
      break;
    }
  }

  // General: stem + suffix
  const result = {};
  for (const p of PERSONS) result[p] = stem + A_PAST_T[p];
  return result;
}

// ── A-stem Past Intransitive ─────────────────────────────────────────────────

function aStemPastIntransitive(verb) {
  const result = {};
  for (const p of PERSONS) result[p] = verb + A_PAST_I[p];
  return result;
}

// ── A-stem Future ────────────────────────────────────────────────────────────

function aStemFuture(verb) {
  const result = {};
  for (const p of PERSONS) result[p] = verb + A_FUT[p];
  return result;
}

// ── A-stem Other Forms ───────────────────────────────────────────────────────

function aStemForms(verb) {
  const n = normalize(verb);
  const vowelChangeMap = { a:'e', e:'e', o:'e', u:'y' };
  const vowelLengthenMap = { a:'ó', e:'í', o:'ú' };
  const diphthongs = ['ae','ai','ui','oe','au','ei','eu'];
  const singleConsonants = ['dh','th','ph','lh','rh','ng'];

  function isFollowedByCluster(v, idx) {
    let rem = v.slice(idx + 1);
    for (const cl of singleConsonants) {
      if (rem.startsWith(cl)) { rem = rem.slice(cl.length); break; }
    }
    return /^[^aeiou]{2}/.test(rem);
  }

  function applyVowelMutation(v) {
    const vows = v.match(/[aeou]/g) || [];
    if (vows.length === 1 && isFollowedByCluster(v, v.indexOf(vows[0]))) {
      return v.replace(/[aeou]/, m => vowelChangeMap[m]);
    } else if (vows.length === 1) {
      return v.replace(/[aeou]/, m => vowelLengthenMap[m] || m);
    } else if (vows.length >= 2) {
      const first = v.indexOf(vows[0]);
      const last = v.lastIndexOf(vows[1]);
      return v.replace(/[aeou]/g, (m, off) => {
        if (off === last) return isFollowedByCluster(v, off) ? vowelChangeMap[m] : (vowelLengthenMap[m] || m);
        if (off === first) return vowelChangeMap[m];
        return m;
      });
    }
    return v;
  }

  function removeSpecialEnding(v) {
    const ends = ['nnada','nna','ada','ida','na'];
    const lens = { na:2, nna:3, ada:2, nnada:5, ida:2 };
    for (const e of ends) {
      if (v.endsWith(e)) return v.slice(0, -lens[e]);
    }
    return v;
  }

  // Handle -ada verbs (half-strong special forms)
  function handleAda(base, form) {
    if (!base.endsWith('ada')) return null;
    const core = base.slice(0, -3);
    switch (form) {
      case 'pres_act_part': return core + 'ódal/ódel';
      case 'past_act_part': return applyVowelMutation(core) + 'ódiel';
      case 'infinitive': case 'gerund': return core + 'óded/ódad';
      default: return null;
    }
  }

  // Special: gala → galod for infinitive/gerund
  if ((n === 'gala') && true) {
    // Will be handled below
  }

  const isGala = n === 'gala';
  const stem = verb.endsWith('a') ? verb.slice(0, -1) : verb;

  // Infinitive / Gerund
  let infinitive, gerund;
  if (isGala) {
    infinitive = 'galod'; gerund = 'galod';
  } else {
    const adaInf = handleAda(verb, 'infinitive');
    infinitive = adaInf || verb + 'd';
    gerund = adaInf || verb + 'd';
  }

  // Imperative
  const imperative = stem + 'o';

  // Present active participle
  let presActPart;
  const adaPres = handleAda(verb, 'pres_act_part');
  presActPart = adaPres || stem + 'ol';

  // Past active participle
  let pastActPart;
  const adaPast = handleAda(verb, 'past_act_part');
  if (adaPast) {
    pastActPart = adaPast;
  } else if (verb.endsWith('ia')) {
    pastActPart = verb.slice(0, -1) + 'el';
  } else if (verb.includes('aea')) {
    pastActPart = stem + 'iel';
  } else {
    let mod = stem.replace(/a(?![eiu])|o(?!e)|u(?!i)/g, m => vowelChangeMap[m]);
    pastActPart = mod + 'iel';
  }

  // Passive participle singular
  let passPartSg;
  if (/rna-?$/i.test(verb)) {
    passPartSg = verb.replace(/-$/, '').slice(0, -1) + 'en';
  } else {
    passPartSg = removeSpecialEnding(verb) + 'nnen';
  }

  // Passive participle plural
  let passPartPl;
  if (/rna-?$/i.test(verb)) {
    let s = verb.replace(/-$/, '').slice(0, -1);
    if (!s.includes('aea')) s = s.replace(/a(?![eiu])|o(?!e)|u(?!i)/g, m => vowelChangeMap[m]);
    passPartPl = s + 'in';
  } else {
    let base2 = removeSpecialEnding(verb);
    if (base2.includes('aea')) {
      passPartPl = base2 + 'nnin';
    } else {
      base2 = base2.replace(/a(?![eiu])|o(?!e)|u(?!i)/g, m => vowelChangeMap[m]);
      passPartPl = base2 + 'nnin';
    }
  }

  return {
    pres_act_part: presActPart,
    past_act_part: pastActPart,
    pass_part_sg: passPartSg,
    pass_part_pl: passPartPl,
    imperative,
    infinitive,
    gerund,
  };
}

// ── High-level Conjugators ───────────────────────────────────────────────────

function conjugateBasic(stem, mutationMarker) {
  return {
    tenses: {
      present: iStemPresent(stem),
      past: iStemPast(stem, mutationMarker),
      future: iStemFuture(stem),
    },
    forms: iStemForms(stem),
  };
}

function conjugateDerived(stem) {
  const n = normalize(stem);
  const isNa = n === 'na' || n === 'tho';

  if (isNa) {
    // na/tho: no present, no intransitive past, special past + future
    const thoFut = { sg1:'thon', sg2f:'thog', sg2p:'thol', sg2arch:'thodh', sg3:'tho',
                     pl1e:'thof', pl1i:'thab', pl2f:'thogir', pl2p:'thodhir', pl3:'thar' };
    return {
      tenses: {
        past: A_PAST_T_SPECIALS.na,
        future: thoFut,
      },
      forms: aStemForms(stem),
    };
  }

  return {
    tenses: {
      present: aStemPresent(stem),
      past_transitive: aStemPastTransitive(stem),
      past_intransitive: aStemPastIntransitive(stem),
      future: aStemFuture(stem),
    },
    forms: aStemForms(stem),
  };
}

function conjugateHalfStrong(stem) {
  // Half-strong verbs end in -ada (from CE -tā suffix)
  // They conjugate like A-stem with special -ada handling
  return conjugateDerived(stem);
}

// ── Main Export ──────────────────────────────────────────────────────────────

/**
 * Conjugate a verb.
 * @param {string} sindarin — the verb headword, e.g. "presta-" or "car"
 * @param {string} verbClass — 'basic' | 'derived' | 'half-strong'
 * @returns {{ class: string, tenses: Object, forms: Object }}
 */
export function conjugate(sindarin, verbClass, mutationMarker) {
  const stem = sindarin.replace(/-$/, '');

  const classLabels = { basic: 'Basic (I-stem)', derived: 'Derived (A-stem)', 'half-strong': 'Half-strong (-tā)' };

  let data;
  if (verbClass === 'basic') {
    data = conjugateBasic(stem, mutationMarker);
  } else if (verbClass === 'derived') {
    data = conjugateDerived(stem);
  } else if (verbClass === 'half-strong') {
    data = conjugateHalfStrong(stem);
  } else {
    return null;
  }

  return {
    class: classLabels[verbClass] || verbClass,
    ...data,
  };
}
