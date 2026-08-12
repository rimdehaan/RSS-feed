// Test van de hele achterkant. Start zelf een server op een vrije poort met een
// lege database, loopt alles na, en ruimt daarna op.
//
// Draaien:  npm test

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const werkmap = mkdtempSync(join(tmpdir(), 'taakbeheer-test-'));

let mislukt = 0;
let huidigeGroep = '';

function groep(naam) {
  huidigeGroep = naam;
  console.log('\n— ' + naam + ' —');
}

function check(naam, voorwaarde, extra = '') {
  console.log((voorwaarde ? '  ok   ' : '  FOUT ') + naam + (voorwaarde ? '' : '  <-- ' + extra));
  if (!voorwaarde) mislukt++;
}

/** Zoekt een poort die vrij is, zodat tests nooit op elkaar botsen. */
function vrijePoort() {
  return new Promise((klaar) => {
    const tijdelijk = createServer();
    tijdelijk.listen(0, () => {
      const { port } = tijdelijk.address();
      tijdelijk.close(() => klaar(port));
    });
  });
}

const poort = await vrijePoort();
const BASIS = `http://127.0.0.1:${poort}/api`;

const server = spawn(process.execPath, [join(hier, '..', 'server.js')], {
  env: { ...process.env, PORT: String(poort), DATABASE_PAD: join(werkmap, 'test.db'), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverUitvoer = [];
server.stdout.on('data', (d) => serverUitvoer.push(d.toString()));
server.stderr.on('data', (d) => serverUitvoer.push(d.toString()));

function opruimen() {
  server.kill();
  rmSync(werkmap, { recursive: true, force: true });
}

// Wacht tot de server antwoord geeft.
for (let poging = 0; poging < 50; poging++) {
  try {
    await fetch(BASIS + '/setup-nodig');
    break;
  } catch {
    if (poging === 49) {
      console.error('De server startte niet op.\n' + serverUitvoer.join(''));
      opruimen();
      process.exit(1);
    }
    await new Promise((k) => setTimeout(k, 100));
  }
}

/** Maakt een "browser": onthoudt zijn eigen sessiecookie. */
function client() {
  let cookie = '';
  return async (pad, opties = {}) => {
    const res = await fetch(BASIS + pad, {
      ...opties,
      headers: {
        ...(opties.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: opties.body ? JSON.stringify(opties.body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      if (c.startsWith('sessie=')) cookie = c.split(';')[0];
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

const rim = client();
const anna = client();
const anoniem = client();

try {
  // ── Eerste installatie ──────────────────────────────────────────────────
  groep('Eerste installatie');
  check('setup is nodig', (await anoniem('/setup-nodig')).data.nodig === true);

  let r = await rim('/setup', { method: 'POST', body: { naam: 'Rim', email: 'rim@transafe.nl', wachtwoord: 'kort' } });
  check('te kort wachtwoord geweigerd', r.status === 400);

  r = await rim('/setup', { method: 'POST', body: { naam: 'Rim de Haan', email: 'rim@transafe.nl', wachtwoord: 'eenGoedWachtwoord' } });
  check('eerste beheerder aangemaakt', r.status === 200, JSON.stringify(r.data));

  check('tweede setup geblokkeerd',
    (await anoniem('/setup', { method: 'POST', body: { naam: 'X', email: 'x@y.nl', wachtwoord: 'nogEenWachtwoord' } })).status === 403);
  check('meteen ingelogd als beheerder', (await rim('/ik')).data.gebruiker?.rol === 'beheerder');

  // ── Inloggen ────────────────────────────────────────────────────────────
  groep('Inloggen');
  check('zonder login geen toegang', (await anoniem('/borden')).status === 401);

  r = await anoniem('/inloggen', { method: 'POST', body: { email: 'rim@transafe.nl', wachtwoord: 'fout' } });
  check('verkeerd wachtwoord geweigerd', r.status === 401);
  check('onbekend adres geeft dezelfde melding',
    (await anoniem('/inloggen', { method: 'POST', body: { email: 'niemand@nergens.nl', wachtwoord: 'x' } })).data.fout === r.data.fout);

  // ── Uitnodigen ──────────────────────────────────────────────────────────
  groep('Uitnodigen');
  r = await rim('/uitnodigingen', { method: 'POST', body: { email: 'anna@transafe.nl', rol: 'lid' } });
  check('uitnodiging gemaakt', r.status === 200 && !!r.data.token);
  const uitnodiging = r.data.token;

  check('onzinlink afgewezen', (await anoniem('/uitnodiging/onzin')).status === 404);
  check('geldige link toont het adres', (await anoniem('/uitnodiging/' + uitnodiging)).data.email === 'anna@transafe.nl');

  check('Anna geregistreerd',
    (await anna('/registreren', { method: 'POST', body: { token: uitnodiging, naam: 'Anna Jansen', wachtwoord: 'AnnaHaarWachtwoord' } })).status === 200);
  check('Anna is lid, geen beheerder', (await anna('/ik')).data.gebruiker?.rol === 'lid');
  check('link is eenmalig',
    (await anoniem('/registreren', { method: 'POST', body: { token: uitnodiging, naam: 'Kopie', wachtwoord: 'nogEenWachtwoord' } })).status === 404);

  // ── Geen dubbele uitnodigingen ──────────────────────────────────────────
  groep('Dubbel uitnodigen');
  const eerste = await rim('/uitnodigingen', { method: 'POST', body: { email: 'bram@transafe.nl' } });
  check('eerste uitnodiging lukt', eerste.status === 200);

  r = await rim('/uitnodigingen', { method: 'POST', body: { email: 'bram@transafe.nl' } });
  check('tweede keer wordt geweigerd', r.status === 409, JSON.stringify(r.data));
  check('met een begrijpelijke melding', /al uitgenodigd/i.test(r.data.fout ?? ''), r.data.fout);
  check('en er komt geen tweede link bij',
    (await rim('/uitnodigingen')).data.filter((u) => u.email === 'bram@transafe.nl').length === 1);

  check('hoofdletters gelden als hetzelfde adres',
    (await rim('/uitnodigingen', { method: 'POST', body: { email: 'BRAM@transafe.nl' } })).status === 409);

  check('na intrekken mag het weer',
    (await rim('/uitnodigingen/' + eerste.data.token, { method: 'DELETE' })).status === 200 &&
    (await rim('/uitnodigingen', { method: 'POST', body: { email: 'bram@transafe.nl' } })).status === 200);

  check('iemand met een account krijgt een andere melding',
    /al een account/i.test((await rim('/uitnodigingen', { method: 'POST', body: { email: 'rim@transafe.nl' } })).data.fout ?? ''));

  const annaId = (await rim('/gebruikers')).data.find((g) => g.email === 'anna@transafe.nl').id;

  // ── Rechten ─────────────────────────────────────────────────────────────
  groep('Rechten');
  check('lid mag niet uitnodigen',
    (await anna('/uitnodigingen', { method: 'POST', body: { email: 'z@z.nl' } })).status === 403);
  check('laatste beheerder kan zichzelf niet degraderen',
    (await rim('/gebruikers/1', { method: 'PATCH', body: { rol: 'lid' } })).status === 400);

  // ── Borden en taken ─────────────────────────────────────────────────────
  groep('Borden en taken');
  const borden = (await rim('/borden')).data;
  check('standaardbord bestaat', borden.length === 1 && borden[0].naam === 'Takenbord');
  const bordId = borden[0].id;

  check('tweede bord aangemaakt', (await rim('/borden', { method: 'POST', body: { naam: 'Project Noord' } })).status === 200);

  r = await rim(`/borden/${bordId}/taken`, {
    method: 'POST',
    body: { opdracht: 'Keuring plannen', uitvoerend_id: annaId, deadline: '2026-09-01', omschrijving: 'Keurmeester bellen.' },
  });
  check('taak aangemaakt met uitvoerende', r.status === 200 && r.data.uitvoerend_naam === 'Anna Jansen', JSON.stringify(r.data));
  const taak1 = r.data.id;

  check('taak zonder naam geweigerd',
    (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: '   ' } })).status === 400);

  const taak2 = (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Rapport schrijven' } })).data.id;
  const taak3 = (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Offerte nakijken' } })).data.id;

  check('verzonnen status valt terug op Not Started',
    (await rim(`/taken/${taak2}`, { method: 'PATCH', body: { status: 'Verzonnen' } })).data.status === 'Not Started');
  check('rommelige datum wordt genegeerd',
    (await rim(`/taken/${taak2}`, { method: 'PATCH', body: { deadline: 'morgen' } })).data.deadline === null);

  // ── Historie ────────────────────────────────────────────────────────────
  groep('Historie');
  check('Anna mag de status wijzigen',
    (await anna(`/taken/${taak1}`, { method: 'PATCH', body: { status: 'Working on it' } })).data.status === 'Working on it');

  r = await rim('/taken/' + taak1);
  const statusRegel = r.data.historie.find((h) => h.veld === 'status');
  check('wijziging staat in de historie',
    statusRegel?.oude_waarde === 'Not Started' && statusRegel?.nieuwe_waarde === 'Working on it', JSON.stringify(r.data.historie));
  check('met de naam van wie het deed', statusRegel?.gebruiker_naam === 'Anna Jansen');
  check('aanmaken staat er ook in', r.data.historie.some((h) => h.veld === 'aangemaakt'));

  await rim(`/taken/${taak1}`, { method: 'PATCH', body: { opdracht: 'Keuring plannen' } });
  check('onveranderd veld geeft geen regel',
    (await rim('/taken/' + taak1)).data.historie.filter((h) => h.veld === 'opdracht').length === 0);

  // ── Opmerkingen ─────────────────────────────────────────────────────────
  groep('Opmerkingen');
  r = await anna(`/taken/${taak1}/opmerkingen`, { method: 'POST', body: { tekst: 'Keurmeester gebeld.' } });
  check('opmerking geplaatst', r.status === 200 && r.data.gebruiker_naam === 'Anna Jansen');
  const opmerkingId = r.data.id;

  check('lege opmerking geweigerd',
    (await anna(`/taken/${taak1}/opmerkingen`, { method: 'POST', body: { tekst: '  ' } })).status === 400);

  r = await rim('/taken/' + taak1);
  check('collega ziet de opmerking', r.data.opmerkingen.length === 1);
  check('de telling klopt', r.data.aantal_opmerkingen === 1);

  check('je verwijdert niet andermans opmerking',
    (await client()('/opmerkingen/' + opmerkingId, { method: 'DELETE' })).status === 401);

  // ── Kanban ──────────────────────────────────────────────────────────────
  groep('Kanban: slepen');
  check('naar Done verplaatst',
    (await anna(`/taken/${taak2}/verplaats`, { method: 'POST', body: { status: 'Done' } })).data.status === 'Done');
  await anna(`/taken/${taak3}/verplaats`, { method: 'POST', body: { status: 'Done', vorige_id: taak2 } });

  let done = (await rim(`/borden/${bordId}/taken`)).data.filter((t) => t.status === 'Done');
  check('volgorde in de kolom: 2 dan 3', done[0].id === taak2 && done[1].id === taak3, done.map((t) => t.opdracht).join(', '));

  await anna(`/taken/${taak3}/verplaats`, { method: 'POST', body: { status: 'Done', volgende_id: taak2 } });
  done = (await rim(`/borden/${bordId}/taken`)).data.filter((t) => t.status === 'Done');
  check('na slepen: 3 dan 2', done[0].id === taak3 && done[1].id === taak2, done.map((t) => t.opdracht).join(', '));

  const posities = (await rim(`/borden/${bordId}/taken`)).data.map((t) => t.positie);
  check('posities blijven hele getallen', posities.every((p, i) => p === i + 1), JSON.stringify(posities));

  // ── Wachtwoord vergeten ─────────────────────────────────────────────────
  groep('Wachtwoord vergeten');
  const annaOud = client();
  await annaOud('/inloggen', { method: 'POST', body: { email: 'anna@transafe.nl', wachtwoord: 'AnnaHaarWachtwoord' } });
  check('Anna is ingelogd op haar oude wachtwoord', (await annaOud('/ik')).data.gebruiker?.naam === 'Anna Jansen');

  check('lid mag geen herstellink maken',
    (await anna(`/gebruikers/${annaId}/herstel`, { method: 'POST' })).status === 403);

  const herstel = (await rim(`/gebruikers/${annaId}/herstel`, { method: 'POST' })).data.token;
  check('beheerder maakt herstellink', !!herstel);
  check('link hoort bij de juiste persoon', (await anoniem('/herstel/' + herstel)).data.email === 'anna@transafe.nl');
  check('te kort nieuw wachtwoord geweigerd',
    (await anoniem('/herstel', { method: 'POST', body: { token: herstel, wachtwoord: 'kort' } })).status === 400);

  check('wachtwoord hersteld',
    (await anna('/herstel', { method: 'POST', body: { token: herstel, wachtwoord: 'AnnaNieuwWachtwoord' } })).status === 200);
  check('oude sessie is ongeldig', (await annaOud('/borden')).status === 401);
  check('oud wachtwoord werkt niet meer',
    (await anoniem('/inloggen', { method: 'POST', body: { email: 'anna@transafe.nl', wachtwoord: 'AnnaHaarWachtwoord' } })).status === 401);
  check('nieuw wachtwoord werkt',
    (await anoniem('/inloggen', { method: 'POST', body: { email: 'anna@transafe.nl', wachtwoord: 'AnnaNieuwWachtwoord' } })).status === 200);
  check('herstellink is eenmalig',
    (await anoniem('/herstel', { method: 'POST', body: { token: herstel, wachtwoord: 'WeerEenWachtwoord' } })).status === 404);

  // ── Uitschakelen en verwijderen ─────────────────────────────────────────
  groep('Uitschakelen en verwijderen');
  check('Anna uitgeschakeld', (await rim('/gebruikers/' + annaId, { method: 'PATCH', body: { actief: false } })).status === 200);
  check('haar sessie is weg', (await anna('/borden')).status === 401);
  check('ze kan niet meer inloggen',
    (await anoniem('/inloggen', { method: 'POST', body: { email: 'anna@transafe.nl', wachtwoord: 'AnnaNieuwWachtwoord' } })).status === 401);

  check('taak verwijderd', (await rim('/taken/' + taak1, { method: 'DELETE' })).status === 200);
  check('taak is echt weg', (await rim('/taken/' + taak1)).status === 404);

  groep('Uitloggen');
  await rim('/uitloggen', { method: 'POST' });
  check('na uitloggen geen toegang', (await rim('/borden')).status === 401);
} catch (fout) {
  console.error('\nDe test liep vast:', fout);
  mislukt++;
}

opruimen();
console.log(mislukt === 0 ? '\nAlle controles geslaagd.\n' : `\n${mislukt} controle(s) MISLUKT.\n`);
process.exit(mislukt === 0 ? 0 : 1);
