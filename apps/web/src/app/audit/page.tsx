'use client';

import { useEffect, useState } from 'react';
import { api, AuditLog } from '@/lib/api';

export default function AuditPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listAuditLogs().then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Audit Log</h1>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Entity</th>
              <th className="px-4 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-4 py-2">#{l.id}</td>
                <td className="px-4 py-2">{l.actor_id || '-'}</td>
                <td className="px-4 py-2">{l.action}</td>
                <td className="px-4 py-2">{l.entity_type}#{l.entity_id}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(l.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={5}>No audit logs.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
