import {
	buildReaderIndex,
	readerIndexPath,
} from "../server/readerIndexStore.js";

const force = process.argv.includes("--force");
const indexPath = readerIndexPath();
const startedAt = Date.now();
const result = buildReaderIndex(indexPath, { force });

console.log(
	JSON.stringify(
		{
			indexPath,
			force,
			...result,
			elapsedMs: Date.now() - startedAt,
		},
		null,
		2,
	),
);
