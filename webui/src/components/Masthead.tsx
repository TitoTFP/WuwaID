import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, PenTool, Activity, Search, Shield, Zap } from 'lucide-react';
import { SurfaceMode, UserRole } from '../types';

interface MastheadProps {
  onOpenCommandPalette: () => void;
  role?: UserRole;
}

export const Masthead: React.FC<MastheadProps> = ({ onOpenCommandPalette, role = 'translator' }) => {
  const location = useLocation();

  const getActiveMode = (): SurfaceMode => {
    if (location.pathname.startsWith('/workbench') || location.pathname.startsWith('/editor') || location.pathname.startsWith('/translator')) {
      return 'workbench';
    }
    if (location.pathname.startsWith('/operations') || location.pathname.startsWith('/admin')) {
      return 'operations';
    }
    return 'reader';
  };

  const activeMode = getActiveMode();

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
              v1.0.0 • ID Archive
            </span>
          </div>
        </NavLink>

        {/* Center-Left: Linear-style Surface Mode Switcher */}
        <nav className="hidden md:flex items-center space-x-1 bg-obsidian-900/90 p-1 rounded-lg border border-obsidian-800">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
                activeMode === 'reader'
                  ? 'bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30 shadow-sm'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-obsidian-800'
              }`
            }
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Reader</span>
          </NavLink>

          <NavLink
            to="/workbench"
            className={({ isActive }) =>
              `flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
                activeMode === 'workbench'
                  ? 'bg-cyber-gold/15 text-cyber-gold border border-cyber-gold/30 shadow-sm'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-obsidian-800'
              }`
            }
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Workbench</span>
          </NavLink>

          <NavLink
            to="/operations"
            className={({ isActive }) =>
              `flex items-center space-x-2 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
                activeMode === 'operations'
                  ? 'bg-cyber-emerald/15 text-cyber-emerald border border-cyber-emerald/30 shadow-sm'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-obsidian-800'
              }`
            }
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Operations</span>
          </NavLink>
        </nav>
      </div>

      {/* Right: Command Palette Button & Server Status */}
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

        {/* Role Badge */}
        <div className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-cyber-gold/10 border border-cyber-gold/30 text-cyber-gold text-xs font-mono font-bold">
          <Shield className="w-3 h-3" />
          <span className="capitalize">{role}</span>
        </div>
      </div>
    </header>
  );
};
