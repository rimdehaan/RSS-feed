// Inloggen: wachtwoorden versleutelen en sessies bijhouden.
//
// Wachtwoorden worden nooit als leesbare tekst opgeslagen. We gebruiken scrypt,
// een standaardmethode die ingebouwd zit in Node. Elk wachtwoord krijgt een eigen
// willekeurige "salt", zodat twee mensen met hetzelfde wachtwoord toch een
// verschillende versleutelde waarde in de database hebben staan.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { noteer } from './logboek.js';

const scryptAsync = promisify(scrypt);

const COOKIE = 'sessie';
const SESSIE_DAGEN = 30;
const PRODUCTIE = process.env.NODE_ENV === 'production';

/**
 * Hoe zwaar het rekenen is. Hoger betekent: langer wachten bij het inloggen,
 * maar ook veel duurder voor wie wachtwoorden probeert te raden.
 *
 * N = 2^16 gemeten op deze code: ongeveer 0,8 seconde en 64 MB geheugen per
 * wachtwoord. N = 2^17 vraagt 128 MB en dat past niet meer comfortabel in een
 * kleine hostingcontainer. Wil je hoger, zet dan SCRYPT_N — de instelling gaat
 * mee in de opgeslagen waarde, dus bestaande wachtwoorden blijven werken.
 */
const KOSTEN = { N: geldigeN(process.env.SCRYPT_N, 65536), r: 8, p: 1 };
const MAXMEM = 192 * 1024 * 1024;

/** De oude vorm had geen instelling erin; dat waren de standaarden van Node. */
const OUDE_KOSTEN = { N: 16384, r: 8, p: 1 };

function geldigeN(waarde, standaard) {
  const n = Number(waarde);
  // Moet een macht van twee zijn, anders weigert scrypt.
  return Number.isInteger(n) && n >= 16384 && (n & (n - 1)) === 0 ? n : standaard;
}

/**
 * Het rekenen zelf. Twee dingen zijn hier bewust zo:
 *
 * - Het gebeurt naast de server, niet erin. Anders staat de hele app een
 *   fractie van een seconde stil zodra iemand inlogt, en dat merken alle
 *   anderen die op dat moment iets aanklikken.
 * - Eén tegelijk, via een wachtrij. Elke berekening vraagt 64 MB geheugen;
 *   twintig tegelijk past niet in een kleine hostingcontainer.
 */
let wachtrij = Promise.resolve();

function reken(wachtwoord, salt, kosten) {
  const beurt = wachtrij.then(() => scryptAsync(wachtwoord, salt, 64, { ...kosten, maxmem: MAXMEM }));
  wachtrij = beurt.catch(() => {});   // een fout bij de een houdt de rij niet op
  return beurt;
}

export async function hashWachtwoord(wachtwoord) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await reken(wachtwoord, salt, KOSTEN)).toString('hex');
  return `scrypt$${KOSTEN.N}$${KOSTEN.r}$${KOSTEN.p}$${salt}$${hash}`;
}

/**
 * Een opgeslagen waarde die bij geen enkel wachtwoord hoort. Bestaat het
 * account niet, dan rekenen we hiermee: dat duurt even lang als bij een echt
 * account. Zonder dit zie je aan de reactietijd welke adressen bestaan.
 */
const NEP = `scrypt$${KOSTEN.N}$${KOSTEN.r}$${KOSTEN.p}$${'0'.repeat(32)}$${'0'.repeat(128)}`;

/**
 * Leest een opgeslagen wachtwoord uit. Twee vormen:
 *   scrypt$salt$hash            — oud, met de standaardinstellingen van Node
 *   scrypt$N$r$p$salt$hash      — nu, met de instelling erin
 */
function leesOpgeslagen(opgeslagen) {
  const delen = String(opgeslagen).split('$');
  if (delen[0] !== 'scrypt') return null;

  if (delen.length === 3 && delen[1] && delen[2]) {
    return { kosten: OUDE_KOSTEN, salt: delen[1], hash: delen[2] };
  }
  if (delen.length === 6 && delen[4] && delen[5]) {
    return {
      kosten: { N: Number(delen[1]), r: Number(delen[2]), p: Number(delen[3]) },
      salt: delen[4], hash: delen[5],
    };
  }
  return null;
}

/** Zonder opgeslagen waarde (geen account) rekenen we toch, met NEP. */
export async function wachtwoordKlopt(wachtwoord, opgeslagen) {
  const gelezen = leesOpgeslagen(opgeslagen ?? NEP);
  if (!gelezen) return false;

  const ingevoerd = await reken(wachtwoord, gelezen.salt, gelezen.kosten);
  const bekend = Buffer.from(gelezen.hash, 'hex');

  // timingSafeEqual vergelijkt altijd even lang, zodat je uit de reactietijd
  // niet kunt afleiden hoeveel tekens er klopten.
  return ingevoerd.length === bekend.length && timingSafeEqual(ingevoerd, bekend);
}

/**
 * Is dit wachtwoord met een lichtere instelling opgeslagen dan we nu gebruiken?
 * Zo ja, dan slaan we hem opnieuw op zodra iemand met succes inlogt — dat is het
 * enige moment waarop we het wachtwoord in handen hebben.
 */
export function moetZwaarder(opgeslagen) {
  const gelezen = leesOpgeslagen(opgeslagen);
  return !gelezen || gelezen.kosten.N < KOSTEN.N;
}

/**
 * Slaat het wachtwoord opnieuw op met de huidige instelling. Alleen als het
 * oude er nog staat: is het intussen gewijzigd, dan blijft het nieuwe staan.
 */
export async function verzwaar(gebruikerId, wachtwoord, oudeWaarde) {
  const nieuw = await hashWachtwoord(wachtwoord);
  db.prepare('UPDATE gebruikers SET wachtwoord_hash = ? WHERE id = ? AND wachtwoord_hash = ?')
    .run(nieuw, gebruikerId, oudeWaarde);
}

// ── Sessies ──────────────────────────────────────────────────────────────
// Bij het inloggen krijg je een lange willekeurige code. Die staat in een
// cookie én in de database. Bij elk verzoek zoeken we hem daar op.

export function maakSessie(res, gebruikerId) {
  schrijfSessie(res, gebruikerId, null, new Date(Date.now() + SESSIE_DAGEN * 864e5));
}

function schrijfSessie(res, gebruikerId, meekijkerId, verloopt) {
  const token = randomBytes(32).toString('hex');

  db.prepare('INSERT INTO sessies (token, gebruiker_id, meekijker_id, verloopt_op) VALUES (?, ?, ?, ?)')
    .run(token, gebruikerId, meekijkerId, verloopt.toISOString());

  res.cookie(COOKIE, token, {
    httpOnly: true,               // JavaScript op de pagina kan er niet bij
    sameSite: 'lax',              // beschermt tegen verzoeken vanaf andere sites
    secure: PRODUCTIE,            // alleen via https zodra je live staat
    expires: verloopt,
    path: '/',
  });
}

export function verwijderSessie(req, res) {
  const token = leesCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

function leesCookie(req, naam) {
  for (const deel of (req.headers.cookie || '').split(';')) {
    const isGelijk = deel.indexOf('=');
    if (isGelijk > 0 && deel.slice(0, isGelijk).trim() === naam) {
      // Een kapotte cookie is gewoon geen sessie, geen reden voor een serverfout.
      try {
        return decodeURIComponent(deel.slice(isGelijk + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Een actieve gebruiker in de vorm die aan req.gebruiker hangt, of null. */
function actieveGebruiker(id) {
  const g = db.prepare(
    'SELECT id, email, naam, rol, mag_werkprocessen FROM gebruikers WHERE id = ? AND actief = 1'
  ).get(id);
  return g ? { ...g, mag_werkprocessen: Boolean(g.mag_werkprocessen) } : null;
}

// ── Meekijken ────────────────────────────────────────────────────────────
// Een beheerder ziet de app zoals een collega hem ziet. Technisch is dat een
// sessie van de collega waarin staat wie er meekijkt. De eigen sessie van de
// beheerder verdwijnt zolang; bij het stoppen komt er een nieuwe.

export const MEEKIJK_MINUTEN = 30;

export function startMeekijken(req, res, collega) {
  const token = leesCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessies WHERE token = ?').run(token);

  schrijfSessie(res, collega.id, req.gebruiker.id, new Date(Date.now() + MEEKIJK_MINUTEN * 60e3));

  // De collega ziet het bij het volgende bezoek; het inlogboek bewaart het.
  db.prepare('INSERT INTO meekijk_meldingen (gebruiker_id, meekijker_id) VALUES (?, ?)')
    .run(collega.id, req.gebruiker.id);
  noteer({ soort: 'meekijken', gelukt: true, email: collega.email, gebruikerId: req.gebruiker.id, ip: req.ip });
}

/**
 * Stopt het meekijken, met de knop of omdat de tijd om is. De beheerder is
 * daarna weer zichzelf. Geeft die gebruiker terug, of null als die intussen
 * geen beheerder meer is — dan volgt gewoon uitloggen.
 */
export function stopMeekijken(req, res) {
  const token = leesCookie(req, COOKIE);
  const sessie = token && db.prepare(
    `SELECT s.meekijker_id, g.email FROM sessies s JOIN gebruikers g ON g.id = s.gebruiker_id
      WHERE s.token = ? AND s.meekijker_id IS NOT NULL`
  ).get(token);
  if (!sessie) return null;

  db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
  noteer({ soort: 'meekijken-gestopt', gelukt: true, email: sessie.email, gebruikerId: sessie.meekijker_id, ip: req.ip });

  const beheerder = actieveGebruiker(sessie.meekijker_id);
  if (beheerder?.rol !== 'beheerder') {
    res.clearCookie(COOKIE, { path: '/' });
    return null;
  }
  maakSessie(res, beheerder.id);
  return beheerder;
}

/** Zoekt bij elk verzoek op wie er is ingelogd en hangt dat aan req.gebruiker. */
export function metGebruiker(req, res, next) {
  req.gebruiker = null;
  const token = leesCookie(req, COOKIE);
  const rij = token && db.prepare(
    'SELECT gebruiker_id, meekijker_id, verloopt_op FROM sessies WHERE token = ?'
  ).get(token);
  if (!rij) return next();

  const verlopen = new Date(rij.verloopt_op) <= new Date();

  if (!rij.meekijker_id) {
    if (verlopen) db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
    else req.gebruiker = actieveGebruiker(rij.gebruiker_id);
    return next();
  }

  // Een meekijksessie. Tijd om, of de collega intussen uitgeschakeld? Dan is de
  // beheerder weer zichzelf. En wie geen beheerder meer is, kijkt niet meer mee.
  const collega = actieveGebruiker(rij.gebruiker_id);
  const meekijker = actieveGebruiker(rij.meekijker_id);

  if (verlopen || !collega || meekijker?.rol !== 'beheerder') {
    req.gebruiker = stopMeekijken(req, res);
    return next();
  }

  req.gebruiker = {
    ...collega,
    meekijker: { id: meekijker.id, naam: meekijker.naam, tot: rij.verloopt_op },
  };
  next();
}

export function vereistLogin(req, res, next) {
  if (!req.gebruiker) return res.status(401).json({ fout: 'Je bent niet ingelogd.' });
  next();
}

export function vereistBeheerder(req, res, next) {
  if (!req.gebruiker) return res.status(401).json({ fout: 'Je bent niet ingelogd.' });
  if (req.gebruiker.rol !== 'beheerder') {
    return res.status(403).json({ fout: 'Hier heb je beheerdersrechten voor nodig.' });
  }
  next();
}

/** Ruimt verlopen sessies en uitnodigingen op. Draait bij het starten. */
export function ruimOp() {
  const nu = new Date().toISOString();
  db.prepare('DELETE FROM sessies WHERE verloopt_op < ?').run(nu);
  db.prepare('DELETE FROM uitnodigingen WHERE verloopt_op < ? AND gebruikt_op IS NULL').run(nu);
  db.prepare('DELETE FROM herstel WHERE verloopt_op < ?').run(nu);
}
