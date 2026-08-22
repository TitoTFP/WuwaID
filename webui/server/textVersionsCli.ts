import {
	createTextVersion,
	createTextVersionFromSource,
} from "./textVersions.js";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const tag = argument("--tag");
const source = argument("--source");
const note = argument("--note") || null;

if (!tag) {
	throw new Error("Usage: npx tsx server/textVersionsCli.ts --tag v3.5 [--source /path/to/data] [--note text]");
}

const version = source
	? createTextVersionFromSource(tag, note, source)
	: createTextVersion(tag, note);
console.log(JSON.stringify(version, null, 2));
