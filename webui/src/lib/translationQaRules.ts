export type TranslationQAIssueSeverity = "error" | "warning" | "info";

// Bump when a rule changes so persisted reports cannot outlive their logic.
export const TRANSLATION_QA_RULE_VERSION = "2";

export interface TranslationQAIssue {
	code: string;
	severity: TranslationQAIssueSeverity;
	message: string;
}

export interface TranslationQAGlossaryRule {
	term: string;
	translation: string;
	category?: string;
}

export interface TranslationQAGlossaryMatch extends TranslationQAGlossaryRule {
	present: boolean;
}

export interface TranslationQAInspection {
	issues: TranslationQAIssue[];
	glossaryMatches: TranslationQAGlossaryMatch[];
}

interface ProtectedToken {
	key: string;
	label: string;
}

const glossaryIndexCache = new WeakMap<
	readonly TranslationQAGlossaryRule[],
	Map<string, TranslationQAGlossaryRule[]>
>();

const ENGLISH_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"but",
	"can",
	"cannot",
	"could",
	"did",
	"do",
	"does",
	"for",
	"from",
	"has",
	"have",
	"how",
	"if",
	"in",
	"is",
	"it",
	"its",
	"me",
	"my",
	"no",
	"not",
	"of",
	"on",
	"or",
	"our",
	"that",
	"the",
	"their",
	"them",
	"there",
	"these",
	"they",
	"this",
	"to",
	"was",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"who",
	"will",
	"with",
	"would",
	"you",
	"your",
]);

const INDONESIAN_MARKERS = new Set([
	"adalah",
	"akan",
	"anda",
	"atau",
	"bagi",
	"dalam",
	"dan",
	"dari",
	"dengan",
	"dia",
	"ini",
	"itu",
	"kami",
	"kamu",
	"karena",
	"ke",
	"kita",
	"mereka",
	"pada",
	"saya",
	"sebagai",
	"sebuah",
	"telah",
	"tidak",
	"untuk",
]);

function normalize(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function visibleText(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/\{[^{}]*\}/g, " ")
		.replace(/\$\{[^}]+\}/g, " ")
		.replace(/%\d*\$?[sdif]/gi, " ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function words(value: string): string[] {
	return visibleText(value)
		.toLocaleLowerCase()
		.split(/\s+/)
		.filter((word) => word.length >= 2);
}

function addCount(map: Map<string, number>, value: string): void {
	map.set(value, (map.get(value) || 0) + 1);
}

function collectProtectedTokens(value: string): ProtectedToken[] {
	const tokens: ProtectedToken[] = [];

	for (const match of value.matchAll(/\{([^{}]*)\}/g)) {
		const body = match[1] || "";
		const parts = body
			.split(";")
			.map((part) => part.trim())
			.filter(Boolean);
		const labels = parts
			.map((part) => part.match(/^([A-Za-z][A-Za-z0-9_]*)=/)?.[1])
			.filter((label): label is string => Boolean(label));

		if (
			labels.length === parts.length &&
			labels.length > 0 &&
			labels.every((label) => label === "Male" || label === "Female")
		) {
			const shape = labels.join(";");
			const label = `{${labels.map((name) => `${name}=...`).join(";")}}`;
			addCountToken(tokens, `gender:${shape}`, label);
		} else {
			addCountToken(tokens, `brace:${body}`, `{${body}}`);
		}
	}

	for (const match of value.matchAll(/<[^>]+>/g)) {
		const token = match[0];
		addCountToken(tokens, `tag:${token}`, token);
	}

	for (const match of value.matchAll(/\$\{[^}]+\}|%\d*\$?[sdif]/gi)) {
		const token = match[0];
		addCountToken(tokens, `format:${token}`, token);
	}

	return tokens;
}

function addCountToken(tokens: ProtectedToken[], key: string, label: string): void {
	tokens.push({ key, label });
}

function missingProtectedTokens(source: string, target: string): string[] {
	const sourceCounts = new Map<string, number>();
	const targetCounts = new Map<string, number>();
	const labels = new Map<string, string>();

	for (const token of collectProtectedTokens(source)) {
		addCount(sourceCounts, token.key);
		labels.set(token.key, token.label);
	}
	for (const token of collectProtectedTokens(target)) {
		addCount(targetCounts, token.key);
	}

	const missing: string[] = [];
	for (const [key, count] of sourceCounts) {
		const difference = count - (targetCounts.get(key) || 0);
		for (let index = 0; index < difference; index++) {
			missing.push(labels.get(key) || key);
		}
	}
	return missing;
}

function extraProtectedTokens(source: string, target: string): string[] {
	const sourceCounts = new Map<string, number>();
	const targetCounts = new Map<string, number>();
	const labels = new Map<string, string>();

	for (const token of collectProtectedTokens(source)) {
		addCount(sourceCounts, token.key);
		labels.set(token.key, token.label);
	}
	for (const token of collectProtectedTokens(target)) {
		addCount(targetCounts, token.key);
		labels.set(token.key, token.label);
	}

	const extra: string[] = [];
	for (const [key, count] of targetCounts) {
		const difference = count - (sourceCounts.get(key) || 0);
		for (let index = 0; index < difference; index++) {
			extra.push(labels.get(key) || key);
		}
	}
	return extra;
}

function normalizeGlossary(value: string): string {
	return normalize(value)
		.replace(/["“”'‘’`]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function glossaryCandidates(
	rules: readonly TranslationQAGlossaryRule[],
	sourceText: string,
): TranslationQAGlossaryRule[] {
	let index = glossaryIndexCache.get(rules);
	if (!index) {
		index = new Map<string, TranslationQAGlossaryRule[]>();
		for (const rule of rules) {
			const firstWord = normalizeGlossary(rule.term).split(" ")[0];
			if (!firstWord) continue;
			const entries = index.get(firstWord) || [];
			entries.push(rule);
			index.set(firstWord, entries);
		}
		glossaryIndexCache.set(rules, index);
	}

	const sourceWords = new Set(normalizeGlossary(sourceText).split(/\s+/).filter(Boolean));
	const candidates = new Map<string, TranslationQAGlossaryRule>();
	for (const word of sourceWords) {
		for (const rule of index.get(word) || []) {
			candidates.set(rule.term.toLocaleLowerCase(), rule);
		}
	}
	return [...candidates.values()];
}

function hasUnbalancedPairs(value: string): boolean {
	return [
		["(", ")"],
		["[", "]"],
		["<", ">"],
	].some(([open, close]) => {
		const opens = value.split(open).length - 1;
		const closes = value.split(close).length - 1;
		return opens !== closes;
	});
}

function issue(
	issues: TranslationQAIssue[],
	code: string,
	severity: TranslationQAIssueSeverity,
	message: string,
): void {
	if (!issues.some((item) => item.code === code && item.message === message)) {
		issues.push({ code, severity, message });
	}
}

export function inspectTranslation(input: {
	sourceText: string;
	targetText: string;
	targetVariants?: string[];
	glossary?: TranslationQAGlossaryRule[];
}): TranslationQAInspection {
	const sourceText = input.sourceText || "";
	const targetText = input.targetText || "";
	const issues: TranslationQAIssue[] = [];
	const glossaryMatches: TranslationQAGlossaryMatch[] = [];

	if (!targetText.trim()) {
		issue(issues, "empty_target", "error", "Teks terjemahan masih kosong.");
	}

	if (!sourceText.trim()) {
		issue(issues, "empty_source", "warning", "Teks sumber kosong sehingga makna tidak dapat diverifikasi.");
	}

	const missing = missingProtectedTokens(sourceText, targetText);
	if (missing.length > 0) {
		issue(
			issues,
			"missing_token",
			"error",
			`Token/markup sumber hilang dari terjemahan: ${missing.join(", ")}.`,
		);
	}

	const extra = extraProtectedTokens(sourceText, targetText);
	if (extra.length > 0) {
		issue(
			issues,
			"extra_token",
			"warning",
			`Token/markup tambahan muncul di terjemahan: ${extra.join(", ")}.`,
		);
	}

	const variants = (input.targetVariants || []).filter((value) => value.trim());
	if (new Set(variants.map(normalize)).size > 1) {
		issue(
			issues,
			"target_variant_mismatch",
			"warning",
			"Kolom terjemahan Indonesia memiliki dua nilai yang berbeda.",
		);
	}

	if (targetText.startsWith(" ") && !sourceText.startsWith(" ")) {
		issue(issues, "leading_whitespace", "warning", "Terdapat spasi ekstra di awal kalimat.");
	}
	if (targetText.endsWith(" ") && !sourceText.endsWith(" ")) {
		issue(issues, "trailing_whitespace", "warning", "Terdapat spasi ekstra di akhir kalimat.");
	}

	const normalizedSource = normalize(sourceText);
	const normalizedTarget = normalize(targetText);
	if (normalizedSource && normalizedSource === normalizedTarget) {
		issue(
			issues,
			"identical_source",
			"warning",
			"Terjemahan sama persis dengan teks sumber; periksa apakah ini sengaja.",
		);
	}

	const sourceWords = words(sourceText);
	const targetWords = new Set(words(targetText));
	const sharedWords = sourceWords.filter((word) => targetWords.has(word));
	const sharedStopwords = sharedWords.filter((word) => ENGLISH_STOPWORDS.has(word));
	const targetMarkers = words(targetText).filter((word) => INDONESIAN_MARKERS.has(word));
	const overlapRatio = sourceWords.length
		? sharedWords.length / new Set(sourceWords).size
		: 0;
	if (
		targetText.trim() &&
		((sharedStopwords.length >= 2 && targetMarkers.length < 2) ||
			(sharedWords.length >= 3 && overlapRatio >= 0.6))
	) {
		issue(
			issues,
			"english_residue",
			"warning",
			"Terjemahan masih mempertahankan banyak kata bahasa Inggris; periksa apakah teks belum diterjemahkan.",
		);
	}

	if (sourceText.length >= 24 && targetText.trim()) {
		const ratio = targetText.length / sourceText.length;
		if (ratio < 0.2 || ratio > 3.5) {
			issue(
				issues,
				"length_outlier",
				"warning",
				"Panjang terjemahan jauh berbeda dari sumber; periksa teks terpotong atau berlebih.",
			);
		}
	}

	const sourceEndsWithQuestion = /\?\s*$/.test(sourceText);
	const targetEndsWithQuestion = /\?\s*$/.test(targetText);
	if (sourceEndsWithQuestion !== targetEndsWithQuestion && targetText.trim()) {
		issue(
			issues,
			"question_punctuation",
			"warning",
			"Tanda tanya sumber dan terjemahan berbeda; pastikan maksud kalimat tetap sama.",
		);
	}

	const sourceEndsWithExclamation = /!\s*$/.test(sourceText);
	const targetEndsWithExclamation = /!\s*$/.test(targetText);
	if (sourceEndsWithExclamation !== targetEndsWithExclamation && targetText.trim()) {
		issue(
			issues,
			"exclamation_punctuation",
			"warning",
			"Tanda seru sumber dan terjemahan berbeda; pastikan penekanan kalimat tetap sama.",
		);
	}

	if (hasUnbalancedPairs(targetText)) {
		issue(
			issues,
			"unbalanced_markup",
			"error",
			"Tanda kurung atau markup di terjemahan tidak seimbang.",
		);
	}

	for (const rule of glossaryCandidates(input.glossary || [], sourceText)) {
		const term = rule.term.trim();
		const translation = rule.translation.trim();
		if (!term || !translation || !normalize(sourceText).includes(normalize(term))) continue;

		const present = normalizeGlossary(targetText).includes(normalizeGlossary(translation));
		glossaryMatches.push({ ...rule, present });
		if (translation !== term && !present) {
			issue(
				issues,
				"glossary_mismatch",
				"warning",
				`Istilah “${term}” sebaiknya diterjemahkan sebagai “${translation}”.`,
			);
		}
	}

	return { issues, glossaryMatches };
}
