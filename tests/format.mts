// Tester tekstformatering: **fet**, _kursiv_, __understreket__ til HTML for Outlook.
import assert from 'node:assert/strict';
import { formatLine, segsToHtml, stripFormatting, toggleWrap } from '../src/lib/format.ts';
let pass = 0;
const ok = (n: string) => { pass++; console.log(`  ✓ ${n}`); };
const html = (s: string) => segsToHtml(formatLine(s));

assert.equal(html('Vi kommer **tirsdag kl 8**.'), 'Vi kommer <b>tirsdag kl 8</b>.');
assert.equal(html('Dette er _viktig_ og __må__ leses.'), 'Dette er <i>viktig</i> og <u>må</u> leses.');
assert.equal(html('**Fet med _kursiv_ inni**'), '<b>Fet med </b><b><i>kursiv</i></b><b> inni</b>');
ok('Fet, kursiv og understreket blir riktig HTML, også inni hverandre');

assert.equal(html('Send til ola_nordmann@test.no eller snake_case_ord.'), 'Send til ola_nordmann@test.no eller snake_case_ord.');
assert.equal(html('Se https://example.com/a_b_c_d og **dette**'), 'Se <a href="https://example.com/a_b_c_d">https://example.com/a_b_c_d</a> og <b>dette</b>');
assert.equal(html('2 * 3 = 6 og ** alene'), '2 * 3 = 6 og ** alene');
assert.equal(html('**uten lukking'), '**uten lukking');
assert.equal(html('<script> **x** </script>'), '&lt;script&gt; <b>x</b> &lt;/script&gt;');
ok('E-postadresser, lenker, gangetegn og uavsluttede markører røres ikke; HTML escapes');

assert.equal(stripFormatting('Hei **Kari**,\n_snart_ __ferdig__'), 'Hei Kari,\nsnart ferdig');
ok('Markeringer fjernes for ren tekst (kopier, mailto)');

assert.deepEqual(toggleWrap('Hei Kari', 4, 8, '**'), { value: 'Hei **Kari**', start: 6, end: 10 });
assert.deepEqual(toggleWrap('Hei **Kari**', 6, 10, '**'), { value: 'Hei Kari', start: 4, end: 8 });
assert.deepEqual(toggleWrap('Hei Kari ', 4, 9, '_'), { value: 'Hei _Kari_ ', start: 5, end: 9 }, 'mellomrom i kanten tas ikke med');
assert.equal(toggleWrap('Hei ', 4, 4, '__').value, 'Hei ____');
ok('Knappene legger markør rundt markert tekst, og fjerner den ved nytt trykk');

console.log(`\n${pass} av 4 tester bestått`);
