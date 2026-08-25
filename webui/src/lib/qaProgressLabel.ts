export interface QaProgressCounts {
	current: number;
	total: number;
	percent: number;
}

export function formatQaScanProgressLabel(progress: QaProgressCounts): string {
	const counts =
		progress.total > 0 ? `${progress.current}/${progress.total} · ` : "";
	return `${counts}${progress.percent}%`;
}
