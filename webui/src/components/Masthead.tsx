import type React from "react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
	BookOpen,
	Database,
	Activity,
	Search,
	Shield,
	Zap,
	LogIn,
	LogOut,
	UserCheck,
} from "lucide-react";
import type { SurfaceMode, UserRole } from "../types";

interface MastheadProps {
	onOpenCommandPalette: () => void;
	role?: UserRole;
	username?: string;
	onLogout?: () => void;
	onLogin?: (password?: string) => Promise<any>;
}

export const Masthead: React.FC<MastheadProps> = ({
	onOpenCommandPalette,
	role = "reader",
	username = "Guest",
	onLogout,
	onLogin,
}) => {
	const location = useLocation();
	const [showLoginModal, setShowLoginModal] = useState(false);
	const [passwordInput, setPasswordInput] = useState("");
	const [loginError, setLoginError] = useState("");

	const getActiveMode = (): SurfaceMode => {
		if (
			location.pathname.startsWith("/categories") ||
			location.pathname.startsWith("/reader/categories")
		) {
			return "categories";
		}
		if (
			location.pathname.startsWith("/workbench") ||
			location.pathname.startsWith("/editor") ||
			location.pathname.startsWith("/translator")
		) {
			return "workbench";
		}
		if (
			location.pathname.startsWith("/operations") ||
			location.pathname.startsWith("/admin")
		) {
			return "operations";
		}
		if (
			location.pathname.startsWith("/databases") ||
			location.pathname.startsWith("/configdb")
		) {
			return "databases";
		}
		return "reader";
	};

	const activeMode = getActiveMode();

	const handleLoginSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoginError("");
		try {
			if (onLogin) {
				await onLogin(passwordInput);
				setShowLoginModal(false);
				setPasswordInput("");
			}
		} catch (err: any) {
			setLoginError(err.message || "Login gagal");
		}
	};

	return (
		<header className="sticky top-0 z-40 w-full h-14 bg-obsidian-950/90 backdrop-blur-md border-b border-obsidian-800/80 px-4 flex items-center justify-between">
			{/* Left: Brand Identity */}
			<div className="flex items-center space-x-6">
				<NavLink to="/" className="flex items-center space-x-2.5 group">
					<div className="w-7 h-7 rounded-lg bg-cyber-cyan/10 border border-cyber-cyan/40 flex items-center justify-center text-cyber-cyan group-hover:shadow-cyber-glow group-hover:bg-cyber-cyan/20 transition-all duration-200">
						<Zap className="w-4 h-4 fill-cyber-cyan/20" />
					</div>
					<div className="flex flex-col">
						<span className="font-mono font-bold text-sm tracking-wider text-slate-100 group-hover:text-cyber-cyan transition-colors">
							WuwaID<span className="text-cyber-cyan">.webui</span>
						</span>
						<span className="text-[10px] font-mono text-slate-400 leading-none font-medium">
							v1.0.0 • Standalone Fullstack
						</span>
					</div>
				</NavLink>

				{/* Center-Left: Surface Mode Switcher */}
				<nav className="hidden md:flex items-center space-x-1 bg-obsidian-900/90 p-1 rounded-lg border border-obsidian-800">
					<NavLink
						to="/"
						className={({ isActive }) =>
							`flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
								activeMode === "reader"
									? "bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30 shadow-sm"
									: "text-slate-300 hover:text-slate-100 hover:bg-obsidian-800"
							}`
						}
					>
						<BookOpen className="w-3.5 h-3.5" />
						<span>Reader</span>
					</NavLink>

					<NavLink
						to="/categories"
						className={({ isActive }) =>
							`flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
								activeMode === "categories"
									? "bg-cyber-gold/15 text-cyber-gold border border-cyber-gold/30 shadow-sm"
									: "text-slate-300 hover:text-slate-100 hover:bg-obsidian-800"
							}`
						}
					>
						<Database className="w-3.5 h-3.5" />
						<span>Kategori</span>
					</NavLink>

					<NavLink
						to="/operations"
						className={({ isActive }) =>
							`flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
								activeMode === "operations"
									? "bg-cyber-emerald/15 text-cyber-emerald border border-cyber-emerald/30 shadow-sm"
									: "text-slate-300 hover:text-slate-100 hover:bg-obsidian-800"
							}`
						}
					>
						<Activity className="w-3.5 h-3.5" />
						<span>Operations</span>
					</NavLink>

					<NavLink
						to="/databases"
						className={({ isActive }) =>
							`flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
								activeMode === "databases"
									? "bg-cyber-gold/15 text-cyber-gold border border-cyber-gold/30 shadow-sm"
									: "text-slate-300 hover:text-slate-100 hover:bg-obsidian-800"
							}`
						}
					>
						<Database className="w-3.5 h-3.5" />
						<span>Databases</span>
					</NavLink>
				</nav>
			</div>

			{/* Right: Command Palette Button & User Role */}
			<div className="flex items-center space-x-3">
				{/* Command Search Bar Trigger */}
				<button
					onClick={onOpenCommandPalette}
					className="flex items-center space-x-3 px-3 py-1.5 rounded-lg bg-obsidian-900 border border-obsidian-700/60 hover:border-cyber-cyan/40 text-slate-300 hover:text-slate-100 transition-all text-xs font-mono group"
				>
					<Search className="w-3.5 h-3.5 text-slate-300 group-hover:text-cyber-cyan transition-colors" />
					<span className="hidden sm:inline">Cari atau Jalankan...</span>
					<kbd className="px-1.5 py-0.5 text-[10px] bg-obsidian-800 text-slate-300 rounded border border-obsidian-700">
						Ctrl+K
					</kbd>
				</button>

				{/* Server Health Status Indicator */}
				<div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-obsidian-900/60 border border-obsidian-800 text-[11px] font-mono text-slate-300">
					<span className="w-2 h-2 rounded-full bg-cyber-emerald animate-pulse" />
					<span>API Online</span>
				</div>

				{/* Role & Auth Controls */}
				<div className="flex items-center space-x-2">
					<div className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-cyber-gold/10 border border-cyber-gold/30 text-cyber-gold text-xs font-mono font-bold">
						<Shield className="w-3 h-3" />
						<span className="capitalize">{role}</span>
					</div>

					{role !== "reader" ? (
						<button
							onClick={onLogout}
							title={`Logout (${username})`}
							className="p-1.5 rounded-md bg-obsidian-900 border border-obsidian-700 text-slate-400 hover:text-cyber-rose hover:border-cyber-rose/40 transition-colors"
						>
							<LogOut className="w-3.5 h-3.5" />
						</button>
					) : (
						<button
							onClick={() => setShowLoginModal(true)}
							className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/20 text-xs font-mono font-bold transition-all"
						>
							<LogIn className="w-3.5 h-3.5" />
							<span>Login</span>
						</button>
					)}
				</div>
			</div>

			{/* Login Modal */}
			{showLoginModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian-950/80 backdrop-blur-sm animate-fade-in">
					<div className="w-full max-w-sm bg-obsidian-900 border border-obsidian-700 rounded-xl p-5 space-y-4 shadow-panel">
						<div className="flex items-center justify-between pb-2 border-b border-obsidian-800">
							<h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2 font-mono">
								<UserCheck className="w-4 h-4 text-cyber-cyan" />
								<span>Login Sesi Editor / Admin</span>
							</h3>
						</div>

						<form onSubmit={handleLoginSubmit} className="space-y-3">
							<div>
								<label className="block text-xs font-mono text-slate-400 mb-1">
									Kata Sandi Akses:
								</label>
								<input
									type="password"
									value={passwordInput}
									onChange={(e) => setPasswordInput(e.target.value)}
									placeholder="Ketik password ('editor' / 'admin')..."
									className="w-full bg-obsidian-950 border border-obsidian-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyber-cyan"
									autoFocus
								/>
							</div>

							{loginError && (
								<p className="text-xs font-mono text-cyber-rose">
									{loginError}
								</p>
							)}

							<div className="flex justify-end space-x-2 pt-2">
								<button
									type="button"
									onClick={() => setShowLoginModal(false)}
									className="px-3 py-1.5 rounded bg-obsidian-950 text-slate-400 text-xs font-mono"
								>
									Batal
								</button>
								<button
									type="submit"
									className="px-4 py-1.5 rounded bg-cyber-cyan text-obsidian-950 text-xs font-mono font-bold shadow-cyber-glow"
								>
									Masuk Sesi
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</header>
	);
};
