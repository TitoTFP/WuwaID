import assert from "node:assert/strict";
import test from "node:test";
import { inspectTranslation } from "../src/lib/translationQaRules.js";
import { findAttachmentEvidence } from "./translationQaAlignment.js";

test("preserves gender variants while allowing translated values", () => {
	const result = inspectTranslation({
		sourceText: "Hello, {Male=traveler;Female=traveler}.",
		targetText: "Halo, {Male=pengelana;Female=pengelana}.",
	});

	assert.equal(result.issues.some((issue) => issue.code === "missing_token"), false);
});

test("flags missing control tokens", () => {
	const result = inspectTranslation({
		sourceText: "Open <color=Highlight>{0}</color>.",
		targetText: "Buka sekarang.",
	});

	assert.equal(result.issues.some((issue) => issue.code === "missing_token"), true);
});

test("flags empty translations and glossary mismatches", () => {
	const empty = inspectTranslation({ sourceText: "Welcome to Jinzhou.", targetText: "" });
	assert.equal(empty.issues.some((issue) => issue.code === "empty_target"), true);

	const glossary = inspectTranslation({
		sourceText: "The Frequency is unstable.",
		targetText: "Frekuensinya tidak stabil.",
		glossary: [{ term: "Frequency", translation: "Frekuensi" }],
	});
	assert.equal(glossary.glossaryMatches[0]?.present, true);
});

test("finds a target attached to a stronger source candidate in the same quest", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "line-1",
			key: "CurrentLine",
			lineNo: 1,
			lineId: "1",
			speaker: "Battier",
			sourceText: "Only a six-pack? That's unlike you, Battier!",
			targetText: "Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat. Kemungkinan dengan nyawa kita sebagai menu utamanya.",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "line-2",
			key: "CandidateLine",
			lineNo: 2,
			lineId: "2",
			speaker: "Brant",
			sourceText: "Ignore that rule, and greed will swallow us whole. Likely with our lives as the main course.",
			targetText: "Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat. Kemungkinan dengan nyawa kita sebagai menu utamanya.",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], []);

	const current = evidence.get("data/quests/current/dialogue.json::line-1");
	assert.equal(current?.confidence, "high");
	assert.equal(current?.candidates[0]?.key, "CandidateLine");
	assert.equal(current?.reasons.some((reason) => reason.code === "bilingual_anchor"), true);
});

test("does not infer attachment from generic repeated lines or a different unit kind", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "dialogue-1",
			key: "DialogueA",
			sourceText: "What?",
			targetText: "Apa?",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "option-1",
			key: "OptionA",
			sourceText: "What?",
			targetText: "Apa?",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "option",
		},
	], []);

	assert.equal(evidence.size, 0);
});

test("checks an alternate target variant for attachment evidence", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "line-1",
			key: "VariantCurrent",
			sourceText: "Ignore that rule, and greed will swallow us whole.",
			targetText: "Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat.",
			targetVariants: ["D-dan aku bisa dapat gigi emas..."],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "line-2",
			key: "VariantCandidate",
			sourceText: "A-and I can get a gold tooth...",
			targetText: "D-dan aku bisa dapat gigi emas...",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], []);

	const current = evidence.get("data/quests/current/dialogue.json::line-1");
	assert.equal(current?.targetVariant, "D-dan aku bisa dapat gigi emas...");
	assert.equal(current?.candidates[0]?.key, "VariantCandidate");
});

test("does not flag an aligned possessive source against a weaker shared-anchor candidate", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "aligned",
			key: "AlignedCoin",
			sourceText: "Captain, could the nearby Echoes be screwing with the coin's magic?",
			targetText: "Kapten, mungkinkah Echo di sekitar sini mengacaukan sihir koin itu?",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "weaker-candidate",
			key: "WeakerCandidate",
			sourceText: "Well, would you look at that. Captain, I didn't know you were fluent in Echo!",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], [
		{ term: "Echo", translation: "Echo" },
		{ term: "Coin", translation: "Koin" },
	]);

	assert.equal(evidence.size, 0);
});

test("recognizes possessive glossary terms before ranking shared-name candidates", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "aligned-ciaccona",
			key: "AlignedCiaccona",
			sourceText: "Hello, {PlayerName}. I received Ciaccona's memo.",
			targetText: "Halo, {PlayerName}. Aku menerima memo Ciaccona.",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "shared-ciaccona",
			key: "SharedCiaccona",
			sourceText: "Salutations, {PlayerName}. My name is Ciaccona, a wandering bard.",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], [{ term: "Ciaccona", translation: "Ciaccona" }]);

	assert.equal(evidence.size, 0);
});

test("does not flag an aligned line supported only by shared names", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "aligned-names",
			key: "AlignedNames",
			sourceText: "I met Mira and Niko at the station.",
			targetText: "Aku bertemu Mira dan Niko di stasiun.",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "shared-names",
			key: "SharedNames",
			sourceText: "Mira and Niko are waiting by the station.",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], []);

	assert.equal(evidence.size, 0);
});

test("does not treat a repeated speaker name as candidate evidence", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "aligned-speaker",
			key: "AlignedSpeaker",
			speaker: "Encore",
			sourceText: "Lemme see! It's a map on a piece of wood...",
			targetText: "Coba Encore lihat! Ini peta di sepotong kayu...",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "speaker-candidate",
			key: "SpeakerCandidate",
			speaker: "Encore",
			sourceText: "Encore remembers that at some point of the story, the Wooly Warrior will get her hands on a treasure map...",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], [{ term: "Encore", translation: "Encore" }]);

	assert.equal(evidence.size, 0);
});

test("does not flag a strongly aligned lore line because another line shares its proper nouns", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "aligned-lore",
			key: "AlignedLore",
			sourceText: "The Threnodian's presence in Lahai-Roi is only a sliver of its true self. It's been trying to break through the seal on the Stridergate to devour Solaris.",
			targetText: "Kehadiran Threnodian di Lahai-Roi hanyalah sebagian kecil dari dirinya yang sebenarnya. Ia sudah berusaha menembus segel pada Stridergate untuk menelan Solaris.",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "shared-lore-candidate",
			key: "SharedLoreCandidate",
			sourceText: "So why was one destroyed and devoured, while the other managed to stop the Threnodian and seal the Stridergate with its greatsword?",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], [
		{ term: "Threnodian", translation: "Threnodian" },
		{ term: "Lahai-Roi", translation: "Lahai-Roi" },
		{ term: "Stridergate", translation: "Stridergate" },
		{ term: "Solaris", translation: "Solaris" },
	]);

	assert.equal(evidence.size, 0);
});

test("raises split target coverage when adjacent source candidates explain one target", () => {
	const evidence = findAttachmentEvidence([
		{
			id: "combined-current",
			key: "CombinedCurrent",
			sourceText: "Oh no, Captain, we're not just betting drinks today.",
			targetText: "Rumornya menyebar lebih cepat dari yang kuduga. Pokoknya, kalau kau bersedia, perjalanan pulang cukup panjang untukku menceritakan semuanya padamu.",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "combined-first",
			key: "CombinedFirst",
			sourceText: "The rumors spread faster than I expected. Hahaha...",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
		{
			id: "combined-second",
			key: "CombinedSecond",
			sourceText: "Anyway, if you're up for it, the trip back is long enough for me to tell you all about it.",
			targetText: "",
			targetVariants: [],
			sourceKind: "quest",
			sourceRef: "test-quest",
			sourcePath: "data/quests/current/dialogue.json",
			questId: "test-quest",
			unitKind: "dialogue",
		},
	], []);

	const current = evidence.get("data/quests/current/dialogue.json::combined-current");
	assert.equal(current?.confidence, "high");
	assert.deepEqual(
		current?.candidates.slice(0, 2).map((candidate) => candidate.key),
		["CombinedSecond", "CombinedFirst"],
	);
});
