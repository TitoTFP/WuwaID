import type React from "react";
import { useState } from "react";
import { Masthead } from "./Masthead";
import { CommandPalette } from "./CommandPalette";
import { useAuth } from "../lib/useAuth";
import type { UserRole } from "../types";

interface LayoutProps {
	children: React.ReactNode;
	role?: UserRole;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const { role, username, logout, login } = useAuth();

	return (
		<div className="h-screen w-screen overflow-hidden bg-obsidian-950 text-slate-200 flex flex-col font-sans select-none">
			{/* Linear-style Masthead Navigation */}
			<Masthead
				onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
				role={role as UserRole}
				username={username}
				onLogout={logout}
				onLogin={login}
			/>

			{/* Command Palette Modal */}
			<CommandPalette
				isOpen={isCommandPaletteOpen}
				onOpen={() => setIsCommandPaletteOpen(true)}
				onClose={() => setIsCommandPaletteOpen(false)}
			/>

			{/* Main Surface View Container */}
			<main className="flex-1 w-full overflow-hidden px-4 sm:px-6 py-3 flex flex-col">
				{children}
			</main>

			{/* Footer Status Bar */}
			<footer className="w-full h-8 shrink-0 bg-obsidian-950/90 border-t border-obsidian-800/80 px-4 flex items-center justify-between text-xs font-mono text-slate-400">
				<div className="flex items-center space-x-4">
					<span>WuwaID Monorepo • Standalone Fullstack WebUI</span>
					<span className="hidden sm:inline">•</span>
					<span className="hidden sm:inline">
						Role: <code className="text-cyber-cyan font-bold">{role}</code>
					</span>
				</div>
				<div className="flex items-center space-x-3">
					<span>Tampilan Above the Fold (WCAG AA/AAA Verified)</span>
					<span className="hidden sm:inline">•</span>
					<span>
						Tekan{" "}
						<kbd className="px-1 py-0.5 bg-obsidian-900 border border-obsidian-800 rounded text-slate-300">
							Ctrl+K
						</kbd>
					</span>
				</div>
			</footer>
		</div>
	);
};
