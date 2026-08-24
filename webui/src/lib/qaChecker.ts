export interface QAResult {
  isValid: boolean;
  warnings: string[];
}

export interface GlossaryTerm {
  term: string;
  translation: string;
  category: string;
}

import { inspectTranslation } from "./translationQaRules";

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
	const inspection = inspectTranslation({
		sourceText,
		targetText,
		glossary: COMMON_GLOSSARY,
	});
	return {
		isValid: inspection.issues.length === 0,
		warnings: inspection.issues.map((item) => item.message),
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
