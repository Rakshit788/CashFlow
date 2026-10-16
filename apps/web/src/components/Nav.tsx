'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Role, getRole, setRole } from '@/lib/api';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/exceptions', label: 'Exceptions' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/audit', label: 'Audit' },
];

const roles: Role[] = ['viewer', 'analyst', 'approver', 'admin'];

export function Nav() {
  const pathname = usePathname();
  const [role, setRoleState] = useState<Role>('viewer');

  useEffect(() => {
    setRoleState(getRole());
  }, []);

  function onChange(next: Role) {
    setRole(next);
    setRoleState(next);
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-indigo-600">
            CashFlow
          </Link>
          <nav className="flex gap-4">
            {links.map((l) => {
              const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`text-sm font-medium ${
                    active ? 'text-indigo-600' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Role
          <select
            value={role}
            onChange={(e) => onChange(e.target.value as Role)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
