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

function reken(wachtwoord, salt, kosten) {
  return scryptSync(wachtwoord, salt, 64, { ...kosten, maxmem: MAXMEM });
}

export function hashWachtwoord(wachtwoord) {
  const salt = randomBytes(16).toString('hex');
  const hash = reken(wachtwoord, salt, KOSTEN).toString('hex');
  return `scrypt$${KOSTEN.N}$${KOSTEN.r}$${KOSTEN.p}$${salt}$${hash}`;
}

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

export function wachtwoordKlopt(wachtwoord, opgeslagen) {
  const gelezen = leesOpgeslagen(opgeslagen);
  if (!gelezen) return false;

  const ingevoerd = reken(wachtwoord, gelezen.salt, gelezen.kosten);
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

/** Slaat het wachtwoord opnieuw op met de huidige instelling. */
export function verzwaar(gebruikerId, wachtwoord) {
  db.prepare('UPDATE gebruikers SET wachtwoord_hash = ? WHERE id = ?')
    .run(hashWachtwoord(wachtwoord), gebruikerId);
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
      `SELECT g.id, g.email, g.naam, g.rol, g.mag_werkprocessen, s.verloopt_op
         FROM sessies s
         JOIN gebruikers g ON g.id = s.gebruiker_id
        WHERE s.token = ? AND g.actief = 1`
    ).get(token);

    if (rij && new Date(rij.verloopt_op) > new Date()) {
      req.gebruiker = {
        id: rij.id, email: rij.email, naam: rij.naam, rol: rij.rol,
        mag_werkprocessen: Boolean(rij.mag_werkprocessen),
      };
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
