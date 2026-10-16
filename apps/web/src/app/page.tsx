'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ExceptionRecord } from '@/lib/api';
import { Badge } from '@/components/Badge';

export default function DashboardPage() {
  const [rows, setRows] = useState<ExceptionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listExceptions({ limit: 100 })
      .then((res) => setRows(res.data))
      .catch((e) => setError(e.message));
  }, []);

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const cards = [
    { label: 'Total', value: rows.length, color: 'text-slate-900' },
    { label: 'Open', value: counts.open || 0, color: 'text-amber-600' },
    { label: 'Investigating', value: counts.investigating || 0, color: 'text-blue-600' },
    { label: 'Pending Approval', value: counts.pending_approval || 0, color: 'text-purple-600' },
    { label: 'Resolved', value: counts.resolved || 0, color: 'text-green-600' },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Cash Application Dashboard</h1>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className={`mt-1 text-2xl font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Recent Exceptions</h2>
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
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link className="text-indigo-600 hover:underline" href={`/exceptions/${r.id}`}>
                    #{r.id}
                  </Link>
                </td>
                <td className="px-4 py-2">{r.customer_name || `Customer ${r.customer_id}`}</td>
                <td className="px-4 py-2">{r.type}</td>
                <td className="px-4 py-2">
                  <Badge value={r.severity} />
                </td>
                <td className="px-4 py-2">
                  <Badge value={r.status} />
                </td>
                <td className="px-4 py-2">{r.amount_delta ?? '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={6}>
                  No exceptions yet. Run the seed and detection scripts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
