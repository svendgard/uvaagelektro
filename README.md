# Uvaag Elektro – Agentkontoret

Første utgave av Tech Haus' agentdashboard for håndverksbedrifter. Fem digitale medarbeidere (AIEmma, AIOliver, AINora, AIHenrik, AISofie) håndterer kundehenvendelser og oppdrag, mens eieren godkjenner alt som går ut.

```
npm install
npm run build        # produksjonsbygg uten eksempeldata (serveres av server/index.ts)
npm run build:demo   # prototype med fiktive data som én HTML-fil (DEMO=true)
npm start            # server: innlogging + frontend (krever DATABASE_URL)
npm run typecheck
npm test             # alle tester
npx tsx tests/auth.mts       # innlogging, roller, sperrer, invitasjoner
npx tsx tests/mfa.mts        # tofaktor
npx tsx tests/smoke.mts      # røyktest: e-post og godkjenning
npx tsx tests/projects.mts   # røyktest: oppdrag og prosjektkontroll
npx tsx tests/health.mts     # helserapportering mot Agent Dashboard
```

## Struktur

```
src/
  config/tenant.ts        Alt kundespesifikt: firma, eier, agentroller, oppdragstyper,
                          prismaler, prosessregler, e-postkonto, automatiseringsnivå
  domain/types.ts         Domenemodell (sak, tråd, utkast, revisjonslogg …)
  adapters/mail/          MailProvider-grensesnitt + SimulatedMailProvider
  adapters/ai/            AgentEngine + SimulatedAgentEngine, ProjectControl (AISofies regler)
  adapters/accounting/    AccountingProvider-grensesnitt + SimulatedTripletex
  data/seed.ts            14 fiktive saker, tråder, utkast og logg
  data/jobsSeed.ts        13 fiktive oppdrag for 3 montører + Espen, i alle faser
  state/store.tsx         Lokal demotilstand og alle handlinger (approveAndSend, regenerate …)
  state/jobs.ts           Oppdrag og prosjektkontroll (planlegg, start, ferdigmeld, kontroll, Tripletex)
  components/             UI: Agentkontor, saker (tavle/liste), saksdetalj, godkjenning,
                          innboks, logg, innstillinger
```

Ny kunde = ny `TenantConfig`. UI-koden endres ikke.

## Veien til produksjon

| Lag | Prototype | Produksjon |
|---|---|---|
| E-post | `SimulatedMailProvider` | `GraphMailProvider` (Microsoft Graph) eller `GmailMailProvider` (Gmail API), OAuth 2.0, webhook + delta-synk |
| AI | `SimulatedAgentEngine` (regler) | LLM-kall på server med strukturert output, faste systemregler, kundetekst merket som upålitelig |
| Tilstand | `store.tsx` i nettleseren | API + Postgres, bakgrunnsjobber (kø) for triage/utkast/oppfølging |
| Tilgang | Rollebytte i demo | Innlogging (Entra ID/Google), rollebasert tilgang per tenant |
| Tokens | – | Kryptert på server (KMS), aldri i nettleseren |
| Sending | Idempotensnøkkel i minnet | Unik nøkkel i database, utgående kø med retry, «sendt» kun etter bekreftelse |
| Vedlegg | Markert «skannet» | Virusskanning før visning, lagring i privat bøtte med kortlivede lenker |
| Personvern | Eksport/sletting per sak | Samme, pluss databehandleravtale, lagring i EU/EØS, slettefrister |

## Sikkerhetsregler (håndheves i store/adapters)

- Ingen agent kan sende e-post. Bare `approveAndSend` (krever rolle `owner`) sender.
- Melding vises som sendt først når leverandøren bekrefter.
- Samme idempotensnøkkel sendes aldri to ganger.
- Priser kommer kun fra `priceTemplates`. Tekniske vurderinger og el-sikkerhet markeres «krever din vurdering».
- Instruksjoner i kundetekst ignoreres og flagges (se sak UE-2026-0153).

## Prosjektkontroll (AISofie)

Hver akseptert sak blir et oppdrag: Ikke planlagt → Planlagt → Pågår → Ferdigmeldt → Kontrollert → Fakturagrunnlag i Tripletex.

- Montøren får jobben i chat (Slack/Teams i produksjon), trykker Start/Trenger hjelp/Ferdig og legger ved bilder, materiell og tillegg.
- Sofie kontrollerer med faste regler: bilder, timer mot Tripletex, materiell mot tilbud, tillegg avklart med kunden, el-dokumentasjon.
- Avvik kan løses fra saken: purre montør, be Nora avklare tillegg med kunden (e-post via godkjenning), registrere dokumentasjon.
- Espen godkjenner kontrollen, og fakturagrunnlaget sendes som ordre til Tripletex. Faktura lages i Tripletex.
- Henrik følger med: hjelpebehov, akseptert men ikke planlagt, kontrollert men ikke sendt, og foreslår å samle småjobber i samme område.

## Helserapportering til Agent Dashboard

`server/health/healthReporter.ts` rapporterer til Tech Haus' Agent Dashboard (`svendgard/agent-dashboard`, kontrakt i `RIFF-INTEGRATION.md`).

- Én overvåket agent per kunde: e-postsynkroniseringen (`monitoring.mailSyncAgentId` i kundeoppsettet).
- En leveranse er én fullført synkroniseringsrunde som er lagret i databasen, også runder uten ny e-post.
- Rapport sendes ved oppstart, periodisk (intervall fra `/api/v1/config`) og etter hver lagret runde.
- Konfigurasjon hentes ved oppstart og hvert 5. minutt. Siste gyldige beholdes ved feil.
- Retry (nettverk, 429, 5xx): maks 4 forsøk, samme `report_id` og identisk payload. 400/401/403/409/413/415 logges og gjentas ikke.
- Feil i rapporteringen stopper aldri synkroniseringen. Ingen persondata sendes.

Miljøvariabler (Render, bakgrunnsarbeideren):

| Variabel | Eksempel | Merknad |
|---|---|---|
| `AGENT_DASHBOARD_URL` | `https://agent-dashboard.onrender.com` | Uten `/api/v1` |
| `AGENT_DASHBOARD_API_KEY` | (fra Admin i dashboardet) | Hemmelig. Bare i Render. |
| `AGENT_DASHBOARD_SOURCE` | `agentkontoret` | Må være kilden nøkkelen er laget for |
| `MONITORING_ENABLED` | `true` | `false` slår av all rapportering |

Låsen mot overlapp er i minnet. Kjør bakgrunnsarbeideren som én instans, eller bytt til Postgres advisory lock ved flere instanser.

## Innlogging og tilgang

Produksjonsversjonen (`server/`) krever innlogging. Ingen data vises uten gyldig sesjon.

- Roller: **eier** (Espen) bruker Agentkontoret. **Superadministrator** (Tech Haus) ser alt og har Admin-fanen, men kan ikke sende e-post til kunder.
- Brukere opprettes av superadministrator med en engangslenke (gyldig 72 t). Personen velger passord selv (minst 12 tegn, scrypt).
- Første superadministrator opprettes ved oppstart fra `BOOTSTRAP_SUPERADMIN_EMAIL`. Engangslenken skrives til loggen i Render.
- Sesjon i httpOnly/Secure/SameSite=Lax-cookie. Utløper etter 7 dager, eller 24 t uten aktivitet.
- 5 feil innlogginger per e-post (30 per IP) på 15 minutter gir midlertidig sperre.
- CSRF-vern, CSP, HSTS og `noindex` på alle svar. Revisjonslogg og innloggingslogg i Admin.
- Superadministrator fjernes ved å deaktivere brukeren i Admin.
- Tofaktor (kode fra autentiseringsapp + 10 reservekoder) er bygget inn. Alle kan slå det på under Innstillinger. `MFA_REQUIRED_ROLES` styrer hvem som må: tom = valgfritt, `superadmin` eller `superadmin,owner` = påkrevd. Endringen virker umiddelbart, og brukere uten tofaktor må sette det opp ved neste klikk.
- Hemmeligheten krypteres med `MFA_ENCRYPTION_KEY` (32 byte, base64). Superadministrator kan nullstille tofaktor for andre i Admin.

Miljøvariabler for webtjenesten: `DATABASE_URL`, `NODE_ENV=production`, `TENANT_ID`, `BOOTSTRAP_SUPERADMIN_EMAIL`, `MFA_ENCRYPTION_KEY`, `MFA_REQUIRED_ROLES` (tom til vi skrur det på), valgfritt `APP_URL` (ellers `RENDER_EXTERNAL_URL`).
