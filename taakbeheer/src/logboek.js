// Het inlogboek: wie er wanneer binnenkwam, en wie het probeerde en niet lukte.
//
// Waarom dit erin zit: zonder logboek merk je een inbraakpoging pas als het al
// te laat is. Met dit boek zie je een reeks mislukte pogingen op een adres
// staan, of een geslaagde inlog op een raar tijdstip, en kun je ingrijpen —
// wachtwoord resetten, account uitzetten.
//
// Let op: hier staan e-mailadressen en IP-adressen in, en dat zijn
// persoonsgegevens. Daarom staat er een bewaartermijn op (LOG_DAGEN) en zien
// alleen beheerders het boek.

import { db } from './db.js';

/**
 * Hoe lang een regel blijft staan. Lang genoeg om iets terug te kunnen zoeken
 * ("vorige maand ging er iets mis"), kort genoeg om niet eindeloos
 * persoonsgegevens te bewaren.
 */
export const LOG_DAGEN = 90;

db.exec(`
  CREATE TABLE IF NOT EXISTS inlog_log (
    id           INTEGER PRIMARY KEY,
    moment       TEXT NOT NULL DEFAULT (datetime('now')),
    soort        TEXT NOT NULL,               -- zie SOORTEN hieronder
    gelukt       INTEGER NOT NULL DEFAULT 0,
    email        TEXT,                        -- wat er is ingetypt, ook als het account niet bestaat
    gebruiker_id INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    ip           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inlog_log_moment ON inlog_log(moment);
`);

/** De gebeurtenissen die we opschrijven, met hun tekst op het scherm. */
export const SOORTEN = {
  inloggen:    'Inloggen',
  geblokkeerd: 'Geblokkeerd door de rem',
  wachtwoord:  'Wachtwoord gewijzigd',
  herstel:     'Herstellink gebruikt',
  registreren: 'Account aangemaakt via uitnodiging',
  installatie: 'Eerste beheerder aangemaakt',
};

/**
 * Schrijft één gebeurtenis op. Gaat dat mis, dan mag de gebruiker daar geen
 * last van hebben: inloggen moet blijven werken, ook als het boek hapert.
 */
export function noteer({ soort, gelukt = false, email = null, gebruikerId = null, ip = null }) {
  try {
    db.prepare(
      'INSERT INTO inlog_log (soort, gelukt, email, gebruiker_id, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(soort, gelukt ? 1 : 0, email || null, gebruikerId || null, ip ? String(ip).slice(0, 60) : null);
  } catch (fout) {
    console.error('Inlogboek: regel niet opgeschreven.', fout);
  }
}

/** Gooit weg wat ouder is dan de bewaartermijn. Draait bij het opstarten. */
export function ruimLogboekOp() {
  return db.prepare(
    `DELETE FROM inlog_log WHERE moment < datetime('now', '-${LOG_DAGEN} days')`
  ).run().changes;
}

/** De laatste regels, nieuwste bovenaan. Alleen voor beheerders. */
export function laatsteRegels(limiet = 100) {
  return db.prepare(
    `SELECT l.id, l.moment, l.soort, l.gelukt, l.email, l.ip, g.naam
       FROM inlog_log l
       LEFT JOIN gebruikers g ON g.id = l.gebruiker_id
      ORDER BY l.moment DESC, l.id DESC
      LIMIT ?`
  ).all(Math.min(Math.max(Number(limiet) || 100, 1), 500));
}
