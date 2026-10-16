'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Approval } from '@/lib/api';
import { Badge } from '@/components/Badge';

export default function ApprovalsPage() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.listApprovals().then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  async function decide(id: number, status: 'approved' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      await api.decideApproval(id, status);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Approvals</h1>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Exception</th>
              <th className="px-4 py-2">Recommended</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-4 py-2">#{a.id}</td>
                <td className="px-4 py-2">{a.request_type}</td>
                <td className="px-4 py-2">
                  <Link className="text-indigo-600 hover:underline" href={`/exceptions/${a.entity_id}`}>#{a.entity_id}</Link>
                </td>
                <td className="px-4 py-2 text-xs">{a.metadata?.action ?? '-'} ({a.metadata?.confidence ?? '-'})</td>
                <td className="px-4 py-2"><Badge value={a.status} /></td>
                <td className="px-4 py-2">
                  {a.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={() => decide(a.id, 'approved')} className="rounded bg-green-600 px-2 py-1 text-xs text-white disabled:opacity-50">Approve</button>
                      <button disabled={busy} onClick={() => decide(a.id, 'rejected')} className="rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50">Reject</button>
                    </div>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={6}>No approvals.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
