// Test van de hele achterkant. Start zelf een server op een vrije poort met een
// lege database, loopt alles na, en ruimt daarna op.
//
// Draaien:  npm test

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
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
  env: {
    ...process.env,
    PORT: String(poort),
    DATABASE_PAD: join(werkmap, 'test.db'),
    NODE_ENV: 'test',
    MAX_BIJLAGE_MB: '1',     // klein, zodat de grensproef snel blijft
  },
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

/** Hoeveel bestanden staan er op schijf in de bijlagenmap. */
function bestandenInMap() {
  try {
    return readdirSync(join(werkmap, 'bijlagen')).length;
  } catch {
    return 0;
  }
}

/**
 * Maakt een "browser": onthoudt zijn eigen sessiecookie.
 *   body          → wordt als JSON verstuurd
 *   rauw          → wordt ongewijzigd verstuurd (voor bestandsuploads)
 *   rauwAntwoord  → geef tekst en headers terug in plaats van JSON
 */
function client() {
  let cookie = '';
  return async (pad, opties = {}) => {
    const res = await fetch(BASIS + pad, {
      method: opties.method,
      headers: {
        ...(opties.body ? { 'content-type': 'application/json' } : {}),
        ...(opties.headers ?? {}),
        ...(cookie ? { cookie } : {}),
      },
      body: opties.rauw !== undefined ? opties.rauw : (opties.body ? JSON.stringify(opties.body) : undefined),
      redirect: 'manual',
    });

    for (const c of res.headers.getSetCookie?.() ?? []) {
      if (c.startsWith('sessie=')) cookie = c.split(';')[0];
    }

    if (opties.rauwAntwoord) {
      return { status: res.status, tekst: await res.text(), headers: Object.fromEntries(res.headers) };
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

  // ── Persoonlijk bord en afgeschermde borden ─────────────────────────────
  // Vanaf hier werken we met een verse tweede gebruiker, want Anna is hierboven
  // uitgeschakeld.
  groep('Persoonlijk bord');

  const carlaUitnodiging = (await rim('/uitnodigingen', { method: 'POST', body: { email: 'carla@transafe.nl' } })).data.token;
  const carla = client();
  await carla('/registreren', { method: 'POST', body: { token: carlaUitnodiging, naam: 'Carla Smit', wachtwoord: 'CarlaHaarWachtwoord' } });
  const carlaId = (await rim('/gebruikers')).data.find((g) => g.email === 'carla@transafe.nl').id;

  const projectA = (await rim('/borden', { method: 'POST', body: { naam: 'Project A' } })).data.id;
  const projectB = (await rim('/borden', { method: 'POST', body: { naam: 'Project B' } })).data.id;

  await rim(`/borden/${projectA}/taken`, { method: 'POST', body: { opdracht: 'A voor Carla', uitvoerend_id: carlaId, status: 'Working on it' } });
  await rim(`/borden/${projectA}/taken`, { method: 'POST', body: { opdracht: 'A voor Carla, klaar', uitvoerend_id: carlaId, status: 'Done' } });
  await rim(`/borden/${projectB}/taken`, { method: 'POST', body: { opdracht: 'B voor Carla', uitvoerend_id: carlaId } });
  await rim(`/borden/${projectA}/taken`, { method: 'POST', body: { opdracht: 'A voor niemand' } });

  let mijn = (await carla('/mijn-taken')).data;
  check('Carla ziet alleen haar eigen taken', mijn.length === 3, mijn.map((t) => t.opdracht).join(', '));
  check('met de projectnaam erbij', mijn.every((t) => t.bord_naam), JSON.stringify(mijn[0]));
  check('uit meerdere projecten', new Set(mijn.map((t) => t.bord_naam)).size === 2);
  check('inclusief de status om op te groeperen', mijn.some((t) => t.status === 'Done') && mijn.some((t) => t.status === 'Working on it'));

  check('Rim ziet niet Carlas taken op zijn persoonlijke bord',
    (await rim('/mijn-taken')).data.every((t) => t.uitvoerend_naam === 'Rim de Haan'));

  groep('Bord afschermen');
  // Een bord waar Carla géén taak op heeft, anders houdt ze toegang (zie hierna).
  const projectD = (await rim('/borden', { method: 'POST', body: { naam: 'Project D' } })).data.id;
  await rim(`/borden/${projectD}/taken`, { method: 'POST', body: { opdracht: 'Alleen voor Rim' } });

  check('standaard ziet Carla het nieuwe bord', (await carla('/borden')).data.some((b) => b.id === projectD));

  r = await rim(`/borden/${projectD}`, { method: 'PATCH', body: { zichtbaar_voor_iedereen: false, leden: [1] } });
  check('bord afgeschermd', r.status === 200, JSON.stringify(r.data));

  const bordenVanCarla = (await carla('/borden')).data;
  check('Project D is uit haar lijst verdwenen', !bordenVanCarla.some((b) => b.id === projectD),
    bordenVanCarla.map((b) => b.naam).join(', '));
  check('Project A ziet ze nog wel', bordenVanCarla.some((b) => b.id === projectA));
  check('taken van dat bord zijn niet op te vragen', (await carla(`/borden/${projectD}/taken`)).status === 404);
  check('instellingen ook niet', (await carla(`/borden/${projectD}/instellingen`)).status === 404);
  check('Rim ziet het bord nog wel', (await rim('/borden')).data.some((b) => b.id === projectD));

  groep('Wie een taak heeft, houdt toegang');
  // Carla heeft een taak op Project B, dus afschermen mag haar er niet uit gooien.
  r = await rim(`/borden/${projectB}`, { method: 'PATCH', body: { zichtbaar_voor_iedereen: false, leden: [1] } });
  check('afschermen lukt', r.status === 200);

  const instellingenB = (await rim(`/borden/${projectB}/instellingen`)).data;
  check('Carla is automatisch op de lijst gezet', instellingenB.leden.includes(carlaId),
    JSON.stringify(instellingenB.leden));
  check('en ze ziet het bord dus toch', (await carla('/borden')).data.some((b) => b.id === projectB));
  check('haar taak blijft op haar persoonlijke bord staan',
    (await carla('/mijn-taken')).data.some((t) => t.bord_id === projectB));

  groep('Toewijzen aan wie niets mag zien');
  const projectC = (await rim('/borden', { method: 'POST', body: { naam: 'Project C' } })).data.id;
  await rim(`/borden/${projectC}`, { method: 'PATCH', body: { zichtbaar_voor_iedereen: false, leden: [1] } });

  r = await rim(`/borden/${projectC}/taken`, { method: 'POST', body: { opdracht: 'Geheim', uitvoerend_id: carlaId } });
  check('toewijzen aan iemand zonder toegang wordt geweigerd', r.status === 400, JSON.stringify(r.data));
  check('met uitleg wat je moet doen', /toegang/i.test(r.data.fout ?? ''), r.data.fout);

  const geheim = (await rim(`/borden/${projectC}/taken`, { method: 'POST', body: { opdracht: 'Geheime taak' } })).data.id;
  check('taak zonder uitvoerende mag wel', !!geheim);
  check('ook wijzigen naar zo iemand wordt geweigerd',
    (await rim(`/taken/${geheim}`, { method: 'PATCH', body: { uitvoerend_id: carlaId } })).status === 400);

  groep('Afgeschermde taken zijn echt dicht');
  check('taak niet op te vragen', (await carla('/taken/' + geheim)).status === 404);
  check('niet te wijzigen', (await carla(`/taken/${geheim}`, { method: 'PATCH', body: { status: 'Done' } })).status === 404);
  check('niet te verplaatsen', (await carla(`/taken/${geheim}/verplaats`, { method: 'POST', body: { status: 'Done' } })).status === 404);
  check('niet te verwijderen', (await carla('/taken/' + geheim, { method: 'DELETE' })).status === 404);
  check('geen opmerking te plaatsen',
    (await carla(`/taken/${geheim}/opmerkingen`, { method: 'POST', body: { tekst: 'hallo' } })).status === 404);
  check('de taak staat er na die pogingen nog',
    (await rim('/taken/' + geheim)).data.status === 'Not Started');

  groep('Wie mag bordinstellingen wijzigen');
  const bordVanCarla = (await carla('/borden', { method: 'POST', body: { naam: 'Bord van Carla' } })).data.id;
  check('lid mag zijn eigen bord afschermen',
    (await carla(`/borden/${bordVanCarla}`, { method: 'PATCH', body: { zichtbaar_voor_iedereen: false, leden: [carlaId] } })).status === 200);
  check('maar niet dat van een ander',
    (await carla(`/borden/${projectA}`, { method: 'PATCH', body: { naam: 'Gekaapt' } })).status === 403);
  check('beheerder mag dat wel',
    (await rim(`/borden/${bordVanCarla}`, { method: 'PATCH', body: { naam: 'Bord van Carla' } })).status === 200);
  check('lid kan andermans bord niet verwijderen',
    (await carla('/borden/' + projectA, { method: 'DELETE' })).status === 403);

  // ── Bijlagen ────────────────────────────────────────────────────────────
  groep('Bijlagen');

  /** Uploadt een bestand zoals de browser dat doet: kale stroom + headers. */
  async function upload(sessie, taakId, naam, inhoud, type = 'text/plain') {
    return sessie(`/taken/${taakId}/bijlagen`, {
      method: 'POST',
      rauw: inhoud,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bestandsnaam': encodeURIComponent(naam),
        'x-bestandstype': type,
      },
    });
  }

  const metBijlage = (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Keuring met papieren' } })).data.id;

  r = await upload(rim, metBijlage, 'keuringsrapport.pdf', 'dit stelt een pdf voor');
  check('bestand geüpload', r.status === 200 && r.data.bestandsnaam === 'keuringsrapport.pdf', JSON.stringify(r.data));
  check('grootte klopt', r.data.grootte === Buffer.byteLength('dit stelt een pdf voor'));
  check('met wie het uploadde', r.data.geupload_door_naam === 'Rim de Haan');
  const bijlageId = r.data.id;

  r = await rim('/taken/' + metBijlage);
  check('bijlage staat bij de taak', r.data.bijlagen.length === 1);
  check('en wordt geteld in de lijst',
    (await rim(`/borden/${bordId}/taken`)).data.find((t) => t.id === metBijlage).aantal_bijlagen === 1);
  check('aanmaak staat in de historie', r.data.historie.some((h) => h.veld === 'bijlage toegevoegd'));

  r = await rim('/bijlagen/' + bijlageId, { rauwAntwoord: true });
  check('downloaden geeft de inhoud terug', r.tekst === 'dit stelt een pdf voor', r.tekst);
  check('altijd als download, nooit als pagina',
    /^attachment;/.test(r.headers['content-disposition'] ?? ''), r.headers['content-disposition']);
  check('browser mag het type niet zelf raden', r.headers['x-content-type-options'] === 'nosniff');
  check('inhoudstype is neutraal', r.headers['content-type'] === 'application/octet-stream');

  check('lege naam wordt geweigerd', (await upload(rim, metBijlage, '', 'iets')).status === 400);
  check('leeg bestand wordt geweigerd', (await upload(rim, metBijlage, 'leeg.txt', '')).status === 400);

  const opSchijfVoor = bestandenInMap();
  r = await upload(rim, metBijlage, 'veel-te-groot.zip', 'x'.repeat(1.2 * 1024 * 1024));
  check('te groot bestand wordt geweigerd', r.status === 413, JSON.stringify(r.data));
  check('met de grens erbij genoemd', /1 MB/.test(r.data.fout ?? ''), r.data.fout);
  check('en er blijft niets van achter op schijf', bestandenInMap() === opSchijfVoor,
    `voor: ${opSchijfVoor}, na: ${bestandenInMap()}`);
  check('de taak heeft er ook geen regel bij',
    (await rim('/taken/' + metBijlage)).data.bijlagen.length === 1);

  r = await upload(rim, metBijlage, '../../server.js', 'stiekem');
  check('padnamen worden onschadelijk gemaakt', r.status === 200 && !r.data.bestandsnaam.includes('/'),
    r.data.bestandsnaam);
  await rim('/bijlagen/' + r.data.id, { method: 'DELETE' });

  groep('Bijlagen en afgeschermde borden');
  const geheimeTaak = (await rim(`/borden/${projectD}/taken`, { method: 'POST', body: { opdracht: 'Vertrouwelijk' } })).data.id;
  const geheimeBijlage = (await upload(rim, geheimeTaak, 'contract.pdf', 'geheime inhoud')).data.id;

  check('Carla kan er niet bij', (await carla('/bijlagen/' + geheimeBijlage)).status === 404);
  check('en kan er ook niet één toevoegen', (await upload(carla, geheimeTaak, 'eigen.txt', 'hoi')).status === 404);
  check('en niet verwijderen', (await carla('/bijlagen/' + geheimeBijlage, { method: 'DELETE' })).status === 404);
  check('het bestand is er nog', (await rim('/taken/' + geheimeTaak)).data.bijlagen.length === 1);

  groep('Opruimen bij verwijderen');
  const bestandenVoor = bestandenInMap();
  await rim('/taken/' + geheimeTaak, { method: 'DELETE' });
  check('bestand is van schijf verwijderd', bestandenInMap() === bestandenVoor - 1,
    `voor: ${bestandenVoor}, na: ${bestandenInMap()}`);

  // ── Taken overdragen ────────────────────────────────────────────────────
  groep('Taak naar een ander project');

  const teVerhuizen = (await rim(`/borden/${projectA}/taken`, { method: 'POST', body: {
    opdracht: 'Overdracht keuring', uitvoerend_id: carlaId, status: 'Working on it' } })).data.id;
  await rim(`/taken/${teVerhuizen}/opmerkingen`, { method: 'POST', body: { tekst: 'Deels gedaan.' } });
  await upload(rim, teVerhuizen, 'tussenrapport.pdf', 'stand van zaken');

  r = await rim(`/taken/${teVerhuizen}`, { method: 'PATCH', body: { bord_id: projectA } });
  check('hetzelfde project kiezen verandert niets', r.status === 200 && r.data.bord_id === projectA);

  r = await rim(`/taken/${teVerhuizen}`, { method: 'PATCH', body: { bord_id: projectB } });
  check('taak verplaatst naar het andere project', r.status === 200 && r.data.bord_id === projectB, JSON.stringify(r.data));
  check('hij staat niet meer op het oude project',
    !(await rim(`/borden/${projectA}/taken`)).data.some((t) => t.id === teVerhuizen));
  check('en wel op het nieuwe',
    (await rim(`/borden/${projectB}/taken`)).data.some((t) => t.id === teVerhuizen));

  r = await rim('/taken/' + teVerhuizen);
  check('de opmerking is meegegaan', r.data.opmerkingen.length === 1);
  check('de bijlage ook', r.data.bijlagen.length === 1 && r.data.bijlagen[0].bestandsnaam === 'tussenrapport.pdf');
  check('status en uitvoerder blijven staan', r.data.status === 'Working on it' && r.data.uitvoerend_naam === 'Carla Smit');

  const verhuisregel = r.data.historie.find((h) => h.veld === 'project');
  check('de verhuizing staat in de historie',
    verhuisregel?.oude_waarde === 'Project A' && verhuisregel?.nieuwe_waarde === 'Project B',
    JSON.stringify(verhuisregel));

  check('hij staat achteraan het nieuwe project',
    (await rim(`/borden/${projectB}/taken`)).data.at(-1).id === teVerhuizen);
  check('Carlas persoonlijke bord noemt nu het nieuwe project',
    (await carla('/mijn-taken')).data.find((t) => t.id === teVerhuizen)?.bord_naam === 'Project B');

  groep('Verplaatsen dat niet mag');
  check('naar een project dat je niet kunt zien',
    (await carla(`/taken/${teVerhuizen}`, { method: 'PATCH', body: { bord_id: projectD } })).status === 400);
  check('naar een project dat niet bestaat',
    (await rim(`/taken/${teVerhuizen}`, { method: 'PATCH', body: { bord_id: 999999 } })).status === 400);

  // Carla mag Project C niet zien, dus haar taak kan daar niet heen.
  r = await rim(`/taken/${teVerhuizen}`, { method: 'PATCH', body: { bord_id: projectC } });
  check('uitvoerder die het doelproject niet ziet, wordt tegengehouden', r.status === 400, JSON.stringify(r.data));
  check('met haar naam en het project erbij',
    /Carla/.test(r.data.fout ?? '') && /Project C/.test(r.data.fout ?? ''), r.data.fout);
  check('de taak is niet stiekem toch verhuisd',
    (await rim('/taken/' + teVerhuizen)).data.bord_id === projectB);

  check('zonder uitvoerder mag het wel',
    (await rim(`/taken/${teVerhuizen}`, { method: 'PATCH', body: { bord_id: projectC, uitvoerend_id: null } })).status === 200);

  // ── Prioriteit ──────────────────────────────────────────────────────────
  groep('Prioriteit');

  r = await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Zonder prioriteit' } });
  check('taak zonder prioriteit mag', r.status === 200 && r.data.prioriteit === null, JSON.stringify(r.data));
  const zonderPrio = r.data.id;

  r = await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Spoedklus', prioriteit: 'Critical' } });
  check('prioriteit bij aanmaken', r.data.prioriteit === 'Critical', JSON.stringify(r.data));
  const spoed = r.data.id;

  check('verzonnen prioriteit wordt genegeerd',
    (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'X', prioriteit: 'Superurgent' } })).data.prioriteit === null);

  check('prioriteit los aanpassen',
    (await rim(`/taken/${zonderPrio}`, { method: 'PATCH', body: { prioriteit: 'Medium' } })).data.prioriteit === 'Medium');
  check('en weer weghalen',
    (await rim(`/taken/${zonderPrio}`, { method: 'PATCH', body: { prioriteit: null } })).data.prioriteit === null);
  check('een verzonnen waarde maakt hem leeg, niet kapot',
    (await rim(`/taken/${spoed}`, { method: 'PATCH', body: { prioriteit: 'Onzin' } })).data.prioriteit === null);

  await rim(`/taken/${spoed}`, { method: 'PATCH', body: { prioriteit: 'High' } });
  r = await rim('/taken/' + spoed);
  const prioRegel = r.data.historie.find((h) => h.veld === 'prioriteit' && h.nieuwe_waarde === 'High');
  check('wijziging staat in de historie', !!prioRegel, JSON.stringify(r.data.historie.slice(0, 3)));

  check('alleen de status wijzigen laat de prioriteit staan',
    (await rim(`/taken/${spoed}`, { method: 'PATCH', body: { status: 'Done' } })).data.prioriteit === 'High');

  check('prioriteit staat in de takenlijst',
    (await rim(`/borden/${bordId}/taken`)).data.find((t) => t.id === spoed).prioriteit === 'High');

  await rim(`/taken/${spoed}`, { method: 'PATCH', body: { uitvoerend_id: carlaId } });
  check('en op het persoonlijke bord',
    (await carla('/mijn-taken')).data.find((t) => t.id === spoed)?.prioriteit === 'High');

  check('prioriteit gaat mee bij verplaatsen naar een ander project',
    (await rim(`/taken/${spoed}`, { method: 'PATCH', body: { bord_id: projectA } })).data.prioriteit === 'High');

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
