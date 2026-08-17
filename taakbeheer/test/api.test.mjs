// Test van de hele achterkant. Start zelf een server op een vrije poort met een
// lege database, loopt alles na, en ruimt daarna op.
//
// Draaien:  npm test

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitsStappen } from '../public/stappen.js';

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

  const stuur = async (pad, opties = {}) => {
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

  // Handig voor het ophalen van een bestand buiten deze helper om.
  stuur.cookie = () => cookie;
  return stuur;
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
  check('standaardbord bestaat', borden.some((b) => b.naam === 'Takenbord' && !b.prive_van));
  check('en je eigen takenlijst ook',
    borden.some((b) => b.naam === 'Mijn takenlijst' && b.prive_van), JSON.stringify(borden));
  check('meer is er niet', borden.length === 2, JSON.stringify(borden.map((b) => b.naam)));
  const bordId = borden.find((b) => b.naam === 'Takenbord').id;

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

  // ── Je eigen naam wijzigen ──────────────────────────────────────────────
  groep('Eigen naam wijzigen');
  check('naam wijzigen lukt',
    (await anna('/mij', { method: 'PATCH', body: { naam: 'Anna de Jong' } })).data.naam === 'Anna de Jong');
  check('en staat meteen in je eigen gegevens',
    (await anna('/ik')).data.gebruiker.naam === 'Anna de Jong');
  check('ook een collega ziet de nieuwe naam',
    (await rim('/gebruikers')).data.find(g => g.id === annaId).naam === 'Anna de Jong');

  check('lege naam geweigerd',
    (await anna('/mij', { method: 'PATCH', body: { naam: '   ' } })).status === 400);
  check('en de naam is dan niet veranderd',
    (await anna('/ik')).data.gebruiker.naam === 'Anna de Jong');
  check('een te lange naam wordt afgekapt op 80 tekens',
    (await anna('/mij', { method: 'PATCH', body: { naam: 'A'.repeat(200) } })).data.naam.length === 80);
  await anna('/mij', { method: 'PATCH', body: { naam: 'Anna Jansen' } });

  // Een verse client: `anoniem` heeft hierboven ingelogd en draagt dus een koekje.
  const buitenstaander = client();
  check('uitgelogd mag je niets wijzigen',
    (await buitenstaander('/mij', { method: 'PATCH', body: { naam: 'Indringer' } })).status === 401);

  // Een beheerder mag de naam van een ander herstellen; een lid niet.
  check('beheerder wijzigt de naam van een collega',
    (await rim(`/gebruikers/${annaId}`, { method: 'PATCH', body: { naam: 'Anna Janssen' } })).status === 200);
  check('en dat is echt doorgevoerd',
    (await anna('/ik')).data.gebruiker.naam === 'Anna Janssen');
  check('lege naam ook daar geweigerd',
    (await rim(`/gebruikers/${annaId}`, { method: 'PATCH', body: { naam: '' } })).status === 400);
  const rimId = (await rim('/ik')).data.gebruiker.id;
  check('een lid mag de naam van een ander niet wijzigen',
    (await anna(`/gebruikers/${rimId}`, { method: 'PATCH', body: { naam: 'Gekaapt' } })).status === 403);
  check('en die naam is ongemoeid',
    (await rim('/ik')).data.gebruiker.naam === 'Rim de Haan');

  check('rol en rechten blijven staan bij een naamwijziging',
    (await rim('/gebruikers')).data.find(g => g.id === annaId).rol === 'lid');

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

  groep('Alle bijlagen als ZIP');
  await upload(rim, metBijlage, 'plattegrond.png', 'net alsof dit een plaatje is');
  await upload(rim, metBijlage, 'keuringsrapport.pdf', 'tweede met dezelfde naam');

  r = await rim(`/taken/${metBijlage}/bijlagen.zip`, { rauwAntwoord: true });
  check('zip opgehaald', r.status === 200, JSON.stringify(r.tekst).slice(0, 80));
  check('als download aangeboden', /^attachment;/.test(r.headers['content-disposition'] ?? ''));
  check('met de opdrachtnaam in de bestandsnaam',
    /Keuring met papieren/.test(decodeURIComponent(r.headers['content-disposition'] ?? '')),
    r.headers['content-disposition']);
  check('inhoudstype is zip', r.headers['content-type'] === 'application/zip');

  // De zip wordt hieronder door Python uitgepakt; dat is een losse controle.
  const zipPad = join(werkmap, 'controle.zip');
  writeFileSync(zipPad, Buffer.from(await (await fetch(`${BASIS}/taken/${metBijlage}/bijlagen.zip`, {
    headers: { cookie: rim.cookie() } })).arrayBuffer()));

  const uitPython = execFileSync('python3', ['-c', `
import zipfile, json
with zipfile.ZipFile(${JSON.stringify(zipPad)}) as z:
    print(json.dumps({
        'kapot': z.testzip(),
        'namen': z.namelist(),
        'eerste': z.read(z.namelist()[0]).decode('utf-8', 'replace'),
    }))
`]).toString();

  const zipInhoud = JSON.parse(uitPython);
  check('zip is niet beschadigd', zipInhoud.kapot === null, JSON.stringify(zipInhoud.kapot));
  check('alle drie de bestanden zitten erin', zipInhoud.namen.length === 3, JSON.stringify(zipInhoud.namen));
  check('dubbele naam kreeg een nummer',
    zipInhoud.namen.includes('keuringsrapport (2).pdf'), JSON.stringify(zipInhoud.namen));
  check('de inhoud klopt', zipInhoud.eerste === 'dit stelt een pdf voor', zipInhoud.eerste);

  const zonderBijlagen = (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Kaal' } })).data.id;
  check('taak zonder bijlagen geeft niets terug',
    (await rim(`/taken/${zonderBijlagen}/bijlagen.zip`)).status === 404);

  // ── Een link als bijlage ────────────────────────────────────────────────
  groep('Link als bijlage');
  const link = (adres, naam) =>
    rim(`/taken/${metBijlage}/bijlagen/link`, { method: 'POST', body: { url: adres, naam } });

  r = await link('https://transafe-my.sharepoint.com/keuring-2026', "Foto's keuring");
  check('link opgeslagen', r.status === 200 && r.data.url === 'https://transafe-my.sharepoint.com/keuring-2026',
    JSON.stringify(r.data));
  check('met de naam die je gaf', r.data.bestandsnaam === "Foto's keuring");
  check('en zonder bestand op schijf', r.data.grootte === 0);
  const linkId = r.data.id;
  check('er kwam niets bij op schijf', bestandenInMap() === 3, String(bestandenInMap()));

  r = await link('onedrive.live.com/map', '');
  check('zonder https ervoor wordt aangevuld', r.data.url === 'https://onedrive.live.com/map', r.data.url);
  check('en zonder naam pakt hij de bestemming', r.data.bestandsnaam === 'onedrive.live.com', r.data.bestandsnaam);

  check('leeg adres geweigerd', (await link('', 'Niets')).status === 400);
  for (const kwaad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd']) {
    check(`${kwaad.split(':')[0]}: geweigerd`, (await link(kwaad, 'Kwaad')).status === 400);
  }
  check('geen van die adressen is opgeslagen',
    (await rim('/taken/' + metBijlage)).data.bijlagen.filter(b => b.url).length === 2);

  check('een link is geen bestand om te downloaden',
    (await rim('/bijlagen/' + linkId)).status === 400);
  // De ZIP moet de links meenemen als tekstbestand.
  const zipMetLinks = join(werkmap, 'met-links.zip');
  writeFileSync(zipMetLinks, Buffer.from(await (await fetch(`${BASIS}/taken/${metBijlage}/bijlagen.zip`, {
    headers: { cookie: rim.cookie() } })).arrayBuffer()));
  const metLinks = JSON.parse(execFileSync('python3', ['-c', `
import zipfile, json
with zipfile.ZipFile(${JSON.stringify(zipMetLinks)}) as z:
    print(json.dumps({'namen': z.namelist(), 'links': z.read('Links.txt').decode('utf-8')}))
`]).toString());
  check('Links.txt zit in de zip', metLinks.namen.includes('Links.txt'), JSON.stringify(metLinks.namen));
  check('de bestanden staan er nog steeds in', metLinks.namen.length === 4, JSON.stringify(metLinks.namen));
  check('met het adres erin', metLinks.links.includes('https://transafe-my.sharepoint.com/keuring-2026'),
    metLinks.links);
  check('en de naam erbij', metLinks.links.includes("Foto's keuring"), metLinks.links);

  check('link verwijderen lukt', (await rim('/bijlagen/' + linkId, { method: 'DELETE' })).status === 200);
  check('en staat als link in de historie',
    (await rim('/taken/' + metBijlage)).data.historie.some(h => h.veld === 'link verwijderd'));
  check('de bestanden zijn ongemoeid', bestandenInMap() === 3, String(bestandenInMap()));

  // ── De persoonlijke takenlijst ──────────────────────────────────────────
  // De enige plek waar de regel "een beheerder ziet elk bord" niet geldt.
  groep('Mijn takenlijst');
  const lijstVan = async (wie) =>
    (await wie('/borden')).data.find((b) => b.prive_van);

  const carlaLijst = await lijstVan(carla);
  check('Carla kreeg er automatisch een bij het registreren', !!carlaLijst, JSON.stringify(carlaLijst));
  check('met de vaste naam', carlaLijst.naam === 'Mijn takenlijst');
  check('en hij is van haar', carlaLijst.prive_van === carlaId);
  check('instellingen wijzigen kan niet, ook niet door haarzelf', carlaLijst.mag_beheren === false);

  const rimLijst = await lijstVan(rim);
  check('Rim heeft een eigen lijst', rimLijst.id !== carlaLijst.id);

  check('een lid ziet de lijst van een ander niet',
    (await carla('/borden')).data.every((b) => !b.prive_van || b.prive_van === carlaId));
  check('en een BEHEERDER ook niet',
    (await rim('/borden')).data.every((b) => !b.prive_van || b.prive_van === rimId),
    JSON.stringify((await rim('/borden')).data.filter((b) => b.prive_van)));

  const carlaTaak = (await carla(`/borden/${carlaLijst.id}/taken`,
    { method: 'POST', body: { opdracht: 'Leverancier bellen' } })).data;
  check('Carla maakt er een taak op aan', !!carlaTaak.id, JSON.stringify(carlaTaak));
  check('die staat meteen op haar naam', carlaTaak.uitvoerend_id === carlaId);
  check('en verschijnt in haar overzicht Mijn taken',
    (await carla('/mijn-taken')).data.some((t) => t.id === carlaTaak.id));

  check('een beheerder kan het bord niet opvragen',
    (await rim('/borden/' + carlaLijst.id + '/taken')).status === 404);
  check('en de instellingen ook niet',
    (await rim('/borden/' + carlaLijst.id + '/instellingen')).status === 404);
  check('en de taak erop niet',
    (await rim('/taken/' + carlaTaak.id)).status === 404);
  check('en er niets op aanmaken',
    (await rim(`/borden/${carlaLijst.id}/taken`, { method: 'POST', body: { opdracht: 'Stiekem' } })).status === 404);
  check('en het bord niet verwijderen',
    (await rim('/borden/' + carlaLijst.id, { method: 'DELETE' })).status === 404);
  check('en niet hernoemen',
    (await rim('/borden/' + carlaLijst.id, { method: 'PATCH', body: { naam: 'Gekaapt' } })).status === 404);
  check('de taak staat er nog', (await carla('/taken/' + carlaTaak.id)).status === 200);

  check('zelf hernoemen kan ook niet',
    (await carla('/borden/' + carlaLijst.id, { method: 'PATCH', body: { naam: 'Anders' } })).status === 403,
    JSON.stringify((await carla('/borden/' + carlaLijst.id, { method: 'PATCH', body: { naam: 'Anders' } })).data));

  check('uit je lijst naar een project mag',
    (await carla('/taken/' + carlaTaak.id, { method: 'PATCH', body: { bord_id: projectA } })).status === 200);
  check('en dan zien collega\'s hem wel', (await rim('/taken/' + carlaTaak.id)).status === 200);

  r = await carla('/taken/' + carlaTaak.id, { method: 'PATCH', body: { bord_id: carlaLijst.id } });
  check('maar terug naar je lijst niet', r.status === 400 && /persoonlijke takenlijst/.test(r.data.fout ?? ''),
    JSON.stringify(r.data));
  check('en de taak staat nog gewoon op het project',
    (await rim('/taken/' + carlaTaak.id)).data.bord_id === projectA);

  groep('Bijlagen en afgeschermde borden');
  const geheimeTaak = (await rim(`/borden/${projectD}/taken`, { method: 'POST', body: { opdracht: 'Vertrouwelijk' } })).data.id;
  const geheimeBijlage = (await upload(rim, geheimeTaak, 'contract.pdf', 'geheime inhoud')).data.id;

  check('Carla kan er niet bij', (await carla('/bijlagen/' + geheimeBijlage)).status === 404);
  check('en kan er ook niet één toevoegen', (await upload(carla, geheimeTaak, 'eigen.txt', 'hoi')).status === 404);
  check('ook geen link', (await carla(`/taken/${geheimeTaak}/bijlagen/link`,
    { method: 'POST', body: { url: 'https://onedrive.live.com/stiekem' } })).status === 404);
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

  // ── Werkprocessen ───────────────────────────────────────────────────────
  groep('Tekst knippen in stappen');

  const knip = (tekst) => splitsStappen(tekst);

  check('genummerd met punt',
    JSON.stringify(knip('1. Controleer de druk\n2. Noteer het nummer')) ===
    JSON.stringify(['Controleer de druk', 'Noteer het nummer']));

  check('genummerd met haakje',
    JSON.stringify(knip('1) Controleer de druk\n2) Noteer het nummer')) ===
    JSON.stringify(['Controleer de druk', 'Noteer het nummer']));

  check('met het woord stap ervoor',
    JSON.stringify(knip('Stap 1: Controleer de druk\nStap 2: Noteer het nummer')) ===
    JSON.stringify(['Controleer de druk', 'Noteer het nummer']));

  check('met streepjes',
    JSON.stringify(knip('- Controleer de druk\n- Noteer het nummer')) ===
    JSON.stringify(['Controleer de druk', 'Noteer het nummer']));

  check('met bolletjes en inspringing',
    JSON.stringify(knip('  • Controleer de druk\n   • Noteer het nummer')) ===
    JSON.stringify(['Controleer de druk', 'Noteer het nummer']));

  check('kale regels blijven zoals ze zijn',
    JSON.stringify(knip('Controleer de druk\nNoteer het nummer')) ===
    JSON.stringify(['Controleer de druk', 'Noteer het nummer']));

  check('lege regels vallen weg', knip('Eerste\n\n\nTweede\n   \n').length === 2);
  check('streepje én nummer allebei weg', knip('- 1. Controleer de druk')[0] === 'Controleer de druk');

  // Hier gaat een te gretige regel de mist in.
  check('een reeks als 10-15 blijft heel', knip('10-15 flessen tellen')[0] === '10-15 flessen tellen');
  check('een temperatuur als -15 blijft heel', knip('-15 graden aanhouden')[0] === '-15 graden aanhouden');
  check('lopende tekst wordt één stap',
    knip('Controleer eerst de druk, noteer daarna het nummer en plak tot slot de sticker.').length === 1);

  check('te lange stap wordt afgekapt', knip('x'.repeat(700))[0].length === 500);
  check('lege invoer geeft niets', knip('').length === 0 && knip('   \n  ').length === 0);

  groep('Werkprocessen aanmaken');
  r = await rim('/werkprocessen', { method: 'POST', body: {
    naam: 'Keuring gasflessen',
    toelichting: 'Voor de jaarlijkse keuring',
    stappen: ['Controleer de druk', 'Noteer het serienummer', 'Plak de sticker'],
  } });
  check('werkproces aangemaakt', r.status === 200 && r.data.versie === 1, JSON.stringify(r.data));
  const keuring = r.data.id;

  r = await rim('/werkprocessen/' + keuring);
  check('stappen in de juiste volgorde',
    JSON.stringify(r.data.stappen) === JSON.stringify(['Controleer de druk', 'Noteer het serienummer', 'Plak de sticker']),
    JSON.stringify(r.data.stappen));
  check('toelichting bewaard', r.data.toelichting === 'Voor de jaarlijkse keuring');

  check('zonder naam geweigerd',
    (await rim('/werkprocessen', { method: 'POST', body: { naam: '  ', stappen: ['Iets'] } })).status === 400);
  check('zonder stappen geweigerd',
    (await rim('/werkprocessen', { method: 'POST', body: { naam: 'Leeg proces', stappen: [] } })).status === 400);
  check('alleen lege stappen geweigerd',
    (await rim('/werkprocessen', { method: 'POST', body: { naam: 'Leeg proces', stappen: ['', '   '] } })).status === 400);

  r = await rim('/werkprocessen', { method: 'POST', body: { naam: 'KEURING GASFLESSEN', stappen: ['Iets'] } });
  check('dubbele naam geweigerd, ook met andere hoofdletters', r.status === 409, JSON.stringify(r.data));
  check('met de naam in de melding', /Keuring gasflessen/i.test(r.data.fout ?? ''), r.data.fout);

  r = await rim('/werkprocessen', { method: 'POST', body: {
    naam: 'Veel te lang', stappen: Array.from({ length: 250 }, (_, i) => 'Stap ' + i) } });
  check('meer dan 200 stappen geweigerd', r.status === 400);
  check('met het gevonden aantal erbij', /250/.test(r.data.fout ?? ''), r.data.fout);

  groep('Werkprocessen wijzigen en versies');
  check('naam wijzigen hoogt de versie niet op',
    (await rim('/werkprocessen/' + keuring, { method: 'PATCH', body: { naam: 'Keuring gasflessen 2026' } })).data.versie === 1);
  check('dezelfde stappen opnieuw sturen ook niet',
    (await rim('/werkprocessen/' + keuring, { method: 'PATCH', body: {
      stappen: ['Controleer de druk', 'Noteer het serienummer', 'Plak de sticker'] } })).data.versie === 1);

  r = await rim('/werkprocessen/' + keuring, { method: 'PATCH', body: {
    stappen: ['Controleer de druk', 'Noteer het serienummer', 'Plak de sticker', 'Meld af bij de klant'] } });
  check('een stap erbij hoogt de versie wel op', r.data.versie === 2, JSON.stringify(r.data));
  check('de nieuwe stap staat erin', (await rim('/werkprocessen/' + keuring)).data.stappen.length === 4);

  check('alleen de volgorde wijzigen hoogt ook op',
    (await rim('/werkprocessen/' + keuring, { method: 'PATCH', body: {
      stappen: ['Noteer het serienummer', 'Controleer de druk', 'Plak de sticker', 'Meld af bij de klant'] } })).data.versie === 3);

  groep('Rechten op werkprocessen');
  check('een lid ziet de bibliotheek', (await carla('/werkprocessen')).status === 200);
  check('maar mag niet beheren', (await carla('/werkprocessen')).data.mag_beheren === false);
  check('aanmaken wordt geweigerd',
    (await carla('/werkprocessen', { method: 'POST', body: { naam: 'Van Carla', stappen: ['Iets'] } })).status === 403);
  check('wijzigen ook',
    (await carla('/werkprocessen/' + keuring, { method: 'PATCH', body: { naam: 'Gekaapt' } })).status === 403);
  check('en verwijderen ook',
    (await carla('/werkprocessen/' + keuring, { method: 'DELETE' })).status === 403);

  check('beheerder geeft het recht',
    (await rim('/gebruikers/' + carlaId, { method: 'PATCH', body: { mag_werkprocessen: true } })).status === 200);
  check('nu mag Carla het wel', (await carla('/werkprocessen')).data.mag_beheren === true);
  check('en lukt aanmaken',
    (await carla('/werkprocessen', { method: 'POST', body: { naam: 'Van Carla', stappen: ['Iets'] } })).status === 200);
  check('het recht staat ook in haar eigen gegevens', (await carla('/ik')).data.mag_werkprocessen === true);

  check('het recht weer intrekken kan',
    (await rim('/gebruikers/' + carlaId, { method: 'PATCH', body: { mag_werkprocessen: false } })).status === 200);
  check('en dan mag ze niets meer',
    (await carla('/werkprocessen', { method: 'POST', body: { naam: 'Nog een', stappen: ['Iets'] } })).status === 403);
  check('een lid kan zichzelf het recht niet geven',
    (await carla('/gebruikers/' + carlaId, { method: 'PATCH', body: { mag_werkprocessen: true } })).status === 403);

  // ── Koppelen aan taken ──────────────────────────────────────────────────
  groep('Werkproces koppelen aan een taak');

  const klus = (await rim(`/borden/${bordId}/taken`, { method: 'POST', body: { opdracht: 'Keuring uitvoeren' } })).data.id;

  r = await rim(`/taken/${klus}/processen`, { method: 'POST', body: { werkproces_id: keuring } });
  check('gekoppeld', r.status === 200 && r.data.aantal_stappen === 4, JSON.stringify(r.data));
  const gekoppeld = r.data.id;

  r = await rim('/taken/' + klus);
  check('staat bij de taak', r.data.processen.length === 1);
  check('met naam en versie van dat moment',
    r.data.processen[0].naam === 'Keuring gasflessen 2026' && r.data.processen[0].versie === 3,
    JSON.stringify(r.data.processen[0]));
  check('de stappen zijn gekopieerd', r.data.processen[0].stappen.length === 4);
  check('nog niets afgevinkt', r.data.processen[0].stappen.every((s) => s.afgevinkt_op === null));
  check('koppelen staat in de historie', r.data.historie.some((h) => h.veld === 'werkproces gekoppeld'));

  check('onbekend werkproces geweigerd',
    (await rim(`/taken/${klus}/processen`, { method: 'POST', body: { werkproces_id: 999999 } })).status === 404);

  groep('Afvinken');
  const eersteStap = (await rim('/taken/' + klus)).data.processen[0].stappen[0];
  r = await rim('/taak-stappen/' + eersteStap.id, { method: 'PATCH', body: { afgevinkt: true } });
  check('stap afgevinkt', r.status === 200 && r.data.afgevinkt_op !== null);
  check('met wie het deed', r.data.afgevinkt_door_naam === 'Rim de Haan');

  r = await rim(`/borden/${bordId}/taken`);
  let opLijst = r.data.find((t) => t.id === klus);
  check('voortgang staat op de taak', opLijst.aantal_afgevinkt === 1 && opLijst.aantal_stappen === 4,
    JSON.stringify({ af: opLijst.aantal_afgevinkt, totaal: opLijst.aantal_stappen }));

  check('uitvinken kan ook',
    (await rim('/taak-stappen/' + eersteStap.id, { method: 'PATCH', body: { afgevinkt: false } })).data.afgevinkt_op === null);
  await rim('/taak-stappen/' + eersteStap.id, { method: 'PATCH', body: { afgevinkt: true } });

  groep('Twee werkprocessen op één taak');
  const tweede = (await rim(`/taken/${klus}/processen`, { method: 'POST', body: { werkproces_id: keuring } })).data.id;
  check('hetzelfde werkproces mag twee keer',
    (await rim('/taken/' + klus)).data.processen.length === 2);
  check('elk met eigen voortgang',
    (await rim('/taken/' + klus)).data.processen[1].stappen.every((s) => s.afgevinkt_op === null));

  r = await rim(`/taken/${klus}/processen/volgorde`, { method: 'POST', body: { volgorde: [tweede, gekoppeld] } });
  check('volgorde omgedraaid', r.status === 200);
  check('en die blijft staan', (await rim('/taken/' + klus)).data.processen[0].id === tweede);

  check('een volgorde met vreemde ids wordt geweigerd',
    (await rim(`/taken/${klus}/processen/volgorde`, { method: 'POST', body: { volgorde: [tweede] } })).status === 400);

  groep('De kopie staat los van de bibliotheek');
  await rim('/werkprocessen/' + keuring, { method: 'PATCH', body: {
    stappen: ['Heel andere stap', 'En nog een'] } });

  r = await rim('/taken/' + klus);
  check('de taak houdt zijn eigen stappen', r.data.processen[1].stappen.length === 4,
    JSON.stringify(r.data.processen[1].stappen.map((s) => s.tekst)));
  check('en zijn eigen versienummer', r.data.processen[1].versie === 3);
  check('het afgevinkte werk staat er nog', r.data.processen[1].stappen[0].afgevinkt_op !== null);

  check('een nieuwe koppeling krijgt wél de nieuwe versie',
    (await rim(`/taken/${klus}/processen`, { method: 'POST', body: { werkproces_id: keuring } })).data.versie === 4);

  // Een wegwerpproces, zodat het verwijderen hieronder de rest niet raakt.
  const wegwerp = (await rim('/werkprocessen', { method: 'POST', body: {
    naam: 'Tijdelijk proces', stappen: ['Eén stap'] } })).data.id;
  await rim(`/taken/${klus}/processen`, { method: 'POST', body: { werkproces_id: wegwerp } });
  await rim('/werkprocessen/' + wegwerp, { method: 'DELETE' });

  r = await rim('/taken/' + klus);
  check('na verwijderen uit de bibliotheek blijft de kopie bestaan', r.data.processen.length === 4);
  check('inclusief de naam van toen', r.data.processen.at(-1).naam === 'Tijdelijk proces');
  check('en de verwijzing naar het origineel is leeg', r.data.processen.at(-1).werkproces_id === null);

  groep('Verplaatsen en afschermen');
  check('werkprocessen gaan mee naar een ander project',
    (await rim(`/taken/${klus}`, { method: 'PATCH', body: { bord_id: projectA } })).status === 200);
  check('en staan er nog', (await rim('/taken/' + klus)).data.processen.length === 4);

  const stapVanKlus = (await rim('/taken/' + klus)).data.processen[0].stappen[0].id;
  const procesVanKlus = (await rim('/taken/' + klus)).data.processen[0].id;

  // Carla mag Project D niet zien; daar een taak met werkproces op zetten.
  const vertrouwelijkProces = (await rim('/werkprocessen', { method: 'POST', body: {
    naam: 'Directieprocedure', stappen: ['Stukken klaarleggen', 'Notulen archiveren'] } })).data.id;

  const geheim2 = (await rim(`/borden/${projectD}/taken`, { method: 'POST', body: { opdracht: 'Vertrouwelijk' } })).data.id;
  const geheimProces = (await rim(`/taken/${geheim2}/processen`, { method: 'POST', body: { werkproces_id: vertrouwelijkProces } })).data.id;
  const geheimeStap = (await rim('/taken/' + geheim2)).data.processen[0].stappen[0].id;

  check('een lid kan niet koppelen aan een taak die hij niet ziet',
    (await carla(`/taken/${geheim2}/processen`, { method: 'POST', body: { werkproces_id: vertrouwelijkProces } })).status === 404);
  check('en kan er niets afvinken',
    (await carla('/taak-stappen/' + geheimeStap, { method: 'PATCH', body: { afgevinkt: true } })).status === 404);
  check('en niets ontkoppelen',
    (await carla('/taak-processen/' + geheimProces, { method: 'DELETE' })).status === 404);
  check('en de volgorde niet omgooien',
    (await carla(`/taken/${geheim2}/processen/volgorde`, { method: 'POST', body: { volgorde: [geheimProces] } })).status === 404);
  check('het staat er allemaal nog', (await rim('/taken/' + geheim2)).data.processen.length === 1);

  groep('Ontkoppelen');
  check('ontkoppelen lukt', (await rim('/taak-processen/' + procesVanKlus, { method: 'DELETE' })).status === 200);
  check('het blok is weg', (await rim('/taken/' + klus)).data.processen.length === 3);
  check('en de stap ook', (await rim('/taak-stappen/' + stapVanKlus, { method: 'PATCH', body: { afgevinkt: true } })).status === 404);
  check('ontkoppelen staat in de historie',
    (await rim('/taken/' + klus)).data.historie.some((h) => h.veld === 'werkproces ontkoppeld'));

  groep('Werkprocessen verwijderen');
  const aantalVoor = (await rim('/werkprocessen')).data.werkprocessen.length;
  check('verwijderen lukt', (await rim('/werkprocessen/' + keuring, { method: 'DELETE' })).status === 200);
  check('en hij is weg', (await rim('/werkprocessen')).data.werkprocessen.length === aantalVoor - 1);
  check('opvragen geeft niet gevonden', (await rim('/werkprocessen/' + keuring)).status === 404);

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
