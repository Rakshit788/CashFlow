'use client';

import { useEffect, useState } from 'react';
import { api, Job } from '@/lib/api';
import { Badge } from '@/components/Badge';

export default function JobsPage() {
  const [rows, setRows] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listJobs().then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Jobs</h1>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Attempts</th>
              <th className="px-4 py-2">Error</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="border-t border-slate-100">
                <td className="px-4 py-2">#{j.id}</td>
                <td className="px-4 py-2">{j.type}</td>
                <td className="px-4 py-2"><Badge value={j.status} /></td>
                <td className="px-4 py-2">{j.attempts}/{j.max_attempts}</td>
                <td className="px-4 py-2 text-xs text-red-600">{j.error || '-'}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(j.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={6}>No jobs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
