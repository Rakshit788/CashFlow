'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Badge } from '@/components/Badge';

type Detail = Awaited<ReturnType<typeof api.getException>>['data'];

export default function ExceptionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const load = useCallback(() => {
    api.getException(id).then((r) => setDetail(r.data)).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const pollJob = useCallback(
    async (jobId: number) => {
      for (let i = 0; i < 60; i++) {
        const res = await api.getJob(jobId);
        setJobStatus(res.data.status);
        if (res.data.status === 'completed' || res.data.status === 'failed') return;
        await new Promise((r) => setTimeout(r, 1500));
      }
    },
    []
  );

  async function investigate() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.investigate(id);
      setJobStatus(res.data.job.status);
      await pollJob(res.data.job.id);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      await api.resolveException(id, notes);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: number, status: 'approved' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      await api.decideApproval(approvalId, status);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return <div className="text-slate-500">{error || 'Loading...'}</div>;
  }

  const latestInvestigation = detail.investigations[0];
  const openApprovals = detail.approvals.filter((a) => a.status === 'pending');

  return (
    <div>
      <Link href="/exceptions" className="text-sm text-indigo-600 hover:underline">&larr; Back to exceptions</Link>

      <div className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Exception #{detail.id}</h1>
        <div className="flex gap-2">
          <Badge value={detail.severity} />
          <Badge value={detail.status} />
        </div>
      </div>

      {error && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Exception</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Type" value={detail.type} />
            <Row label="Customer" value={`${detail.customer_name ?? ''} (${detail.customer_id})`} />
            <Row label="Invoice" value={detail.invoice_id ?? '-'} />
            <Row label="Payment" value={detail.payment_id ?? '-'} />
            <Row label="Amount delta" value={detail.amount_delta ?? '-'} />
            <Row label="Outstanding snapshot" value={detail.outstanding_balance_snapshot ?? '-'} />
            <Row label="Reason" value={detail.reason ?? '-'} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Actions</h2>
          <div className="flex flex-col gap-3">
            <button
              onClick={investigate}
              disabled={busy || detail.status === 'investigating'}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {detail.status === 'investigating' ? 'Investigating...' : 'Run AI Investigation'}
            </button>
            {jobStatus && <p className="text-sm text-slate-500">Job status: <Badge value={jobStatus} /></p>}

            <div className="border-t border-slate-100 pt-3">
              <label className="mb-1 block text-xs text-slate-500">Manual resolution notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mb-2 w-full rounded border border-slate-300 p-2 text-sm"
                rows={2}
              />
              <button
                onClick={resolve}
                disabled={busy || detail.status === 'resolved'}
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        </section>
      </div>

      {latestInvestigation && (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Latest Investigation</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Status" value={latestInvestigation.status} />
            <Row label="Requested by" value={latestInvestigation.requested_by ?? '-'} />
          </dl>

          {latestInvestigation.result && (
            <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
              <p><strong>Action:</strong> {latestInvestigation.result.action}</p>
              <p><strong>Confidence:</strong> {latestInvestigation.result.confidence}</p>
              <p className="mt-1"><strong>Rationale:</strong> {latestInvestigation.result.rationale}</p>
              {latestInvestigation.result.evidence_refs?.length > 0 && (
                <p className="mt-1 text-slate-500">
                  <strong>Evidence:</strong> {latestInvestigation.result.evidence_refs.join(', ')}
                </p>
              )}
            </div>
          )}

          {openApprovals.length > 0 && (
            <div className="mt-3 rounded border border-purple-200 bg-purple-50 p-3">
              <p className="mb-2 text-sm font-medium text-purple-800">Pending approval required</p>
              {openApprovals.map((a) => (
                <div key={a.id} className="flex gap-2">
                  <button onClick={() => decide(a.id, 'approved')} disabled={busy} className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50">Approve & Execute</button>
                  <button onClick={() => decide(a.id, 'rejected')} disabled={busy} className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(latestInvestigation.evidence) && latestInvestigation.evidence.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-slate-500">Evidence trail ({latestInvestigation.evidence.length} steps)</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {latestInvestigation.evidence.map((ev: any, i: number) => (
                  <li key={i} className="rounded bg-slate-50 p-2">
                    <strong>{ev.tool}</strong> {JSON.stringify(ev.args)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Invoices</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-1">#</th><th>Amount</th><th>Outstanding</th></tr></thead>
            <tbody>
              {detail.invoices.map((inv: any) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="py-1">{inv.invoice_number}</td>
                  <td>{inv.amount}</td>
                  <td>{inv.outstanding}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Payments</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Ref</th><th>Amount</th><th>Applied</th></tr></thead>
            <tbody>
              {detail.payments.map((p: any) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1">{p.payment_ref}</td>
                  <td>{p.amount}</td>
                  <td>{p.applied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
