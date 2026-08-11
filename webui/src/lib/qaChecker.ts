export interface QAResult {
  isValid: boolean;
  warnings: string[];
}

export interface GlossaryTerm {
  term: string;
  translation: string;
  category: string;
}

export const COMMON_GLOSSARY: GlossaryTerm[] = [
  { term: 'Resonator', translation: 'Resonator', category: 'Lore' },
  { term: 'Tacet Discord', translation: 'Tacet Discord', category: 'Enemy' },
  { term: 'Midnight Rangers', translation: 'Midnight Rangers', category: 'Faction' },
  { term: 'Gorges of Spirits', translation: 'Ngarai Roh', category: 'Location' },
  { term: 'Huanglong', translation: 'Huanglong', category: 'Location' },
  { term: 'Sentinel Jue', translation: 'Sentinel Jue', category: 'Lore' },
  { term: 'Frequency', translation: 'Frekuensi', category: 'Tech' },
  { term: 'Sonata Effect', translation: 'Efek Sonata', category: 'Game System' },
];

/**
 * Runs automated QA checks comparing source text against target translation text.
 */
export function runQACheck(sourceText: string, targetText: string): QAResult {
  const warnings: string[] = [];

  if (!targetText || targetText.trim() === '') {
    return { isValid: false, warnings: ['Teks terjemahan masih kosong.'] };
  }

  // 1. Variable / Tag match check e.g. {PlayerName}, {0}, {1}
  const sourceTags: string[] = sourceText.match(/\{[^}]+\}/g) || [];
  const targetTags: string[] = targetText.match(/\{[^}]+\}/g) || [];

  sourceTags.forEach((tag) => {
    if (!targetTags.includes(tag)) {
      warnings.push(`Variabel ${tag} hilang dari teks terjemahan.`);
    }
  });

  // 2. Extra trailing / leading whitespace check
  if (targetText.startsWith(' ') && !sourceText.startsWith(' ')) {
    warnings.push('Terdapat spasi ekstra di awal kalimat.');
  }
  if (targetText.endsWith(' ') && !sourceText.endsWith(' ')) {
    warnings.push('Terdapat spasi ekstra di akhir kalimat.');
  }

  // 3. Punctuation sanity check
  if (sourceText.endsWith('?') && !targetText.endsWith('?') && !targetText.endsWith('.')) {
    warnings.push('Kalimat sumber diakhiri tanda tanya (?), pastikan tanda baca terjemahan sesuai.');
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

/**
 * Finds matching glossary terms present in the source text.
 */
export function findGlossaryMatches(sourceText: string): GlossaryTerm[] {
  if (!sourceText) return [];
  const lower = sourceText.toLowerCase();
  return COMMON_GLOSSARY.filter((item) => lower.includes(item.term.toLowerCase()));
}
