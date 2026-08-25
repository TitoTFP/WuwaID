import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";

export const authRouter = Router();

function configuredCredential(name: string): string | undefined | null {
	const configured = process.env[name];
	if (configured?.length) return configured;
	return process.env.NODE_ENV === "production" ? null : undefined;
}

function credentialsMatch(password: unknown, expected: string | undefined): boolean {
	if (typeof password !== "string" || password.length === 0) return false;
	if (expected === undefined) return true;
	const actualBytes = Buffer.from(password);
	const expectedBytes = Buffer.from(expected);
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

function authenticate(
	password: unknown,
	environmentName: string,
	res: Response,
): boolean {
	const expected = configuredCredential(environmentName);
	if (expected === null) {
		res.status(503).json({ error: "Authentication is not configured." });
		return false;
	}
	if (!credentialsMatch(password, expected)) {
		res.status(401).json({ error: "Invalid credentials." });
		return false;
	}
	return true;
}

// POST /api/auth/login or /api/login - Editor login
// Development keeps the legacy password-compatible flow when no credential is
// configured; production must set WUWAID_EDITOR_PASSWORD and validate it.
authRouter.post(["/login", "/auth/login"], (req: Request, res: Response) => {
	if (!authenticate(req.body?.password, "WUWAID_EDITOR_PASSWORD", res)) return;

	const session = db.createSession(
		"editor",
		req.body?.password === "admin" ? "WuwaID Lead Editor" : "Translator Editor",
	);
	res.json({
		status: "success",
		token: session.token,
		role: session.role,
		username: session.username,
	});
});

// POST /api/auth/admin/login or /api/admin/login - Admin login
// Production must set WUWAID_ADMIN_PASSWORD; never grant admin access on an
// unconfigured production server.
authRouter.post(
	["/admin/login", "/auth/admin/login"],
	(req: Request, res: Response) => {
		if (!authenticate(req.body?.password, "WUWAID_ADMIN_PASSWORD", res)) return;

		const session = db.createSession("admin", "WuwaID Lead Admin");
		res.json({
			status: "success",
			token: session.token,
			role: "admin",
			username: session.username,
		});
	},
);

// POST /api/auth/logout or /api/logout - Session logout
// Logout remains idempotent for clients that may already have an expired token.
authRouter.post(["/logout", "/auth/logout"], (req: Request, res: Response) => {
	const authHeader = req.headers.authorization;
	if (authHeader && authHeader.startsWith("Bearer ")) {
		const token = authHeader.substring(7).trim();
		if (token) db.sessions.delete(token);
	}
	res.json({ status: "logged_out" });
});

// GET /api/auth/me or /api/me - Current user session state
authRouter.get(["/me", "/auth/me"], (req: Request, res: Response) => {
	const authHeader = req.headers.authorization;

	if (authHeader && authHeader.startsWith("Bearer ")) {
		const token = authHeader.substring(7).trim();
		const session = token ? db.getSession(token) : undefined;

		if (session) {
			res.json({
				authenticated: true,
				role: session.role,
				username: session.username,
			});
			return;
		}
	}

	res.json({
		authenticated: false,
		role: "reader",
		username: "Guest Reader",
	});
});
