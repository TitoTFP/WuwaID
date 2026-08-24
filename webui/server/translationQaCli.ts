import fs from "node:fs";
import { translationQaService } from "./translationQa.js";

const args = process.argv.slice(2);

function option(name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

const status = option("--status");
const kind = option("--kind");
const query = option("--q");
const issue = option("--issue");
const format = option("--format") === "csv" ? "csv" : option("--format") === "json" ? "json" : "summary";
const output = option("--output");

const summary = translationQaService.getSummary(true);

if (format === "summary") {
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
	const report = translationQaService.exportItems({
		status:
			status === "pass" || status === "review" || status === "approved" ? status : "all",
		kind: kind === "quest" || kind === "category" ? kind : "all",
		query,
		issue,
		format,
	});
	if (output) {
		fs.writeFileSync(output, report.content, "utf8");
		process.stdout.write(`Translation QA report written to ${output}\n`);
	} else {
		process.stdout.write(report.content);
	}
}
