// Test van het mailen. Er gaat niets naar buiten: we zetten een nepmailserver op
// en laten de app daarheen praten in plaats van naar Resend.
//
// Draaien:  npm test

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as maakSocket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const werkmap = mkdtempSync(join(tmpdir(), 'taakbeheer-mail-'));
let mislukt = 0;

const check = (naam, ok, extra = '') => {
  console.log((ok ? '  ok   ' : '  FOUT ') + naam + (ok ? '' : '  <-- ' + extra));
  if (!ok) mislukt++;
};

function vrijePoort() {
  return new Promise((klaar) => {
    const s = maakSocket();
    s.listen(0, () => { const { port } = s.address(); s.close(() => klaar(port)); });
  });
}

// ── Nepmailserver: onthoudt wat de app hem stuurt ────────────────────────
const postvak = [];
let volgendAntwoord = { status: 200, body: { id: 'nep-1' } };

const mailserver = createServer((req, res) => {
  let ruw = '';
  req.on('data', (d) => { ruw += d; });
  req.on('end', () => {
    postvak.push({ authorization: req.headers.authorization, body: JSON.parse(ruw || '{}') });
    res.writeHead(volgendAntwoord.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(volgendAntwoord.body));
  });
});

const mailPoort = await vrijePoort();
await new Promise((klaar) => mailserver.listen(mailPoort, klaar));

// ── De app zelf ──────────────────────────────────────────────────────────
const poort = await vrijePoort();
const BASIS = `http://127.0.0.1:${poort}/api`;

const app = spawn(process.execPath, [join(hier, '..', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(poort),
    DATABASE_PAD: join(werkmap, 'mail.db'),
    NODE_ENV: 'test',
    RESEND_API_KEY: 're_nep_sleutel',
    RESEND_API_URL: `http://127.0.0.1:${mailPoort}/emails`,
    MAIL_AFZENDER: 'Transafe <taken@transafe.nl>',
    APP_URL: 'https://taakbeheer-production.up.railway.app',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const uitvoer = [];
app.stdout.on('data', (d) => uitvoer.push(d.toString()));
app.stderr.on('data', (d) => uitvoer.push(d.toString()));

function opruimen() {
  app.kill();
  mailserver.close();
  rmSync(werkmap, { recursive: true, force: true });
}

for (let poging = 0; poging < 50; poging++) {
  try { await fetch(BASIS + '/setup-nodig'); break; } catch {
    if (poging === 49) { console.error(uitvoer.join('')); opruimen(); process.exit(1); }
    await new Promise((k) => setTimeout(k, 100));
  }
}

function client() {
  let cookie = '';
  return async (pad, opties = {}) => {
    const res = await fetch(BASIS + pad, {
      ...opties,
      headers: { ...(opties.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: opties.body ? JSON.stringify(opties.body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith('sessie=')) cookie = c.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

const rim = client();

try {
  await rim('/setup', { method: 'POST', body: { naam: 'Rim de Haan', email: 'rim@transafe.nl', wachtwoord: 'eenGoedWachtwoord' } });

  console.log('\n— Uitnodiging mailen —');
  check('app weet dat mail is ingesteld', (await rim('/ik')).data.mail === true);

  let r = await rim('/uitnodigingen', { method: 'POST', body: { email: 'anna@transafe.nl', rol: 'lid' } });
  check('uitnodiging gemaakt en gemaild', r.data.gemaild === true, JSON.stringify(r.data));
  check('precies één mail verstuurd', postvak.length === 1, 'aantal: ' + postvak.length);

  const mail = postvak[0];
  check('sleutel meegestuurd', mail.authorization === 'Bearer re_nep_sleutel');
  check('afzender klopt', mail.body.from === 'Transafe <taken@transafe.nl>');
  check('geadresseerde klopt', Array.isArray(mail.body.to) && mail.body.to[0] === 'anna@transafe.nl');
  check('onderwerp is duidelijk', /uitgenodigd/i.test(mail.body.subject), mail.body.subject);
  check('naam van de uitnodiger staat erin', mail.body.text.includes('Rim de Haan'));

  const link = `https://taakbeheer-production.up.railway.app/inloggen.html?uitnodiging=${r.data.token}`;
  check('link staat in de platte tekst', mail.body.text.includes(link));
  check('link staat ook in de html', mail.body.html.includes(link));
  check('html gebruikt het juiste adres, niet localhost', !mail.body.html.includes('127.0.0.1'));

  // De link uit de mail moet ook echt werken.
  const anna = client();
  check('de gemailde link is geldig',
    (await anna('/uitnodiging/' + r.data.token)).data.email === 'anna@transafe.nl');
  check('registreren via die link lukt',
    (await anna('/registreren', { method: 'POST', body: { token: r.data.token, naam: 'Anna Jansen', wachtwoord: 'AnnaHaarWachtwoord' } })).status === 200);

  console.log('\n— Herstellink mailen —');
  const annaId = (await rim('/gebruikers')).data.find((g) => g.email === 'anna@transafe.nl').id;
  postvak.length = 0;

  r = await rim(`/gebruikers/${annaId}/herstel`, { method: 'POST' });
  check('herstelmail verstuurd', r.data.gemaild === true, JSON.stringify(r.data));
  check('naar het juiste adres', postvak[0]?.body.to[0] === 'anna@transafe.nl');
  check('met haar naam erin', postvak[0]?.body.text.includes('Anna Jansen'));
  check('en de werkende herstellink',
    postvak[0]?.body.text.includes(`?herstel=${r.data.token}`));

  console.log('\n— Als de mailserver stuk is —');
  volgendAntwoord = { status: 422, body: { message: 'Domein is niet geverifieerd.' } };
  postvak.length = 0;

  r = await rim('/uitnodigingen', { method: 'POST', body: { email: 'bram@transafe.nl', rol: 'lid' } });
  check('uitnodiging wordt tóch aangemaakt', r.status === 200 && !!r.data.token, JSON.stringify(r.data));
  check('maar gemaild staat op false', r.data.gemaild === false);
  check('met de reden erbij', /geverifieerd/i.test(r.data.mailfout ?? ''), r.data.mailfout);

  const bram = client();
  check('de link werkt gewoon, ook zonder mail',
    (await bram('/uitnodiging/' + r.data.token)).data.email === 'bram@transafe.nl');
} catch (fout) {
  console.error('\nDe test liep vast:', fout);
  mislukt++;
}

opruimen();
console.log(mislukt === 0 ? '\nMailen werkt.\n' : `\n${mislukt} controle(s) MISLUKT.\n`);
process.exit(mislukt === 0 ? 0 : 1);
