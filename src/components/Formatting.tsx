import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { formatLine, toggleWrap } from '../lib/format';
import { cx } from '../lib/util';

/** Viser tekst med **fet**, _kursiv_, __understreket__ og klikkbare lenker – slik mottakeren ser den. */
export function FormattedText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  return (
    <div className={cx('whitespace-pre-wrap', className)}>
      {lines.map((line, n) => (
        <span key={n}>
          {formatLine(line).map((s, k) => {
            let el: ReactNode = s.href
              ? <a href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand underline decoration-brand/30 underline-offset-2">{s.text}</a>
              : s.text;
            if (s.u) el = <u>{el}</u>;
            if (s.i) el = <i>{el}</i>;
            if (s.b) el = <b>{el}</b>;
            return <span key={k}>{el}</span>;
          })}
          {n < lines.length - 1 && '\n'}
        </span>
      ))}
    </div>
  );
}

type Mark = '**' | '_' | '__';

/** Bruker markør på markert tekst i tekstfeltet og beholder markeringen. */
function useWrap(ref: RefObject<HTMLTextAreaElement | null>, value: string, onChange: (v: string) => void) {
  return (m: Mark) => {
    const el = ref.current;
    if (!el) return;
    const r = toggleWrap(value, el.selectionStart, el.selectionEnd, m);
    onChange(r.value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
  };
}

/** Tastatursnarveier i tekstfeltet: Ctrl/Cmd + B, I, U. */
export function useFormatShortcuts(ref: RefObject<HTMLTextAreaElement | null>, value: string, onChange: (v: string) => void) {
  const wrap = useWrap(ref, value, onChange);
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const m: Mark | null = k === 'b' ? '**' : k === 'i' ? '_' : k === 'u' ? '__' : null;
    if (m) { e.preventDefault(); wrap(m); }
  };
}

/** Knappene F, K og U over tekstfeltet, og «Forhåndsvis». */
export function FormatToolbar({ textareaRef, value, onChange, disabled, preview, onPreview }: {
  textareaRef: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void; disabled?: boolean; preview: boolean; onPreview: (v: boolean) => void;
}) {
  const wrap = useWrap(textareaRef, value, onChange);
  const btn = 'flex h-7 min-w-7 items-center justify-center rounded-md border border-line bg-surface px-1.5 text-[13px] text-ink hover:bg-sunk disabled:opacity-40';
  // onMouseDown hindrer at markeringen i tekstfeltet forsvinner når knappen trykkes.
  return (
    <div className="flex items-center gap-1" role="toolbar" aria-label="Formatering">
      <button type="button" className={cx(btn, 'font-bold')} disabled={disabled || preview} title="Fet (Ctrl/Cmd + B)" aria-label="Fet" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}>F</button>
      <button type="button" className={cx(btn, 'italic font-serif')} disabled={disabled || preview} title="Kursiv (Ctrl/Cmd + I)" aria-label="Kursiv" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('_')}>K</button>
      <button type="button" className={cx(btn, 'underline')} disabled={disabled || preview} title="Understreket (Ctrl/Cmd + U)" aria-label="Understreket" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('__')}>U</button>
      <button type="button" className={cx('ml-1 rounded-md px-2 py-1 text-[11px] font-semibold', preview ? 'bg-brand text-surface' : 'text-muted hover:text-ink')} onClick={() => onPreview(!preview)}>
        {preview ? 'Rediger' : 'Forhåndsvis'}
      </button>
    </div>
  );
}

/** Tekstfelt med formateringsknapper og forhåndsvisning. */
export function FormattedEditor({ id, value, onChange, disabled, className, minHeight = 'min-h-[200px]', extra }: {
  id: string; value: string; onChange: (v: string) => void; disabled?: boolean; className?: string; minHeight?: string; extra?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const onKey = useFormatShortcuts(ref, value, onChange);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!disabled ? <FormatToolbar textareaRef={ref} value={value} onChange={onChange} disabled={disabled} preview={preview} onPreview={setPreview} /> : <span />}
        {extra}
      </div>
      {preview
        ? <FormattedText text={value} className={cx('field text-[13px] leading-relaxed', minHeight)} />
        : <textarea ref={ref} id={id} className={cx('field font-sans leading-relaxed', minHeight, className)} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} disabled={disabled} />}
    </div>
  );
}
