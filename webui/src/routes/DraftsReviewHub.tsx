import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MOCK_DRAFTS } from '../mockData/draftsAndVersions';
import { DiffInspector } from '../components/review/DiffInspector';
import { TranslationDraft } from '../types';
import { FileText, CheckCircle, Clock, XCircle, Search, CheckCheck, Send, Check } from 'lucide-react';
import { fetchDrafts, approveDraft, rejectDraft, batchApproveDrafts, applyApprovedDrafts } from '../lib/api';

export const DraftsReviewHub: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);

  const { data: draftsData } = useQuery({
    queryKey: ['drafts'],
    queryFn: () => fetchDrafts(),
  });

  const drafts: TranslationDraft[] = draftsData?.drafts || MOCK_DRAFTS;

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveDraft(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drafts'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectDraft(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drafts'] }),
  });

  const batchApproveMutation = useMutation({
    mutationFn: () => batchApproveDrafts(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drafts'] }),
  });

  const applyMutation = useMutation({
    mutationFn: () => applyApprovedDrafts(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['questDetail'] });
      queryClient.invalidateQueries({ queryKey: ['chapterQuests'] });
      setApplySuccessMsg(`Berhasil menerapkan ${res.appliedCount} draf ke berkas resmi quest (${res.versionTag})!`);
      setTimeout(() => setApplySuccessMsg(null), 5000);
    },
  });

  const handleApprove = (id: string) => {
    approveMutation.mutate(id);
  };

  const handleReject = (id: string, reason: string) => {
    rejectMutation.mutate({ id, reason });
  };

  const handleBatchApproveAllPending = () => {
    batchApproveMutation.mutate();
  };

  const handleApplyApproved = () => {
    applyMutation.mutate();
  };

  const filteredDrafts = drafts.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        d.questTitle.toLowerCase().includes(q) ||
        d.speakerName.toLowerCase().includes(q) ||
        d.proposedText.toLowerCase().includes(q) ||
        d.author.name.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pendingCount = drafts.filter((d) => d.status === 'pending').length;
  const approvedCount = drafts.filter((d) => d.status === 'approved').length;
  const rejectedCount = drafts.filter((d) => d.status === 'rejected').length;

  return (
    <div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
      {/* Toast Notification Banner */}
      {applySuccessMsg && (
        <div className="bg-cyber-emerald/10 border border-cyber-emerald/40 text-cyber-emerald px-4 py-2 rounded-lg text-xs font-mono flex items-center space-x-2 shrink-0 animate-bounce">
          <Check className="w-4 h-4 shrink-0 text-cyber-emerald" />
          <span>{applySuccessMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 border-b border-obsidian-800 pb-2.5">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-100 flex items-center space-x-2 font-sans">
            <FileText className="w-5 h-5 text-cyber-gold" />
            <span>Drafts Review Hub & Visual Diff Inspector</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Peninjauan draf usulan terjemahan komunitas dengan pembanding diff visual real data.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {pendingCount > 0 && (
            <button
              onClick={handleBatchApproveAllPending}
              disabled={batchApproveMutation.isPending}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyber-amber/20 hover:bg-cyber-amber/30 text-cyber-amber border border-cyber-amber/40 text-xs font-mono font-bold transition-all disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Setujui Semua ({pendingCount})</span>
            </button>
          )}

          {approvedCount > 0 && (
            <button
              onClick={handleApplyApproved}
              disabled={applyMutation.isPending}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-cyber-emerald text-obsidian-950 hover:bg-cyber-emerald/90 text-xs font-mono font-bold shadow-cyber-glow transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>Terapkan Draf Disetujui ({approvedCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="cyber-card px-3 py-2 shrink-0 flex flex-wrap items-center justify-between gap-2 bg-obsidian-900/90 border-obsidian-800">
        <div className="flex items-center space-x-1 font-mono text-xs">
          <button
            onClick={() => setStatusFilter('pending')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded transition-all ${
              statusFilter === 'pending'
                ? 'bg-cyber-amber/20 text-cyber-amber font-bold border border-cyber-amber/40'
                : 'text-slate-400 hover:bg-obsidian-800'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>Pending ({pendingCount})</span>
          </button>

          <button
            onClick={() => setStatusFilter('approved')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded transition-all ${
              statusFilter === 'approved'
                ? 'bg-cyber-emerald/20 text-cyber-emerald font-bold border border-cyber-emerald/40'
                : 'text-slate-400 hover:bg-obsidian-800'
            }`}
          >
            <CheckCircle className="w-3 h-3" />
            <span>Disetujui ({approvedCount})</span>
          </button>

          <button
            onClick={() => setStatusFilter('rejected')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded transition-all ${
              statusFilter === 'rejected'
                ? 'bg-cyber-rose/20 text-cyber-rose font-bold border border-cyber-rose/40'
                : 'text-slate-400 hover:bg-obsidian-800'
            }`}
          >
            <XCircle className="w-3 h-3" />
            <span>Ditolak ({rejectedCount})</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative w-48">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari draf..."
            className="w-full bg-obsidian-950 border border-obsidian-700 rounded pl-8 pr-2 py-1 text-xs font-mono text-slate-200 outline-none"
          />
        </div>
      </div>

      {/* Internal Scrollable Draft List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {filteredDrafts.length === 0 ? (
          <div className="py-16 text-center text-xs font-mono text-slate-400">
            Tidak ada draf dengan status "{statusFilter}".
          </div>
        ) : (
          filteredDrafts.map((draft) => (
            <DiffInspector
              key={draft.id}
              draft={draft}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))
        )}
      </div>
    </div>
  );
};
