// Tester uthenting av signatur fra Outlook-e-post og fjerning av dobbel hilsen.
import assert from 'node:assert/strict';
import { extractSignature, cidsIn, ownPart, previewHtml, sanitizeHtml, stripClosing } from '../server/signature.ts';

let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };

// 1. Outlook for Windows (_MailAutoSig), med logo og sitert tråd under
const desktop = `<html><head><style>p.MsoNormal{margin:0}</style></head><body lang=NO-BOK><div class=WordSection1>
<p class=MsoNormal>Hei Thomas,<o:p></o:p></p><p class=MsoNormal>Vi kommer tirsdag.<o:p></o:p></p>
<p class=MsoNormal><a name="_MailAutoSig"><span style='font-size:9pt'>Med vennlig hilsen/Regards</span></a><o:p></o:p></p>
<p class=MsoNormal><b>Espen Uvaag Halvorsen</b><br>Daglig leder/Faglig ansvarlig</p>
<p class=MsoNormal><img width=120 src="cid:image001.png@01DC4A.5E8F" alt="Uvaag Elektro"></p>
<p class=MsoNormal onclick="alert(1)">M: +47 458 70 500</p>
<div style='border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm'><p class=MsoNormal><b>From:</b> Thomas Aar</p></div>
<p>Sitert tekst</p></div></body></html>`;
const sig = extractSignature(desktop)!;
assert.ok(sig.startsWith('<p class=MsoNormal><a name="_MailAutoSig">'), sig.slice(0, 60));
assert.ok(sig.includes('Espen Uvaag Halvorsen') && sig.includes('458 70 500'));
assert.ok(!sig.includes('Vi kommer tirsdag'), 'eierens tekst er ikke med');
assert.ok(!sig.includes('Thomas Aar') && !sig.includes('Sitert'), 'sitert tråd er ikke med');
assert.ok(!sig.includes('onclick'), 'hendelser fjernet');
assert.deepEqual(cidsIn(sig), ['image001.png@01DC4A.5E8F']);
ok('Outlook for Windows: signatur med logo hentes, uten egen tekst og sitert tråd');

// 2. Outlook på nett / ny Outlook (id="Signature")
const owa = `<html><body><div>Hei, takk!</div><div id="Signature"><p>Mvh<br>Espen</p><img src="cid:logo"></div><div id="appendonsend"></div><hr><div id="divRplyFwdMsg">Fra: x</div></body></html>`;
assert.equal(extractSignature(owa), '<div id="Signature"><p>Mvh<br>Espen</p><img src="cid:logo"></div><div id="appendonsend"></div>'.replace('<div id="appendonsend"></div>', ''));
ok('Outlook på nett: signatur hentes');

// 3. Ingen merket signatur (f.eks. sendt fra iPhone): ingenting hentes
assert.equal(extractSignature('<html><body><div>Ok!</div><div>Sendt fra min iPhone</div></body></html>'), null);
assert.equal(ownPart('<body>A<blockquote>B</blockquote></body>'), 'A');
assert.ok(!sanitizeHtml('<p>x</p><script>alert(1)</script><a href="javascript:alert(1)">y</a>').match(/script|javascript/i));
ok('Ingen signatur når den ikke er merket; skadelig innhold fjernes');

// 4. Forhåndsvisning bytter cid mot bildet
assert.equal(previewHtml({ html: '<img src="cid:a1">', images: [{ contentId: 'a1', name: 'l.png', contentType: 'image/png', base64: 'QUJD' }], fetchedAt: '', sourceMessageId: '' }), '<img src="data:image/png;base64,QUJD">');
ok('Forhåndsvisning viser logoen');

// 5. Hilsen fjernes bare når resten er signatur
const known = ['Med vennlig hilsen\nEspen Uvaag\nUvaag Elektro AS', 'Espen Uvaag', 'Espen', 'Uvaag Elektro AS'];
assert.equal(stripClosing('Hei,\n\nVi kommer tirsdag.\n\nMed vennlig hilsen\nEspen Uvaag\nUvaag Elektro AS', known), 'Hei,\n\nVi kommer tirsdag.');
assert.equal(stripClosing('Hei,\n\nOk.\n\nMvh Espen', known), 'Hei,\n\nOk.');
assert.equal(stripClosing('Hei,\n\nOk.\n\nHilsen Espen\nM: 458 70 500', known), 'Hei,\n\nOk.');
const ps = 'Hei,\n\nOk.\n\nHilsen Espen\nPS: Ring gjerne.';
assert.equal(stripClosing(ps, known), ps, 'PS beholdes');
assert.equal(stripClosing('Hei,\n\nVi kommer tirsdag.', known), 'Hei,\n\nVi kommer tirsdag.');
ok('Hilsen og tekstsignatur fjernes, men aldri et PS eller vanlig tekst');

console.log(`\n${pass} av 5 tester bestått`);
