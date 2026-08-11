import React, { useState } from 'react';
import { MOCK_HEARTBEAT_DATA, MOCK_LOG_ENTRIES } from '../mockData/opsLogs';
import { LogEntry } from '../types';
import { Activity, Server, Download, Search, AlertCircle, AlertTriangle, Info, Terminal, Eye, X, HardDrive } from 'lucide-react';

export const OpsView: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOG_ENTRIES);
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [clientFilter, setClientFilter] = useState<'all' | 'WuwaLauncher' | 'WuwaMobile' | 'WuwaWeb'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogPayload, setSelectedLogPayload] = useState<LogEntry | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (clientFilter !== 'all' && log.client !== clientFilter) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        log.category.toLowerCase().includes(q) ||
        log.message.toLowerCase().includes(q) ||
        log.deviceId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const errorCount = logs.filter((l) => l.level === 'error').length;

  return (
    <div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
      {/* Compact Operations Header & Quick Stats Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 border-b border-obsidian-800 pb-2.5">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-cyber-emerald" />
          <h1 className="text-base sm:text-lg font-bold text-slate-100 font-sans">
            Operations & Telemetry Control Center
          </h1>
        </div>

        {/* Metric Badges Row */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <div className="cyber-card px-2.5 py-1 flex items-center space-x-1.5 bg-obsidian-900 border-obsidian-800">
            <Activity className="w-3.5 h-3.5 text-cyber-emerald animate-pulse" />
            <span>3,420 Active</span>
          </div>

          <div className="cyber-card px-2.5 py-1 flex items-center space-x-1.5 bg-obsidian-900 border-obsidian-800">
            <Server className="w-3.5 h-3.5 text-cyber-cyan" />
            <span>690 /m Stream</span>
          </div>

          <div className="cyber-card px-2.5 py-1 flex items-center space-x-1.5 bg-obsidian-900 border-obsidian-800">
            <AlertCircle className="w-3.5 h-3.5 text-cyber-rose" />
            <span>{errorCount} Error</span>
          </div>

          <button
            onClick={() => alert('Mengunduh paket log zip mentah...')}
            className="flex items-center space-x-1 px-3 py-1 rounded bg-obsidian-900 border border-obsidian-700 hover:border-cyber-emerald text-cyber-emerald font-bold transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Ekspor Zip</span>
          </button>
        </div>
      </div>

      {/* Grid: Left Column Telemetry Chart (4 cols) & Right Column Raw Log Table (8 cols) fitting height */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch overflow-hidden">
        {/* Left Column (4 cols): Active Players Heartbeat Telemetry Visualizer */}
        <div className="lg:col-span-4 cyber-card p-3 flex flex-col justify-between overflow-hidden border-obsidian-800 bg-obsidian-900/90">
          <div className="flex items-center justify-between pb-2 border-b border-obsidian-800 shrink-0">
            <span className="text-xs font-bold text-slate-100 font-sans">
              Activity Stream (24h)
            </span>
            <span className="text-[10px] font-mono text-cyber-emerald flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyber-emerald animate-ping" />
              <span>Live Sync</span>
            </span>
          </div>

          <div className="flex-1 flex items-end justify-between gap-2 pt-3 px-1 border-b border-obsidian-800">
            {MOCK_HEARTBEAT_DATA.map((pt, idx) => {
              const heightPct = Math.round((pt.activePlayers / 4000) * 100);

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 group h-full justify-end">
                  <div className="text-[9px] font-mono text-cyber-emerald opacity-0 group-hover:opacity-100 transition-opacity">
                    {pt.activePlayers}
                  </div>
                  <div className="w-full bg-obsidian-950 rounded-t h-full flex items-end overflow-hidden">
                    <div
                      className="w-full bg-gradient-to-t from-cyber-emerald/40 to-cyber-emerald rounded-t group-hover:bg-cyber-cyan transition-all duration-300 shadow-cyber-glow"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-slate-500">{pt.timestamp}</span>
                </div>
              );
            })}
          </div>

          <div className="pt-2 text-[10px] font-mono text-slate-500 flex justify-between shrink-0">
            <span>Peak: 3,420 Pemain</span>
            <span>Rata-rata: 2,780 Pemain</span>
          </div>
        </div>

        {/* Right Column (8 cols): Raw Log Stream Table */}
        <div className="lg:col-span-8 cyber-card p-3 flex flex-col overflow-hidden border-obsidian-800">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-obsidian-800 shrink-0">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-cyber-cyan" />
              <span className="text-xs font-bold text-slate-100 font-sans">
                Stream Log Mentah
              </span>
              <span className="text-[10px] font-mono text-slate-500">({filteredLogs.length} Log)</span>
            </div>

            {/* Filter Controls */}
            <div className="flex items-center space-x-1.5 text-xs font-mono">
              <div className="flex items-center bg-obsidian-950 p-0.5 rounded border border-obsidian-800 text-[10px]">
                <button
                  onClick={() => setLevelFilter('all')}
                  className={`px-2 py-0.5 rounded ${levelFilter === 'all' ? 'bg-cyber-cyan text-obsidian-950 font-bold' : 'text-slate-400'}`}
                >
                  All
                </button>
                <button
                  onClick={() => setLevelFilter('error')}
                  className={`px-2 py-0.5 rounded ${levelFilter === 'error' ? 'bg-cyber-rose text-white font-bold' : 'text-slate-400'}`}
                >
                  Err
                </button>
                <button
                  onClick={() => setLevelFilter('warn')}
                  className={`px-2 py-0.5 rounded ${levelFilter === 'warn' ? 'bg-cyber-amber text-obsidian-950 font-bold' : 'text-slate-400'}`}
                >
                  Warn
                </button>
              </div>

              <div className="relative w-36">
                <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari..."
                  className="w-full bg-obsidian-950 border border-obsidian-800 rounded pl-7 pr-2 py-0.5 text-xs font-mono text-slate-200 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Internal Scrollable Table Body (Above the Fold) */}
          <div className="flex-1 overflow-y-auto pt-1">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-obsidian-800 text-slate-500 uppercase text-[9px] sticky top-0 bg-obsidian-900 z-10">
                  <th className="py-1.5 px-2">Level</th>
                  <th className="py-1.5 px-2">Klien</th>
                  <th className="py-1.5 px-2">Device ID</th>
                  <th className="py-1.5 px-2">Pesan Log</th>
                  <th className="py-1.5 px-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-obsidian-800/60">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-obsidian-850/60 transition-colors">
                    <td className="py-2 px-2">
                      {log.level === 'error' && (
                        <span className="px-1.5 py-0.5 rounded bg-cyber-rose/15 text-cyber-rose font-bold text-[10px]">
                          ERR
                        </span>
                      )}
                      {log.level === 'warn' && (
                        <span className="px-1.5 py-0.5 rounded bg-cyber-amber/15 text-cyber-amber font-bold text-[10px]">
                          WARN
                        </span>
                      )}
                      {log.level === 'info' && (
                        <span className="px-1.5 py-0.5 rounded bg-cyber-emerald/15 text-cyber-emerald font-bold text-[10px]">
                          INFO
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-slate-200 font-bold text-[11px]">
                      {log.client}
                    </td>
                    <td className="py-2 px-2 text-cyber-cyan text-[11px]">{log.deviceId}</td>
                    <td className="py-2 px-2 text-slate-300 max-w-xs truncate text-[11px]">{log.message}</td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => setSelectedLogPayload(log)}
                        className="px-2 py-0.5 rounded bg-obsidian-950 border border-obsidian-800 text-cyber-cyan hover:bg-cyber-cyan/10 text-[10px] font-bold"
                      >
                        JSON
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* JSON Payload Inspector Modal */}
      {selectedLogPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-xl bg-obsidian-900 border border-obsidian-700 rounded-xl p-4 space-y-3 shadow-panel">
            <div className="flex items-center justify-between pb-2 border-b border-obsidian-800">
              <div className="flex items-center space-x-2 font-mono text-xs font-bold text-cyber-cyan">
                <Terminal className="w-4 h-4" />
                <span>Payload JSON Log ({selectedLogPayload.id})</span>
              </div>
              <button
                onClick={() => setSelectedLogPayload(null)}
                className="p-1 rounded bg-obsidian-950 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="p-3 rounded-lg bg-obsidian-950 border border-obsidian-800 text-xs font-mono text-cyber-cyan overflow-x-auto max-h-80 leading-relaxed">
              {JSON.stringify(selectedLogPayload, null, 2)}
            </pre>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setSelectedLogPayload(null)}
                className="px-3 py-1 rounded bg-cyber-cyan text-obsidian-950 font-mono text-xs font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
