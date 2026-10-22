import React from 'react';
import type { AgentConfig, AgentStatus, CaseStatus, Priority } from '../domain/types';
import { PRIORITY_META, STATUS_META } from '../config/tenant';
import { cx } from '../lib/util';

/** Illustrert portrett. Tegnet, ikke foto: agentene skal oppleves personlige, men tydelig digitale. */
export function Portrait({ p, size = 56, ring, aiBadge = true }: { p: AgentConfig['portrait']; size?: number; ring?: string; aiBadge?: boolean }) {
  const hair = p.hair;
  const hairBack: Record<string, React.ReactNode> = {
    long: <path d="M18 36c0-14 7-22 18-22s18 8 18 22v22H18z" fill={hair} />,
    bob: <path d="M19 34c0-12 7-19 17-19s17 7 17 19v12c-3 1-6 1-8 0H27c-3 1-6 1-8 0z" fill={hair} />,
    curly: <circle cx="36" cy="30" r="17" fill={hair} />,
    bun: <circle cx="36" cy="12" r="6" fill={hair} />,
    short: null,
    buzz: null,
  };
  const hairFront: Record<string, React.ReactNode> = {
    long: <path d="M23 30c3-8 9-11 13-11s11 2 13 11c-6-2-12-5-15-9-2 4-6 7-11 9z" fill={hair} />,
    bob: <path d="M22 31c2-9 8-13 14-13s12 4 14 13c-7 0-13-3-16-8-2 4-6 7-12 8z" fill={hair} />,
    curly: <path d="M22 30c0-8 6-13 14-13s14 5 14 13c-3-3-6-4-9-4-3 0-5 2-5 2s-2-2-5-2-6 1-9 4z" fill={hair} />,
    bun: <path d="M23 30c2-8 7-12 13-12s11 4 13 12c-5-2-10-5-13-8-3 3-8 6-13 8z" fill={hair} />,
    short: <path d="M22 31c0-9 6-14 14-14s14 5 14 13c-4-4-9-6-15-6-5 0-9 2-13 7z" fill={hair} />,
    buzz: <path d="M23 29c1-7 6-11 13-11s12 4 13 11c-4-3-8-4-13-4s-9 1-13 4z" fill={hair} opacity=".85" />,
  };
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 72 72" width={size} height={size} className={cx('rounded-full', ring)} aria-hidden="true">
        <circle cx="36" cy="36" r="36" fill="var(--brand-soft)" />
        <clipPath id={`pc${size}${p.shirt.slice(1)}`}><circle cx="36" cy="36" r="36" /></clipPath>
        <g clipPath={`url(#pc${size}${p.shirt.slice(1)})`}>
          {hairBack[p.hairStyle]}
          <path d="M12 72c2-13 12-20 24-20s22 7 24 20z" fill={p.shirt} />
          <path d="M31 46h10v8c-2 2-8 2-10 0z" fill={p.skin} />
          <path d="M31 52c2 2 8 2 10 0l2 3c-4 3-10 3-14 0z" fill="#000" opacity=".08" />
          <ellipse cx="36" cy="33" rx="13" ry="15" fill={p.skin} />
          {p.beard && <path d="M24 35c1 10 6 14 12 14s11-4 12-14c-2 4-6 6-12 6s-10-2-12-6z" fill={hair} opacity=".9" />}
          {hairFront[p.hairStyle]}
          <circle cx="31" cy="34" r="1.6" fill="#1b1b1b" />
          <circle cx="41" cy="34" r="1.6" fill="#1b1b1b" />
          <path d="M32 41c2.2 2 5.8 2 8 0" stroke="#7a3b2b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          {p.glasses && (
            <g stroke="#1b1b1b" strokeWidth="1.3" fill="none"><circle cx="31" cy="34" r="4" /><circle cx="41" cy="34" r="4" /><path d="M35 34h2" /></g>
          )}
        </g>
      </svg>
      {aiBadge && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-md bg-ink px-1 text-[9px] font-bold leading-[14px] text-surface ring-2 ring-surface" title="Digital AI-medarbeider">AI</span>
      )}
    </span>
  );
}

export const AGENT_STATUS: Record<AgentStatus, { label: string; tone: string; dot: string }> = {
  working: { label: 'Arbeider', tone: 'bg-violet-soft text-violet', dot: 'bg-violet pulse' },
  waiting_owner: { label: 'Venter på Espen', tone: 'bg-accent-soft text-accent-ink', dot: 'bg-accent' },
  waiting_customer: { label: 'Venter på kunde', tone: 'bg-sunk text-muted', dot: 'bg-faint' },
  idle: { label: 'Ledig', tone: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  needs_help: { label: 'Trenger hjelp', tone: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  error: { label: 'Feil', tone: 'bg-bad-soft text-bad', dot: 'bg-bad' },
};

export function AgentStatusPill({ status, owner }: { status: AgentStatus; owner?: string }) {
  const m = AGENT_STATUS[status];
  const label = owner && status === 'waiting_owner' ? `Venter på ${owner}` : m.label;
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', m.tone)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', m.dot)} />
      {label}
    </span>
  );
}

export function CaseStatusBadge({ status, short }: { status: CaseStatus; short?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', m.tone)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', m.dot)} />
      {short ? m.short : m.label}
    </span>
  );
}

export function PriorityMark({ p }: { p: Priority }) {
  const m = PRIORITY_META[p];
  const bars = { low: 1, normal: 2, high: 3, urgent: 4 }[p];
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-semibold', m.tone)} title={`Prioritet: ${m.label}`}>
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <span key={i} className={cx('w-[3px] rounded-sm', i <= bars ? 'bg-current' : 'bg-line')} style={{ height: 3 + i * 2 }} />)}
      </span>
      {m.label}
    </span>
  );
}

export function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const paths: Record<string, string> = {
    office: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6',
    cases: 'M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z',
    inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5',
    log: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    flag: 'M5 21V4h11l-1 4 4 4H5',
    check: 'M5 12l5 5L20 7',
    x: 'M6 6l12 12M18 6L6 18',
    refresh: 'M4 4v6h6M20 20v-6h-6M5 15a8 8 0 0013.5 3M19 9A8 8 0 005.5 6',
    pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    paperclip: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
    image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01',
    file: 'M6 2h9l5 5v15H6zM14 2v6h6',
    list: 'M4 6h16M4 12h16M4 18h16',
    kanban: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
    phone: 'M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
    pin: 'M12 21s-7-6-7-12a7 7 0 0114 0c0 6-7 12-7 12zM12 11a2 2 0 100-4 2 2 0 000 4z',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
    send: 'M4 12l16-8-6 16-2-7z',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    back: 'M19 12H5M11 6l-6 6 6 6',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
    plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0zM12 18v4',
    wrench: 'M14.7 6.3a4 4 0 005 5L21 13l-8 8-3-3 1.3-1.3a4 4 0 00-5-5L3 10l3-3 2 2 1.3-1.3a4 4 0 005-5z',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    chat: 'M4 5h16v11H8l-4 4z',
    help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.check} />
    </svg>
  );
}

export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: React.ReactNode; title: string; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx('slide-in card max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-b-[14px]', wide ? 'max-w-5xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Lukk"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">{text}</div>;
}
