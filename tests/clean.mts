// Tester rensing av e-posttekst for visning og AI.
import assert from 'node:assert/strict';
import { cleanMail, linkify, previewText } from '../src/lib/cleanMail.ts';

let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };

// 1. INKY-banner (faktisk eksempel fra Uvaag Elektro, anonymisert lenke)
const inky = `Hei. Har ei som skal pusse opp badet sitt. I en 4mans bolig 2 etg. Espen: legg inn spottere som opsjon. Og lys i nisje. David: er 120 innredning i dag ligger også rør rør system , henne ønsker også ba
[cid:inky-injection-inliner-6f42d488d348cfcd86bff9497caf9f6a]
External (jonas@nrbygg.no<mailto:jonas@nrbygg.no>)
[cid:inky-injection-inliner-d709916e795d3a3dc330ccb23ff5fc3f]
  Report This Email<https://protection.eu.inkyphishfence.com/report?id=dXZhYWctZWxla3RyaXByb2plY3RzL2JlbHRvLWVtYWlsLWZpbHRlci9hdXRvLWZpbHRlci9t>  FAQ<https://www.inky.com/banner-faq>

Hei.

Har ei som skal pusse opp badet sitt. I en 4mans bolig 2 etg.

Espen: legg inn spottere som opsjon. Og lys i nisje.

David: er 120 innredning i dag ligger også rør rør system , henne ønsker også bare ett sluk.



 [IMG_6698.jpeg] [IMG_6697.jpeg] [IMG_6696.jpeg] [IMG_6695.jpeg]



Med vennlig hilsen

Jonas Halvorsen`;
const c1 = cleanMail(inky);
assert.ok(c1.text.startsWith('Hei.\n\nHar ei som skal pusse opp badet'), c1.text.slice(0, 80));
for (const junk of ['cid:', 'inky', 'Report This Email', 'External (', 'IMG_6698', 'FAQ<']) assert.ok(!c1.text.includes(junk), `fjernet: ${junk}`);
assert.ok(c1.text.includes('bare ett sluk'));
assert.ok(c1.text.endsWith('Med vennlig hilsen\n\nJonas Halvorsen'));
assert.ok(!/\n{3,}/.test(c1.text), 'ingen store tomrom');
ok('INKY-banner, bildeplassholdere og tomrom fjernes. Selve teksten er uendret.');

// 2. FAQ på egen linje, og linje-variant
const inky2 = `Forhåndsvisning\n[cid:inky-x]\nReport This Email<https://protection.eu.inkyphishfence.com/report?id=abc>\nFAQ<https://www.inky.com/banner-faq>\nHei Espen,\nKan dere se på sikringsskapet?`;
assert.equal(cleanMail(inky2).text, 'Hei Espen,\nKan dere se på sikringsskapet?');
ok('INKY-banner også når FAQ står på egen linje');

// 3. Outlook «CAUTION» og «Du mottar ikke ofte e-post fra»
const caution = `CAUTION: This email originated from outside of the organization. Do not click links.\nDu mottar ikke ofte e-post fra kunde@test.no. Finn ut hvorfor dette er viktig<https://aka.ms/LearnAboutSenderIdentification>\n\nHei, trenger elektriker.`;
assert.equal(cleanMail(caution).text, 'Hei, trenger elektriker.');
ok('Microsoft-varsler om ekstern avsender fjernes');

// 4. Sitert historikk skilles ut (Outlook og iPhone/Gmail)
const outlook = `Takk, onsdag passer fint.\n\nHilsen Kari\n\nFra: Espen Uvaag <espen@uvaagelektro.no>\nSendt: tirsdag 27. oktober 2026 14:02\nTil: Kari <kari@test.no>\nEmne: SV: Elbillader\n\nHei Kari, passer onsdag?`;
const c4 = cleanMail(outlook);
assert.equal(c4.text, 'Takk, onsdag passer fint.\n\nHilsen Kari');
assert.match(c4.quoted, /^Fra: Espen Uvaag/);
const iphone = `Ja, 63A.\n\nSendt fra min iPhone\n\n> Den 27. okt. 2026 kl. 14:02 skrev Espen Uvaag <espen@uvaagelektro.no>:\n>\n> Hei, hvor stor hovedsikring?`;
const c4b = cleanMail(iphone);
assert.equal(c4b.text, 'Ja, 63A.'); assert.ok(!c4b.text.includes('hovedsikring')); assert.ok(c4b.quoted.includes('hovedsikring'));
const gmail = `Ok!\n\nOn Tue, 27 Oct 2026 at 14:02, Espen Uvaag <espen@uvaagelektro.no> wrote:\n> Hei`;
assert.equal(cleanMail(gmail).text, 'Ok!');
ok('Sitert historikk fra Outlook, iPhone og Gmail skilles ut');

// 5. «Fra:» i vanlig tekst kuttes ikke
const notQuote = `Hei,\nFra: kl 08 til 16 er jeg hjemme.\nMvh Per`;
assert.equal(cleanMail(notQuote).text, notQuote);
ok('Vanlig tekst som starter med «Fra:» beholdes');

// 6. Lenker og e-postadresser
const links = `Se tegning her<https://www.dropbox.com/s/abc/tegning.pdf?dl=0> og ring meg.\nE-post: per@test.no<mailto:per@test.no>\nhttps://www.finn.no/realestate/homes/ad.html?finnkode=123456789`;
const c6 = cleanMail(links).text;
assert.ok(c6.startsWith('Se tegning her og ring meg.'));
assert.ok(c6.includes('E-post: per@test.no\n'));
const parts = linkify(c6);
const l = parts.find((p) => 'href' in p) as { href: string; label: string };
assert.equal(l.label, 'finn.no/…'); assert.match(l.href, /finnkode=123456789$/);
ok('«tekst<lenke>» blir tekst, mailto ryddes, lange lenker vises kort og klikkbart');

// 7. Hele e-posten er videresendt: vises, ikke tom
const fwd = `Fra: Kunde <k@test.no>\nSendt: i dag\nTil: Espen\nEmne: Lys\n\nHei, vi trenger lys.`;
assert.ok(cleanMail(fwd).text.includes('vi trenger lys'));
assert.equal(previewText(inky, 30), 'Hei. Har ei som skal pusse opp');
ok('Videresendt e-post vises; forhåndsvisning i lister er ren');

console.log(`\n${pass} av 7 tester bestått`);
