import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Icon } from './ui';
import { cx, fmtDateTime } from '../lib/util';

const RESULT_TEXT: Record<string, [string, 'success' | 'danger' | 'neutral']> = {
  tilkoblet: ['E-post er koblet til. Agentene leser innboksen i skyggemodus.', 'success'],
  avbrutt: ['Tilkoblingen ble avbrutt. Ingenting ble endret.', 'neutral'],
  'feil-konto': ['Feil Microsoft-konto. Logg inn med e-postadressen som skal kobles til.', 'danger'],
  'feil-organisasjon': ['Kontoen tilhører en annen Microsoft-organisasjon enn Uvaag Elektro.', 'danger'],
  ugyldig: ['Tilkoblingen var utløpt eller ugyldig. Prøv igjen.', 'danger'],
  feil: ['Microsoft svarte med en feil. Prøv igjen, eller si fra til Tech Haus.', 'danger'],
};

/** Viser resultatet etter retur fra Microsoft (?microsoft=…) og fjerner parameteren fra adressen. */
export function useMicrosoftReturn() {
  const { actions } = useStore();
  useEffect(() => {
    const u = new URL(window.location.href);
    const r = u.searchParams.get('microsoft');
    if (!r) return;
    const [text, tone] = RESULT_TEXT[r] ?? RESULT_TEXT.feil;
    actions.toast(text, tone);
    u.searchParams.delete('microsoft');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    void actions.refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Stripe under toppmenyen i produksjon. */
export function MailBanner({ canConnect }: { canConnect: boolean }) {
  const { state, actions } = useStore();
  const m = state.mail;
  const pad = { paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' };
  if (!state.loaded || !m) return null;
  if (m.connected) {
    if (m.sending_enabled) return null;
    return <div className="border-t border-line bg-sunk py-1 text-center text-[11px] font-semibold text-muted" style={pad}>Skyggemodus: agentene leser og foreslår svar. Ingenting sendes herfra. Svar fra Outlook som vanlig.</div>;
  }
  const reconnect = m.status === 'reconnect_required';
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-warn/30 bg-warn-soft py-1.5 text-center text-[12px] font-semibold text-warn" style={pad}>
      <span>{reconnect ? 'Tilkoblingen til Microsoft 365 må fornyes. Agentene leser ikke e-post nå.' : !m.configured ? 'E-posttilkoblingen er ikke ferdig satt opp på serveren ennå.' : `${m.mailbox} er ikke koblet til ennå.`}</span>
      {m.configured && canConnect && <button className="rounded-md bg-warn px-2.5 py-0.5 text-[12px] font-bold text-surface" onClick={() => void actions.connectMail()}>{reconnect ? 'Koble til på nytt' : 'Koble til Microsoft 365'}</button>}
      {m.configured && !canConnect && <span className="font-normal">Espen kobler til fra sin konto.</span>}
    </div>
  );
}

/** Kort under Innstillinger. */
export function MailConnectionCard({ isSuperadmin, canConnect }: { isSuperadmin: boolean; canConnect: boolean }) {
  const { state, actions } = useStore();
  const m = state.mail;
  const [confirm, setConfirm] = useState<null | 'disconnect' | 'enable'>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); setConfirm(null); } };

  const tone = !m ? 'neutral' : m.connected ? 'ok' : m.status === 'reconnect_required' ? 'bad' : 'warn';
  return (
    <section className="card p-5">
      <h2 className="mb-1 font-display text-base font-semibold">E-posttilkobling</h2>
      <p className="mb-3 text-[13px] text-muted">Koblingen skjer med Microsofts egen innlogging. Agentkontoret ser aldri passordet, og tilgangen kan trekkes tilbake når som helst.</p>
      {!m ? <p className="text-[13px] text-muted">Henter status …</p> : (
        <>
          <div className={cx('mb-3 flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px]',
            tone === 'ok' ? 'border-ok/40 bg-ok-soft' : tone === 'bad' ? 'border-bad/40 bg-bad-soft' : 'border-warn/40 bg-warn-soft')}>
            <Icon name={m.connected ? 'check' : 'alert'} className={cx('mt-0.5 h-5 w-5 shrink-0', tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-warn')} />
            <div className="min-w-0">
              <p><b>{m.connected ? 'Tilkoblet' : m.status === 'reconnect_required' ? 'Må kobles til på nytt' : 'Ikke tilkoblet'}</b> · {m.mailbox}</p>
              {m.connected && <p className="text-muted">{m.sending_enabled ? 'Sending er på. Alle e-poster krever fortsatt godkjenning.' : 'Skyggemodus: agentene leser og foreslår. Ingenting sendes herfra.'}</p>}
              {m.last_sync_at && <p className="text-muted">Sist sjekket {fmtDateTime(m.last_sync_at)}{m.last_run && m.last_run.ok ? ` · ${m.last_run.fetched} nye e-poster, ${m.last_run.new_cases} nye saker` : ''}</p>}
              {m.last_run && !m.last_run.ok && <p className="text-bad">Siste synkronisering feilet: {m.last_run.error}</p>}
              {m.last_error && !m.connected && <p className="text-bad">{m.last_error}</p>}
              {!m.configured && <p className="text-muted">Serveren mangler Microsoft-oppsettet. Tech Haus fikser dette.</p>}
              {!m.ai_configured && <p className="text-muted">AI-nøkkel mangler. Agentene sorterer med enkle regler til den er lagt inn.</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!m.connected && m.configured && canConnect && <button className="btn btn-primary" onClick={() => void actions.connectMail()}><Icon name="mail" />{m.status === 'reconnect_required' ? 'Koble til på nytt' : 'Koble til Microsoft 365'}</button>}
            {!m.connected && m.configured && !canConnect && <p className="text-[13px] text-muted">Tilkoblingen gjøres av Espen, innlogget med {m.mailbox}.</p>}
            {m.connected && isSuperadmin && <button className="btn btn-ghost" disabled={busy} onClick={() => void run(actions.syncNow)}><Icon name="refresh" />Sjekk innboksen nå</button>}
            {m.connected && isSuperadmin && (m.sending_enabled
              ? <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => actions.setSending(false))}><Icon name="lock" />Slå på skyggemodus</button>
              : <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirm('enable')}><Icon name="send" />Slå på sending</button>)}
            {m.connected && <button className="btn btn-danger" disabled={busy} onClick={() => setConfirm('disconnect')}><Icon name="x" />Koble fra</button>}
          </div>

          {confirm && (
            <div className="mt-3 flex flex-col gap-2 rounded-lg bg-sunk p-3 text-[13px]">
              {confirm === 'enable'
                ? <p>Slå på sending? Espen kan da sende godkjente svar direkte fra Agentkontoret. Ingenting sendes uten at han trykker «Godkjenn og send».</p>
                : <p>Koble fra e-posten? Agentene slutter å lese innboksen. Saker som allerede er hentet blir liggende.</p>}
              <div className="flex gap-2">
                <button className={confirm === 'enable' ? 'btn btn-primary' : 'btn btn-danger'} disabled={busy}
                  onClick={() => void run(confirm === 'enable' ? () => actions.setSending(true) : actions.disconnectMail)}>{confirm === 'enable' ? 'Ja, slå på sending' : 'Ja, koble fra'}</button>
                <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Avbryt</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
