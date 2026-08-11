// Inloggen: wachtwoorden versleutelen en sessies bijhouden.
//
// Wachtwoorden worden nooit als leesbare tekst opgeslagen. We gebruiken scrypt,
// een standaardmethode die ingebouwd zit in Node. Elk wachtwoord krijgt een eigen
// willekeurige "salt", zodat twee mensen met hetzelfde wachtwoord toch een
// verschillende versleutelde waarde in de database hebben staan.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'sessie';
const SESSIE_DAGEN = 30;
const PRODUCTIE = process.env.NODE_ENV === 'production';

export function hashWachtwoord(wachtwoord) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(wachtwoord, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function wachtwoordKlopt(wachtwoord, opgeslagen) {
  const [methode, salt, hash] = String(opgeslagen).split('$');
  if (methode !== 'scrypt' || !salt || !hash) return false;

  const ingevoerd = scryptSync(wachtwoord, salt, 64);
  const bekend = Buffer.from(hash, 'hex');

  // timingSafeEqual vergelijkt altijd even lang, zodat je uit de reactietijd
  // niet kunt afleiden hoeveel tekens er klopten.
  return ingevoerd.length === bekend.length && timingSafeEqual(ingevoerd, bekend);
}

// ── Sessies ──────────────────────────────────────────────────────────────
// Bij het inloggen krijg je een lange willekeurige code. Die staat in een
// cookie én in de database. Bij elk verzoek zoeken we hem daar op.

export function maakSessie(res, gebruikerId) {
  const token = randomBytes(32).toString('hex');
  const verloopt = new Date(Date.now() + SESSIE_DAGEN * 864e5);

  db.prepare('INSERT INTO sessies (token, gebruiker_id, verloopt_op) VALUES (?, ?, ?)')
    .run(token, gebruikerId, verloopt.toISOString());

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
      return decodeURIComponent(deel.slice(isGelijk + 1).trim());
    }
  }
  return null;
}

/** Zoekt bij elk verzoek op wie er is ingelogd en hangt dat aan req.gebruiker. */
export function metGebruiker(req, res, next) {
  req.gebruiker = null;
  const token = leesCookie(req, COOKIE);

  if (token) {
    const rij = db.prepare(
      `SELECT g.id, g.email, g.naam, g.rol, s.verloopt_op
         FROM sessies s
         JOIN gebruikers g ON g.id = s.gebruiker_id
        WHERE s.token = ? AND g.actief = 1`
    ).get(token);

    if (rij && new Date(rij.verloopt_op) > new Date()) {
      req.gebruiker = { id: rij.id, email: rij.email, naam: rij.naam, rol: rij.rol };
    } else if (rij) {
      db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
    }
  }
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
