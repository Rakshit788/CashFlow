'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ExceptionRecord } from '@/lib/api';
import { Badge } from '@/components/Badge';

const TYPES = ['', 'amount_mismatch', 'unapplied_payment', 'duplicate_payment', 'overpayment', 'timing_issue', 'other'];
const STATUSES = ['', 'open', 'investigating', 'pending_approval', 'resolved', 'rejected'];
const SEVERITIES = ['', 'low', 'medium', 'high'];

export default function ExceptionsPage() {
  const [rows, setRows] = useState<ExceptionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .listExceptions({ page, limit, status, type, severity })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, status, type, severity]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Exceptions</h1>

      <div className="mb-4 flex flex-wrap gap-3">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded border border-slate-300 px-2 py-1 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="rounded border border-slate-300 px-2 py-1 text-sm">
          {TYPES.map((s) => <option key={s} value={s}>{s || 'All types'}</option>)}
        </select>
        <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className="rounded border border-slate-300 px-2 py-1 text-sm">
          {SEVERITIES.map((s) => <option key={s} value={s}>{s || 'All severities'}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Severity</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Delta</th>
              <th className="px-4 py-2">Detected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link className="text-indigo-600 hover:underline" href={`/exceptions/${r.id}`}>#{r.id}</Link>
                </td>
                <td className="px-4 py-2">{r.customer_name || `Customer ${r.customer_id}`}</td>
                <td className="px-4 py-2">{r.type}</td>
                <td className="px-4 py-2"><Badge value={r.severity} /></td>
                <td className="px-4 py-2"><Badge value={r.status} /></td>
                <td className="px-4 py-2">{r.amount_delta ?? '-'}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(r.detected_at).toLocaleString()}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={7}>No exceptions found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-slate-500">{total} total</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">Prev</button>
          <span className="px-2 py-1">Page {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
