import type {
	TranslationQAAttachmentCandidate,
	TranslationQAAttachmentConfidence,
	TranslationQAAttachmentEvidence,
	TranslationQAAttachmentReason,
	TranslationQASourceKind,
} from "../src/types/index.js";
import type { TranslationQAGlossaryRule } from "../src/lib/translationQaRules.js";

export type TranslationQAUnitKind = "dialogue" | "option" | "category";

export interface TranslationQAAlignmentOccurrence {
	id: string;
	key: string;
	lineNo?: number;
	lineId?: string;
	speaker?: string;
	sourceText: string;
	targetText: string;
	targetVariants: string[];
	sourceKind: TranslationQASourceKind;
	sourceRef: string;
	sourcePath: string;
	questId?: string;
	questTitle?: string;
	chapterTitle?: string;
	unitKind: TranslationQAUnitKind;
}

interface BilingualAnchor {
	code: string;
	source: string[];
	target: string[];
	weight: number;
	message: string;
}

interface Signal {
	key: string;
	weight: number;
	reason: TranslationQAAttachmentReason;
}

interface CompiledGlossary {
	byFirstWord: Map<string, TranslationQAGlossaryRule[]>;
}

interface RankedCandidate {
	occurrence: TranslationQAAlignmentOccurrence;
	score: number;
	reasons: TranslationQAAttachmentReason[];
	signalWeights: Map<string, number>;
	sameQuest: boolean;
}

const HIGH_MIN_SCORE = 3;
const HIGH_MIN_MARGIN = 1.5;
const HIGH_MIN_GAP = 0.5;
const MEDIUM_MIN_SCORE = 2;
const MEDIUM_MIN_MARGIN = 0.75;
const GLOBAL_MIN_SCORE = 4.5;
const MIN_CANDIDATE_SCORE = 1;
const MAX_SIGNAL_FREQUENCY = 32;
// A single preserved name or glossary term is not enough to disprove the
// current attachment. Keep candidates only when current alignment is absent
// or limited to a very weak signal.
const MAX_CURRENT_ALIGNMENT_FOR_ATTACHMENT = 1.4;

// These are detector anchors, not translation glossary entries. They only provide
// high-signal bilingual clues when no local language model is available.
const BILINGUAL_ANCHORS: BilingualAnchor[] = [
	{
		code: "pirate",
		source: ["pirate", "pirates"],
		target: ["bajak laut"],
		weight: 2.2,
		message: "Istilah pirate cocok dengan padanan bajak laut.",
	},
	{
		code: "rule",
		source: ["rule", "rules"],
		target: ["aturan"],
		weight: 1.4,
		message: "Istilah rule cocok dengan padanan aturan.",
	},
	{
		code: "greed",
		source: ["greed"],
		target: ["keserakahan"],
		weight: 1.6,
		message: "Istilah greed cocok dengan padanan keserakahan.",
	},
	{
		code: "life",
		source: ["life", "lives"],
		target: ["nyawa"],
		weight: 1.2,
		message: "Istilah life cocok dengan padanan nyawa.",
	},
	{
		code: "main-course",
		source: ["main course"],
		target: ["menu utama"],
		weight: 1.8,
		message: "Frasa main course cocok dengan padanan menu utama.",
	},
	{
		code: "gold-tooth",
		source: ["gold tooth"],
		target: ["gigi emas"],
		weight: 3.2,
		message: "Frasa gold tooth cocok dengan padanan gigi emas.",
	},
	{
		code: "hope",
		source: ["hope"],
		target: ["harapan"],
		weight: 1.3,
		message: "Istilah hope cocok dengan padanan harapan.",
	},
	{
		code: "pray",
		source: ["pray"],
		target: ["berdoa"],
		weight: 1.1,
		message: "Istilah pray cocok dengan padanan berdoa.",
	},
	{
		code: "end",
		source: ["end"],
		target: ["berakhir"],
		weight: 1.1,
		message: "Istilah end cocok dengan padanan berakhir.",
	},
	{
		code: "rumor",
		source: ["rumor", "rumors"],
		target: ["rumor"],
		weight: 1.2,
		message: "Istilah rumor cocok dengan padanan rumor.",
	},
	{
		code: "trip-back",
		source: ["trip back"],
		target: ["perjalanan pulang"],
		weight: 1.8,
		message: "Frasa trip back cocok dengan padanan perjalanan pulang.",
	},
	{
		code: "tell",
		source: ["tell you", "tell"],
		target: ["menceritakan", "ceritakan"],
		weight: 1.1,
		message: "Konteks tell cocok dengan padanan menceritakan.",
	},
	{
		code: "wager",
		source: ["wager", "bet", "betting"],
		target: ["taruhan", "bertaruh"],
		weight: 1.1,
		message: "Konteks taruhan cocok dengan wager atau bet.",
	},
	{
		code: "fish",
		source: ["fish"],
		target: ["ikan"],
		weight: 0.8,
		message: "Istilah fish cocok dengan padanan ikan.",
	},
	{
		code: "drink",
		source: ["drink", "drinks"],
		target: ["minuman"],
		weight: 0.8,
		message: "Istilah drink cocok dengan padanan minuman.",
	},
	{
		code: "treasure",
		source: ["treasure", "treasures"],
		target: ["harta", "harta karun"],
		weight: 1.1,
		message: "Istilah treasure cocok dengan padanan harta.",
	},
	{
		code: "key",
		source: ["key", "keys"],
		target: ["kunci"],
		weight: 0.9,
		message: "Istilah key cocok dengan padanan kunci.",
	},
	{
		code: "captain",
		source: ["captain"],
		target: ["kapten"],
		weight: 0.7,
		message: "Istilah captain cocok dengan padanan kapten.",
	},
	{
		code: "crew",
		source: ["crew"],
		target: ["kru"],
		weight: 0.8,
		message: "Istilah crew cocok dengan padanan kru.",
	},
	{
		code: "coin",
		source: ["coin", "coins"],
		target: ["koin"],
		weight: 0.9,
		message: "Istilah coin cocok dengan padanan koin.",
	},
	{
		code: "curse",
		source: ["curse", "curses"],
		target: ["kutukan"],
		weight: 1,
		message: "Istilah curse cocok dengan padanan kutukan.",
	},
	{
		code: "map",
		source: ["map"],
		target: ["peta"],
		weight: 0.8,
		message: "Istilah map cocok dengan padanan peta.",
	},
	{
		code: "adventure",
		source: ["adventure", "adventures"],
		target: ["petualangan"],
		weight: 0.8,
		message: "Istilah adventure cocok dengan padanan petualangan.",
	},
	{
		code: "sail",
		source: ["sail", "sailing", "sailed"],
		target: ["berlayar", "pelayaran"],
		weight: 0.8,
		message: "Konteks sail cocok dengan padanan berlayar.",
	},
	{
		code: "friend",
		source: ["friend", "friends"],
		target: ["teman"],
		weight: 0.7,
		message: "Istilah friend cocok dengan padanan teman.",
	},
];

const ENGLISH_SIGNAL_STOPWORDS = new Set([
	"a",
	"ah",
	"all",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"but",
	"by",
	"can",
	"captain",
	"come",
	"do",
	"for",
	"from",
	"get",
	"he",
	"i",
	"if",
	"in",
	"is",
	"it",
	"me",
	"my",
	"no",
	"of",
	"oh",
	"on",
	"or",
	"our",
	"so",
	"that",
	"the",
	"their",
	"them",
	"there",
	"they",
	"this",
	"to",
	"us",
	"was",
	"we",
	"what",
	"when",
	"where",
	"who",
	"with",
	"you",
	"your",
]);

function normalize(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function containsTerm(value: string, term: string): boolean {
	const normalizedTerm = normalize(term);
	if (!normalizedTerm) return false;
	const valueWords = normalize(value)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
	const termWords = normalizedTerm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	if (termWords.length > 1) {
		return valueWords.some((_, index) =>
			termWords.every((word, offset) => valueWords[index + offset] === word),
		);
	}
	return valueWords.some(
		(word) =>
			word === normalizedTerm ||
			word === `${normalizedTerm}'s` ||
			word === `${normalizedTerm}s` ||
			word === `${normalizedTerm}es` ||
			word.startsWith(`${normalizedTerm}nya`),
	);
}

function containsAny(value: string, terms: string[]): boolean {
	return terms.some((term) => containsTerm(value, term));
}

function words(value: string): string[] {
	return normalize(value)
		.replace(/[^\p{L}\p{N}'-]+/gu, " ")
		.split(/\s+/)
		.filter((word) => word.length >= 3);
}

function protectedTokens(value: string): string[] {
	return [
		...value.matchAll(/\{[^{}]*\}|<[^>]+>|\$\{[^}]+\}|%\d*\$?[sdif]/gi),
	].map((match) => match[0]);
}

function numbers(value: string): string[] {
	return [...value.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map((match) => match[0]);
}

function properNames(value: string): string[] {
	return (value.match(/\b[A-Z][A-Za-z0-9'-]{2,}\b/g) || [])
		.map((word) => normalize(word))
		.filter((word) => !ENGLISH_SIGNAL_STOPWORDS.has(word));
}

function compileGlossary(
	glossary: readonly TranslationQAGlossaryRule[],
): CompiledGlossary {
	const byFirstWord = new Map<string, TranslationQAGlossaryRule[]>();
	for (const rule of glossary) {
		const firstWord = words(rule.term)[0];
		if (!firstWord) continue;
		const rules = byFirstWord.get(firstWord) || [];
		rules.push(rule);
		byFirstWord.set(firstWord, rules);
	}
	return { byFirstWord };
}

function relevantGlossary(
	value: string,
	glossary: CompiledGlossary,
): TranslationQAGlossaryRule[] {
	const rules = new Map<string, TranslationQAGlossaryRule>();
	for (const word of words(value)) {
		const lookupWords = new Set([word, word.replace(/['’]s$/i, "")]);
		for (const lookupWord of [...lookupWords]) {
			if (lookupWord.endsWith("es")) lookupWords.add(lookupWord.slice(0, -2));
			if (lookupWord.endsWith("s")) lookupWords.add(lookupWord.slice(0, -1));
		}
		for (const lookupWord of lookupWords) {
			for (const rule of glossary.byFirstWord.get(lookupWord) || []) {
				rules.set(normalize(rule.term), rule);
			}
		}
	}
	return [...rules.values()];
}

function addSignal(signals: Map<string, Signal>, signal: Signal): void {
	if (!signals.has(signal.key)) signals.set(signal.key, signal);
}

function sourceSignals(
	sourceText: string,
	glossary: CompiledGlossary,
): Map<string, Signal> {
	const signals = new Map<string, Signal>();
	for (const anchor of BILINGUAL_ANCHORS) {
		if (containsAny(sourceText, anchor.source)) {
			addSignal(signals, {
				key: `anchor:${anchor.code}`,
				weight: anchor.weight,
				reason: { code: "bilingual_anchor", message: anchor.message },
			});
		}
	}
	for (const rule of relevantGlossary(sourceText, glossary)) {
		if (containsTerm(sourceText, rule.term)) {
			addSignal(signals, {
				key: `glossary:${normalize(rule.term)}`,
				weight: 1.5,
				reason: {
					code: "glossary_anchor",
					message: `Istilah glossary ${rule.term} ditemukan pada kandidat source.`,
				},
			});
		}
	}
	for (const token of protectedTokens(sourceText)) {
		addSignal(signals, {
			key: `token:${normalize(token)}`,
			weight: 2.5,
			reason: {
				code: "protected_token",
				message: `Token kontrol ${token} cocok.`,
			},
		});
	}
	for (const number of numbers(sourceText)) {
		addSignal(signals, {
			key: `number:${number}`,
			weight: 1.8,
			reason: { code: "number_match", message: `Angka ${number} cocok.` },
		});
	}
	for (const name of properNames(sourceText)) {
		addSignal(signals, {
			key: `name:${name}`,
			weight: 1.4,
			reason: {
				code: "shared_named_entity",
				message: `Nama atau proper noun ${name} dipertahankan.`,
			},
		});
	}
	return signals;
}

function targetSignals(
	targetText: string,
	glossary: CompiledGlossary,
): Set<string> {
	const signals = new Set<string>();
	for (const anchor of BILINGUAL_ANCHORS) {
		if (containsAny(targetText, anchor.target))
			signals.add(`anchor:${anchor.code}`);
	}
	for (const rule of relevantGlossary(targetText, glossary)) {
		if (containsTerm(targetText, rule.translation))
			signals.add(`glossary:${normalize(rule.term)}`);
	}
	for (const token of protectedTokens(targetText))
		signals.add(`token:${normalize(token)}`);
	for (const number of numbers(targetText)) signals.add(`number:${number}`);
	for (const name of properNames(targetText)) signals.add(`name:${name}`);
	return signals;
}

function scoreSignals(
	source: Map<string, Signal>,
	target: Set<string>,
): {
	score: number;
	reasons: TranslationQAAttachmentReason[];
	signalKeys: Set<string>;
	targetSignalKeys: Set<string>;
	signalWeights: Map<string, number>;
} {
	let score = 0;
	const reasons: TranslationQAAttachmentReason[] = [];
	const signalKeys = new Set<string>();
	const signalWeights = new Map<string, number>();
	for (const [key, signal] of source) {
		if (!target.has(key)) continue;
		score += signal.weight;
		signalKeys.add(key);
		signalWeights.set(key, signal.weight);
		reasons.push(signal.reason);
	}
	return { score, reasons, signalKeys, targetSignalKeys: target, signalWeights };
}

function combinedCandidateScore(candidates: RankedCandidate[]): {
	score: number;
	reasons: TranslationQAAttachmentReason[];
} {
	const weights = new Map<string, number>();
	const reasons = new Map<string, TranslationQAAttachmentReason>();
	for (const candidate of candidates.slice(0, 3)) {
		for (const [key, weight] of candidate.signalWeights) {
			weights.set(key, Math.max(weights.get(key) || 0, weight));
		}
		for (const reason of candidate.reasons)
			reasons.set(`${reason.code}:${reason.message}`, reason);
	}
	const topScore = candidates[0]?.score || 0;
	const score = [...weights.values()].reduce(
		(total, weight) => total + weight,
		0,
	);
	if (
		candidates.length > 1 &&
		score >= HIGH_MIN_SCORE &&
		score - topScore >= 0.8
	) {
		reasons.set("combined_candidate_coverage", {
			code: "combined_candidate_coverage",
			message:
				"Beberapa source candidate bersama-sama menjelaskan sinyal target yang tidak ada pada source saat ini.",
		});
	}
	return {
		score: candidates.length > 1 && score - topScore >= 0.8 ? score : topScore,
		reasons: [...reasons.values()],
	};
}

function candidateConfidence(
	score: number,
	margin: number,
	sameQuest: boolean,
	gap: number,
	currentScore: number,
): TranslationQAAttachmentConfidence {
	const requiredMargin = Math.max(HIGH_MIN_MARGIN, currentScore * 0.5);
	if (
		score >= HIGH_MIN_SCORE &&
		margin >= requiredMargin &&
		gap >= HIGH_MIN_GAP &&
		(sameQuest || score >= GLOBAL_MIN_SCORE)
	)
		return "high";
	if (score >= MEDIUM_MIN_SCORE && margin >= MEDIUM_MIN_MARGIN) return "medium";
	return "low";
}

function candidateId(occurrence: TranslationQAAlignmentOccurrence): string {
	return `${occurrence.sourcePath}::${occurrence.id}`;
}

function withoutSpeakerSignals(
	signals: Map<string, Signal>,
	speaker: string | undefined,
): Map<string, Signal> {
	const normalizedSpeaker = normalize(speaker || "").replace(/["'“”‘’]/g, "");
	if (!normalizedSpeaker) return signals;
	const ignoredKeys = new Set([
		`name:${normalizedSpeaker}`,
		`glossary:${normalizedSpeaker}`,
		`glossary:"${normalizedSpeaker}"`,
	]);
	return new Map([...signals].filter(([key]) => !ignoredKeys.has(key)));
}

function toCandidate(
	ranked: RankedCandidate,
	confidence: TranslationQAAttachmentConfidence,
): TranslationQAAttachmentCandidate {
	return {
		occurrenceId: candidateId(ranked.occurrence),
		key: ranked.occurrence.key,
		sourceKind: ranked.occurrence.sourceKind,
		sourceRef: ranked.occurrence.sourceRef,
		sourcePath: ranked.occurrence.sourcePath,
		questId: ranked.occurrence.questId,
		questTitle: ranked.occurrence.questTitle,
		chapterTitle: ranked.occurrence.chapterTitle,
		lineNo: ranked.occurrence.lineNo,
		lineId: ranked.occurrence.lineId,
		speaker: ranked.occurrence.speaker,
		sourceText: ranked.occurrence.sourceText,
		score: Math.round(ranked.score * 100) / 100,
		confidence,
		sameQuest: ranked.sameQuest,
		reasons: ranked.reasons,
	};
}

export function findAttachmentEvidence(
	occurrences: readonly TranslationQAAlignmentOccurrence[],
	glossary: readonly TranslationQAGlossaryRule[],
	onProgress?: (current: number, total: number) => void,
	targetIds?: ReadonlySet<string>,
): Map<string, TranslationQAAttachmentEvidence> {
	const compiledGlossary = compileGlossary(glossary);
	const questOccurrences = occurrences.filter(
		(occurrence) =>
			occurrence.sourceKind === "quest" &&
			occurrence.unitKind !== "category" &&
			occurrence.sourceText.trim(),
	);
	const sourceIndex = new Map<string, TranslationQAAlignmentOccurrence[]>();
	const sourceFrequency = new Map<string, number>();
	const sourceIndexByQuest = new Map<
		string,
		Map<string, TranslationQAAlignmentOccurrence[]>
	>();
	const sourceFrequencyByQuest = new Map<string, Map<string, number>>();
	const sourceSignalsById = new Map<string, Map<string, Signal>>();
	const targetOccurrences = targetIds
		? questOccurrences.filter((occurrence) =>
				targetIds.has(candidateId(occurrence)),
			)
		: questOccurrences;
	const totalWork = Math.max(
		1,
		questOccurrences.length + targetOccurrences.length,
	);
	const reportProgress = (current: number) => {
		if (!onProgress || (current !== totalWork && current % 250 !== 0)) return;
		onProgress(current, totalWork);
	};
	for (const [index, occurrence] of questOccurrences.entries()) {
		const signals = sourceSignals(occurrence.sourceText, compiledGlossary);
		sourceSignalsById.set(candidateId(occurrence), signals);
		for (const key of signals.keys()) {
			const values = sourceIndex.get(key) || [];
			values.push(occurrence);
			sourceIndex.set(key, values);
			sourceFrequency.set(key, (sourceFrequency.get(key) || 0) + 1);
			if (occurrence.questId) {
				const questIndex = sourceIndexByQuest.get(occurrence.questId) || new Map();
				const questFrequency =
					sourceFrequencyByQuest.get(occurrence.questId) || new Map();
				const questValues = questIndex.get(key) || [];
				questValues.push(occurrence);
				questIndex.set(key, questValues);
				questFrequency.set(key, (questFrequency.get(key) || 0) + 1);
				sourceIndexByQuest.set(occurrence.questId, questIndex);
				sourceFrequencyByQuest.set(occurrence.questId, questFrequency);
			}
		}
		reportProgress(index + 1);
	}
	const candidatesFromIndex = (
		index: Map<string, TranslationQAAlignmentOccurrence[]> | undefined,
		frequency: Map<string, number> | undefined,
		keys: Set<string>,
		current: TranslationQAAlignmentOccurrence,
	): TranslationQAAlignmentOccurrence[] => {
		const candidates = new Map<string, TranslationQAAlignmentOccurrence>();
		for (const key of keys) {
			if ((frequency?.get(key) || 0) > MAX_SIGNAL_FREQUENCY) continue;
			for (const candidate of index?.get(key) || []) {
				if (candidateId(candidate) !== candidateId(current))
					candidates.set(candidateId(candidate), candidate);
			}
		}
		return [...candidates.values()];
	};

	const evidence = new Map<string, TranslationQAAttachmentEvidence>();
	for (const [index, occurrence] of targetOccurrences.entries()) {
		reportProgress(questOccurrences.length + index + 1);
		const targetTexts = [occurrence.targetText, ...occurrence.targetVariants]
			.map((value) => value.trim())
			.filter((value, index, values) => value && values.indexOf(value) === index);
		if (targetTexts.length === 0) continue;

		let bestVariant = targetTexts[0];
		let currentScore = Number.POSITIVE_INFINITY;
		let targetSignalKeys = new Set<string>();
		for (const targetText of targetTexts) {
			const scored = scoreSignals(
				sourceSignalsById.get(candidateId(occurrence)) || new Map(),
				targetSignals(targetText, compiledGlossary),
			);
			if (scored.score < currentScore) {
				bestVariant = targetText;
				currentScore = scored.score;
				targetSignalKeys = scored.targetSignalKeys;
			}
		}
		if (!Number.isFinite(currentScore)) currentScore = 0;
		if (currentScore >= MAX_CURRENT_ALIGNMENT_FOR_ATTACHMENT) continue;

		const rankCandidates = (
			candidates: TranslationQAAlignmentOccurrence[],
		): RankedCandidate[] =>
			candidates
				.filter(
					(candidate) =>
						candidate.unitKind === occurrence.unitKind &&
						normalize(candidate.sourceText) !== normalize(occurrence.sourceText),
				)
				.map((candidate) => {
					const candidateSignals =
						sourceSignalsById.get(candidateId(candidate)) || new Map();
					const signals =
						normalize(candidate.speaker || "") === normalize(occurrence.speaker || "")
							? withoutSpeakerSignals(candidateSignals, occurrence.speaker)
							: candidateSignals;
					const scored = scoreSignals(signals, targetSignalKeys);
					return {
						occurrence: candidate,
						score: scored.score,
						reasons: scored.reasons,
						signalWeights: scored.signalWeights,
						sameQuest: candidate.questId === occurrence.questId,
					};
				})
				.filter((candidate) => candidate.score >= MIN_CANDIDATE_SCORE)
				.sort((left, right) => right.score - left.score);
		const localRanked = rankCandidates(
			candidatesFromIndex(
				sourceIndexByQuest.get(occurrence.questId || ""),
				sourceFrequencyByQuest.get(occurrence.questId || ""),
				targetSignalKeys,
				occurrence,
			),
		);

		let selected = localRanked;
		if (!selected[0] || selected[0].score < MEDIUM_MIN_SCORE) {
			selected = rankCandidates(
				candidatesFromIndex(
					sourceIndex,
					sourceFrequency,
					targetSignalKeys,
					occurrence,
				),
			).filter(
				(candidate) => !candidate.sameQuest && candidate.score >= GLOBAL_MIN_SCORE,
			);
		}
		const top = selected[0];
		if (!top) continue;
		const second = selected[1];
		const combined = combinedCandidateScore(selected);
		const margin = combined.score - currentScore;
		const gap = top.score - (second?.score || 0);
		const confidence = candidateConfidence(
			combined.score,
			margin,
			top.sameQuest,
			gap,
			currentScore,
		);
		if (confidence === "low") continue;

		const candidates = selected.slice(0, 3).map((candidate, index) => {
			const candidateMargin = candidate.score - currentScore;
			const candidateGap = candidate.score - (selected[index + 1]?.score || 0);
			const candidateConfidenceValue = candidateConfidence(
				candidate.score,
				candidateMargin,
				candidate.sameQuest,
				candidateGap,
				currentScore,
			);
			const reasons = [...candidate.reasons];
			if (!candidate.sameQuest) {
				reasons.push({
					code: "candidate_outside_quest",
					message: "Kandidat ditemukan di quest lain sebagai fallback corpus.",
				});
			}
			if (candidate.score > currentScore) {
				reasons.push({
					code: "candidate_alignment_advantage",
					message:
						"Sinyal target lebih cocok dengan source kandidat daripada source saat ini.",
				});
			}
			return toCandidate({ ...candidate, reasons }, candidateConfidenceValue);
		});

		evidence.set(candidateId(occurrence), {
			occurrenceId: occurrence.id,
			key: occurrence.key,
			lineNo: occurrence.lineNo,
			lineId: occurrence.lineId,
			sourceText: occurrence.sourceText,
			targetText: bestVariant,
			targetVariant:
				bestVariant === occurrence.targetText ? undefined : bestVariant,
			currentScore: Math.round(currentScore * 100) / 100,
			score: Math.round(combined.score * 100) / 100,
			margin: Math.round(margin * 100) / 100,
			confidence,
			reasons: combined.reasons,
			candidates,
		});
	}

	return evidence;
}
