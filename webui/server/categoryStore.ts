import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_CANDIDATES = [
	path.resolve(MODULE_DIR, "../../"),
	path.resolve(MODULE_DIR, "../../../"),
];
export const REPO_ROOT =
	ROOT_CANDIDATES.find((root) =>
		fs.existsSync(path.join(root, "data/quests/categories")),
	) || ROOT_CANDIDATES[0];
export const CATEGORIES_JSON_DIR = path.join(
	REPO_ROOT,
	"data/quests/categories",
);

export interface CategoryFile {
	name: string;
	relativePath: string;
	filePath: string;
}

function walk(dir: string, relative = ""): CategoryFile[] {
	if (!fs.existsSync(dir)) return [];
	const files: CategoryFile[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const relativePath = path.posix.join(relative, entry.name);
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walk(filePath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith(".json")) {
			files.push({
				name: relativePath.slice(0, -5),
				relativePath,
				filePath,
			});
		}
	}
	return files;
}

export function listCategoryFiles(): CategoryFile[] {
	return walk(CATEGORIES_JSON_DIR).sort((a, b) => a.name.localeCompare(b.name));
}

export function cleanCategoryName(value: string): string {
	return value.replace(/^cat_/, "").replaceAll("\\", "/");
}

export function resolveCategoryFile(value: string): CategoryFile | null {
	const name = cleanCategoryName(value);
	if (!name || path.posix.isAbsolute(name)) return null;
	const relativePath = `${name}.json`;
	const filePath =
		path.resolve(CATEGORIES_JSON_DIR, ...name.split("/")) + ".json";
	const root = `${path.resolve(CATEGORIES_JSON_DIR)}${path.sep}`;
	if (
		!filePath.startsWith(root) ||
		name.split("/").some((part) => !part || part === "." || part === "..")
	) {
		return null;
	}
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
	return { name, relativePath, filePath };
}

export function readCategoryDocument(
	file: CategoryFile,
): Record<string, Record<string, string>> | null {
	try {
		return JSON.parse(fs.readFileSync(file.filePath, "utf-8")) as Record<
			string,
			Record<string, string>
		>;
	} catch {
		return null;
	}
}

export function rebuildCategoryIndex(indexPath: string): number {
	if (!fs.existsSync(indexPath)) return 0;

	const database = new DatabaseSync(indexPath);
	try {
		database.exec(`
			DROP TABLE IF EXISTS category_text_idx;
			DROP TABLE IF EXISTS categories;
			CREATE VIRTUAL TABLE category_text_idx USING fts5(
				category UNINDEXED,
				key UNINDEXED,
				prefix UNINDEXED,
				text_zh,
				text_en,
				text_ja,
				text_id,
				tokenize = 'unicode61 remove_diacritics 2'
			);
			CREATE TABLE categories(
				name TEXT PRIMARY KEY,
				file TEXT NOT NULL,
				key_count INTEGER NOT NULL,
				translated_count INTEGER NOT NULL
			);
		`);

		const insertText = database.prepare(
			"INSERT INTO category_text_idx VALUES (?,?,?,?,?,?,?)",
		);
		const insertCategory = database.prepare(
			"INSERT INTO categories VALUES (?,?,?,?)",
		);
		let rowCount = 0;
		for (const file of listCategoryFiles()) {
			const document = readCategoryDocument(file);
			if (!document) continue;
			let translatedCount = 0;
			for (const [key, item] of Object.entries(document)) {
				const id = item.id || item.text_id || item.mt || "";
				if (id.trim()) translatedCount++;
				insertText.run(
					file.name,
					key,
					key.split("_", 1)[0],
					item["zh-Hans"] || item.zh || "",
					item.en || "",
					item.ja || "",
					id,
				);
				rowCount++;
			}
			insertCategory.run(
				file.name,
				file.relativePath,
				Object.keys(document).length,
				translatedCount,
			);
		}
		database.close();
		return rowCount;
	} catch (error) {
		database.close();
		throw error;
	}
}
