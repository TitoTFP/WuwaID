import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { REPO_ROOT } from "./categoryStore.js";
import { realDataLoader } from "./realDataLoader.js";
import { invalidateTextVersionWorkingSet } from "./textVersions.js";
import type {
	DatabaseJobFile,
	DatabaseJobKind,
	DatabaseJobProgress,
	DatabaseJobResult,
	DatabaseJobProcessorOptions,
} from "./databaseJobProcessor.js";

const JOB_ROOT = path.join(REPO_ROOT, "webui/data/database_jobs");
const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const JOB_RECORD_NAME = "job.json";
const SQLITE_HEADER = Buffer.from("SQLite format 3\0");
const MAX_IMPORT_FILES = 2000;
const WRITER_LOCK_NAME = ".writer.lock";
const WRITER_LOCK_HEARTBEAT_MS = 5000;
const WRITER_LOCK_STALE_MS = 30000;
const WRITER_LOCK_RETRY_MS = 250;

type JobStatus = "staging" | "queued" | "running" | "completed" | "failed";

interface DatabaseJobRecord {
	id: string;
	kind: DatabaseJobKind;
	status: JobStatus;
	createdAt: string;
	updatedAt: string;
	expectedFiles: number;
	files: Array<DatabaseJobFile | null>;
	progress: DatabaseJobProgress;
	attempts: number;
	result?: DatabaseJobResult;
	error?: string;
}

export interface DatabaseJobManagerOptions {
	processorOptions?: Omit<DatabaseJobProcessorOptions, "transactionDirectory">;
	invalidateCaches?: boolean;
}

export interface DatabaseJobView {
	id: string;
	kind: DatabaseJobKind;
	status: JobStatus;
	createdAt: string;
	updatedAt: string;
	expectedFiles: number;
	receivedFiles: number;
	progress: DatabaseJobProgress;
	result?: DatabaseJobResult;
	error?: string;
}

function now(): string {
	return new Date().toISOString();
}

function writeAtomic(filePath: string, value: unknown): void {
	const temporary = `${filePath}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf-8");
		fs.renameSync(temporary, filePath);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function validateImportBody(body: Buffer): void {
	if (!Buffer.isBuffer(body) || body.length === 0) {
		throw new Error("File .db tidak boleh kosong");
	}
	if (!body.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
		throw new Error("File yang diunggah bukan database SQLite");
	}
}

function mergeProgress(
	previous: DatabaseJobProgress,
	incoming: DatabaseJobProgress,
): DatabaseJobProgress {
	return {
		stage: incoming.stage,
		current: Math.max(previous.current, incoming.current),
		total: Math.max(
			previous.total,
			incoming.total,
			previous.current,
			incoming.current,
		),
		detail: incoming.detail,
	};
}

export class DatabaseJobManager {
	private readonly records = new Map<string, DatabaseJobRecord>();
	private activeJobId: string | null = null;
	private readonly lockPath: string;
	private writerLockHandle: number | null = null;
	private writerLockToken: string | null = null;
	private lockHeartbeat: NodeJS.Timeout | null = null;
	private lockRetryTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly jobRoot = JOB_ROOT,
		private readonly options: DatabaseJobManagerOptions = {},
	) {
		this.lockPath = path.join(this.jobRoot, WRITER_LOCK_NAME);
		this.loadRecords();
		setImmediate(() => this.drain());
	}

	public startImportBatch(expectedFiles: number): DatabaseJobView {
		if (
			!Number.isInteger(expectedFiles) ||
			expectedFiles < 1 ||
			expectedFiles > MAX_IMPORT_FILES
		) {
			throw new Error(`Jumlah file harus antara 1 dan ${MAX_IMPORT_FILES}`);
		}

		const id = randomUUID();
		const timestamp = now();
		const record: DatabaseJobRecord = {
			id,
			kind: "import",
			status: "staging",
			createdAt: timestamp,
			updatedAt: timestamp,
			expectedFiles,
			files: Array.from({ length: expectedFiles }, () => null),
			progress: {
				stage: "upload",
				current: 0,
				total: expectedFiles,
				detail: "Menunggu file",
			},
			attempts: 0,
		};
		fs.mkdirSync(this.jobDirectory(id), { recursive: true });
		this.records.set(id, record);
		this.persist(record);
		return this.toView(record);
	}

	public appendImportFile(
		id: string,
		index: number,
		name: string,
		body: Buffer,
	): DatabaseJobView {
		const record = this.requireRecord(id);
		if (record.kind !== "import" || record.status !== "staging") {
			throw new Error("Batch import tidak lagi menerima file");
		}
		if (!Number.isInteger(index) || index < 0 || index >= record.expectedFiles) {
			throw new Error("Index file batch tidak valid");
		}
		validateImportBody(body);

		const filePath = path.join(
			this.jobDirectory(id),
			`input-${String(index).padStart(4, "0")}.db`,
		);
		const temporary = `${filePath}.${process.pid}.tmp`;
		try {
			fs.writeFileSync(temporary, body);
			fs.renameSync(temporary, filePath);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		record.files[index] = { name, path: filePath };
		record.updatedAt = now();
		record.progress = {
			stage: "upload",
			current: record.files.filter(Boolean).length,
			total: record.expectedFiles,
			detail: name,
		};
		this.persist(record);
		return this.toView(record);
	}

	public finishImportBatch(id: string): DatabaseJobView {
		const record = this.requireRecord(id);
		if (record.kind !== "import" || record.status !== "staging") {
			throw new Error("Batch import tidak dapat diselesaikan");
		}
		if (record.files.some((file) => file === null)) {
			throw new Error("Belum semua file batch diterima");
		}
		record.status = "queued";
		record.updatedAt = now();
		record.progress = {
			stage: "queued",
			current: record.progress.current,
			total: Math.max(record.progress.total, record.expectedFiles),
			detail: "Menunggu antrean",
		};
		this.persist(record);
		this.drain();
		return this.toView(record);
	}

	public enqueueSingleImport(name: string, body: Buffer): DatabaseJobView {
		validateImportBody(body);
		const batch = this.startImportBatch(1);
		this.appendImportFile(batch.id, 0, name, body);
		return this.finishImportBatch(batch.id);
	}

	public enqueueReset(): DatabaseJobView {
		const id = randomUUID();
		const timestamp = now();
		const record: DatabaseJobRecord = {
			id,
			kind: "reset",
			status: "queued",
			createdAt: timestamp,
			updatedAt: timestamp,
			expectedFiles: 0,
			files: [],
			progress: {
				stage: "queued",
				current: 0,
				total: 1,
				detail: "Menunggu antrean",
			},
			attempts: 0,
		};
		fs.mkdirSync(this.jobDirectory(id), { recursive: true });
		this.records.set(id, record);
		this.persist(record);
		this.drain();
		return this.toView(record);
	}

	public getJob(id: string): DatabaseJobView | null {
		if (!JOB_ID_PATTERN.test(id)) return null;
		const record = this.records.get(id);
		return record ? this.toView(record) : null;
	}

	private loadRecords(): void {
		fs.mkdirSync(this.jobRoot, { recursive: true });
		let lockedRunningJob = false;
		for (const entry of fs.readdirSync(this.jobRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
			try {
				const record = JSON.parse(
					fs.readFileSync(this.jobRecordPath(entry.name), "utf-8"),
				) as DatabaseJobRecord;
				if (record.status === "running") {
					if (this.writerLockIsActive()) {
						lockedRunningJob = true;
					} else {
						record.status = "queued";
						record.updatedAt = now();
						record.progress = {
							...record.progress,
							stage: "recovery",
							detail: "Dilanjutkan setelah backend restart",
						};
						writeAtomic(this.jobRecordPath(record.id), record);
					}
				}
				this.records.set(record.id, record);
			} catch (error) {
				console.warn(`[database-jobs] Cannot load ${entry.name}:`, error);
			}
		}
		if (lockedRunningJob) this.scheduleDrainRetry();
	}

	private writerLockIsActive(): boolean {
		try {
			const stats = fs.statSync(this.lockPath);
			if (Date.now() - stats.mtimeMs > WRITER_LOCK_STALE_MS) return false;
			const owner = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as {
				pid?: number;
			};
			const pid = owner.pid;
			if (typeof pid !== "number" || !Number.isInteger(pid)) return true;
			if (pid === process.pid) return true;
			try {
				process.kill(pid, 0);
				return true;
			} catch (error) {
				return (error as NodeJS.ErrnoException).code === "EPERM";
			}
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== "ENOENT";
		}
	}

	private tryAcquireWriterLock(): boolean {
		if (this.writerLockHandle !== null) return true;
		fs.mkdirSync(this.jobRoot, { recursive: true });
		for (let attempt = 0; attempt < 2; attempt++) {
			let handle: number | null = null;
			try {
				const token = randomUUID();
				handle = fs.openSync(this.lockPath, "wx");
				fs.writeFileSync(
					handle,
					JSON.stringify({ pid: process.pid, token, startedAt: now() }),
					"utf8",
				);
				this.writerLockHandle = handle;
				this.writerLockToken = token;
				this.lockHeartbeat = setInterval(
					() => this.refreshWriterLock(),
					WRITER_LOCK_HEARTBEAT_MS,
				);
				this.lockHeartbeat.unref();
				return true;
			} catch (error) {
				if (handle !== null) {
					try {
						fs.closeSync(handle);
					} catch {
						// The failed acquisition is already recoverable via the lock file.
					}
				}
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
				if (this.writerLockIsActive()) return false;
				try {
					fs.rmSync(this.lockPath, { force: true });
				} catch {
					return false;
				}
			}
		}
		return false;
	}

	private scheduleDrainRetry(): void {
		if (this.lockRetryTimer) return;
		this.lockRetryTimer = setTimeout(() => {
			this.lockRetryTimer = null;
			this.loadRecords();
			this.drain();
		}, WRITER_LOCK_RETRY_MS);
		this.lockRetryTimer.unref();
	}

	private refreshWriterLock(): void {
		if (this.writerLockHandle === null) return;
		try {
			const timestamp = new Date();
			fs.futimesSync(this.writerLockHandle, timestamp, timestamp);
		} catch (error) {
			console.warn("[database-jobs] Writer lock heartbeat failed:", error);
		}
	}

	private releaseWriterLock(): void {
		if (this.lockHeartbeat) clearInterval(this.lockHeartbeat);
		this.lockHeartbeat = null;
		const handle = this.writerLockHandle;
		const token = this.writerLockToken;
		this.writerLockHandle = null;
		this.writerLockToken = null;
		if (handle !== null) {
			try {
				fs.closeSync(handle);
			} catch {
				// The process can still reclaim the lock after a crash.
			}
		}
		if (!token) return;
		try {
			const owner = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as {
				token?: string;
			};
			if (owner.token === token) fs.rmSync(this.lockPath, { force: true });
		} catch {
			// A missing or already-reclaimed lock is safe.
		}
	}

	private jobDirectory(id: string): string {
		return path.join(this.jobRoot, id);
	}

	private jobRecordPath(id: string): string {
		return path.join(this.jobDirectory(id), JOB_RECORD_NAME);
	}

	private requireRecord(id: string): DatabaseJobRecord {
		if (!JOB_ID_PATTERN.test(id)) throw new Error("Job ID tidak valid");
		const record = this.records.get(id);
		if (!record) throw new Error("Job tidak ditemukan");
		return record;
	}

	private persist(record: DatabaseJobRecord): void {
		record.updatedAt = now();
		writeAtomic(this.jobRecordPath(record.id), record);
	}

	private toView(record: DatabaseJobRecord): DatabaseJobView {
		return {
			id: record.id,
			kind: record.kind,
			status: record.status,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			expectedFiles: record.expectedFiles,
			receivedFiles: record.files.filter(Boolean).length,
			progress: { ...record.progress },
			result: record.result,
			error: record.error,
		};
	}

	private drain(): void {
		if (this.activeJobId) return;
		const next = [...this.records.values()]
			.filter((record) => record.status === "queued")
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
		if (!next) return;
		if (!this.tryAcquireWriterLock()) {
			this.scheduleDrainRetry();
			return;
		}

		this.activeJobId = next.id;
		next.status = "running";
		next.attempts++;
		next.progress = {
			stage: "starting",
			current: next.progress.current,
			total: Math.max(
				next.progress.total,
				next.kind === "import" ? next.expectedFiles : 1,
			),
			detail: "Memulai job",
		};
		this.persist(next);

		const workerFile = import.meta.url.endsWith(".ts")
			? "./databaseJobWorker.ts"
			: "./databaseJobWorker.js";
		let worker: Worker;
		try {
			worker = new Worker(new URL(workerFile, import.meta.url));
		} catch (error) {
			this.retryOrFail(next, errorMessage(error));
			this.activeJobId = null;
			this.releaseWriterLock();
			this.drain();
			return;
		}
		let settled = false;
		const finish = (handler: () => void) => {
			if (settled) return;
			settled = true;
			handler();
			void worker.terminate();
			this.activeJobId = null;
			this.releaseWriterLock();
			this.drain();
		};

		worker.on("message", (message: { type: string; [key: string]: unknown }) => {
			if (message.type === "progress") {
				this.refreshWriterLock();
				next.progress = mergeProgress(
					next.progress,
					message.progress as DatabaseJobProgress,
				);
				this.persist(next);
				return;
			}
			if (message.type === "completed") {
				finish(() => {
					next.status = "completed";
					next.result = message.result as DatabaseJobResult;
					next.error = undefined;
					next.progress = {
						stage: "completed",
						current: Math.max(next.progress.current, next.progress.total),
						total: Math.max(next.progress.total, next.progress.current),
						detail: "Selesai",
					};
					this.persist(next);
					this.cleanupInputs(next);
					if (this.options.invalidateCaches !== false) this.invalidateCaches();
				});
				return;
			}
			if (message.type === "failed") {
				finish(() => this.markFailed(next, String(message.error || "Job gagal")));
			}
		});
		worker.on("error", (error) => {
			if (!settled) finish(() => this.retryOrFail(next, errorMessage(error)));
		});
		worker.on("exit", (code) => {
			if (!settled) {
				finish(() => this.retryOrFail(next, `Worker berhenti dengan kode ${code}`));
			}
		});
		try {
			worker.postMessage({
				kind: next.kind,
				files: next.files.filter((file): file is DatabaseJobFile => file !== null),
				processorOptions: {
					...this.options.processorOptions,
					transactionDirectory: this.jobDirectory(next.id),
				},
			});
		} catch (error) {
			finish(() => this.retryOrFail(next, errorMessage(error)));
		}
	}

	private markFailed(record: DatabaseJobRecord, message: string): void {
		record.status = "failed";
		record.error = message;
		record.progress = {
			...record.progress,
			stage: "failed",
			detail: message,
		};
		this.persist(record);
		this.cleanupInputs(record);
	}

	private retryOrFail(record: DatabaseJobRecord, message: string): void {
		if (record.attempts < 3) {
			record.status = "queued";
			record.error = message;
			record.progress = {
				...record.progress,
				stage: "retrying",
				detail: message,
			};
			this.persist(record);
			return;
		}
		this.markFailed(record, message);
	}

	private cleanupInputs(record: DatabaseJobRecord): void {
		for (const file of record.files) {
			if (!file) continue;
			try {
				fs.rmSync(file.path, { force: true });
			} catch {
				// Keep the terminal job record durable if cleanup is not possible.
			}
		}
	}

	private invalidateCaches(): void {
		try {
			realDataLoader.invalidateTranslationStats();
			invalidateTextVersionWorkingSet();
		} catch (error) {
			console.warn("[database-jobs] Cache invalidation failed:", error);
		}
	}
}

export const databaseJobManager = new DatabaseJobManager();
