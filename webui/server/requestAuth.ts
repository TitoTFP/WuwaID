import type { Request, Response } from "express";
import { db, type UserSession } from "./db.js";

export type UserRole = UserSession["role"];

function sessionFromRequest(req: Request): UserSession | undefined {
	const authorization = req.headers.authorization;
	if (!authorization?.startsWith("Bearer ")) return undefined;
	const token = authorization.slice("Bearer ".length).trim();
	return token ? db.getSession(token) : undefined;
}

export function requireRoles(
	req: Request,
	res: Response,
	roles: readonly UserRole[],
	message: string,
): UserSession | null {
	const session = sessionFromRequest(req);
	if (!session) {
		res.status(401).json({ error: message });
		return null;
	}
	if (!roles.includes(session.role)) {
		res.status(403).json({ error: message });
		return null;
	}
	return session;
}

export function requireEditor(req: Request, res: Response, message: string) {
	return requireRoles(req, res, ["editor", "admin"], message);
}

export function requireAdmin(req: Request, res: Response, message: string) {
	return requireRoles(req, res, ["admin"], message);
}

export function requireTelemetryToken(req: Request, res: Response): boolean {
	const expected = process.env.WUWAID_TELEMETRY_TOKEN?.trim();
	if (!expected) {
		if (process.env.NODE_ENV === "production") {
			res.status(503).json({ error: "Telemetry authentication is not configured." });
			return false;
		}
		return true;
	}

	const provided = req.header("X-WuwaID-Telemetry-Token")?.trim();
	if (!provided) {
		res.status(401).json({ error: "Telemetry authentication is required." });
		return false;
	}
	if (provided !== expected) {
		res.status(403).json({ error: "Telemetry authentication is invalid." });
		return false;
	}
	return true;
}
