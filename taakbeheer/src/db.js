// De database. Alles staat in één SQLite-bestand (data/taakbeheer.db).
// Dat bestand IS je data — maak er back-ups van.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const pad = process.env.DATABASE_PAD || './data/taakbeheer.db';
mkdirSync(dirname(pad), { recursive: true });

// Bijlagen komen naast de database te staan, dus op dezelfde schijf. Eén plek
// om een back-up van te maken, en geen externe opslagdienst nodig.
export const BIJLAGEMAP = join(dirname(pad), 'bijlagen');
mkdirSync(BIJLAGEMAP, { recursive: true });

export const db = new Database(pad);

// WAL maakt gelijktijdig lezen en schrijven soepeler.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS gebruikers (
    id               INTEGER PRIMARY KEY,
    email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    naam             TEXT NOT NULL,
    wachtwoord_hash  TEXT NOT NULL,
    rol              TEXT NOT NULL DEFAULT 'lid',   -- 'beheerder' of 'lid'
    actief           INTEGER NOT NULL DEFAULT 1,
    aangemaakt_op    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS uitnodigingen (
    token            TEXT PRIMARY KEY,
    email            TEXT NOT NULL COLLATE NOCASE,
    rol              TEXT NOT NULL DEFAULT 'lid',
    uitgenodigd_door INTEGER REFERENCES gebruikers(id),
    verloopt_op      TEXT NOT NULL,
    gebruikt_op      TEXT,
    aangemaakt_op    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS herstel (
    token         TEXT PRIMARY KEY,
    gebruiker_id  INTEGER NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
    verloopt_op   TEXT NOT NULL,
    gebruikt_op   TEXT,
    aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessies (
    token         TEXT PRIMARY KEY,
    gebruiker_id  INTEGER NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
    verloopt_op   TEXT NOT NULL,
    aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS borden (
    id            INTEGER PRIMARY KEY,
    naam          TEXT NOT NULL,
    positie       INTEGER NOT NULL DEFAULT 0,
    gearchiveerd  INTEGER NOT NULL DEFAULT 0,
    aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Wie mag een bord zien dat niet voor iedereen zichtbaar is.
  CREATE TABLE IF NOT EXISTS bord_leden (
    bord_id      INTEGER NOT NULL REFERENCES borden(id) ON DELETE CASCADE,
    gebruiker_id INTEGER NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
    PRIMARY KEY (bord_id, gebruiker_id)
  );

  CREATE TABLE IF NOT EXISTS taken (
    id              INTEGER PRIMARY KEY,
    bord_id         INTEGER NOT NULL REFERENCES borden(id) ON DELETE CASCADE,
    opdracht        TEXT NOT NULL,
    uitvoerend_id   INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'Not Started',
    deadline        TEXT,
    omschrijving    TEXT NOT NULL DEFAULT '',
    positie         REAL NOT NULL DEFAULT 0,
    aangemaakt_door INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    aangemaakt_op   TEXT NOT NULL DEFAULT (datetime('now')),
    gewijzigd_op    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opmerkingen (
    id            INTEGER PRIMARY KEY,
    taak_id       INTEGER NOT NULL REFERENCES taken(id) ON DELETE CASCADE,
    gebruiker_id  INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    tekst         TEXT NOT NULL,
    aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Een werkproces dat aan een taak hangt. Naam en versie staan hier los
  -- opgeslagen: wijzigt of verdwijnt het origineel in de bibliotheek, dan blijft
  -- zichtbaar welke werkwijze deze taak heeft gevolgd.
  CREATE TABLE IF NOT EXISTS taak_processen (
    id             INTEGER PRIMARY KEY,
    taak_id        INTEGER NOT NULL REFERENCES taken(id) ON DELETE CASCADE,
    werkproces_id  INTEGER REFERENCES werkprocessen(id) ON DELETE SET NULL,
    naam           TEXT NOT NULL,
    versie         INTEGER NOT NULL,
    positie        REAL NOT NULL DEFAULT 0,
    gekoppeld_door INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    aangemaakt_op  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS taak_stappen (
    id             INTEGER PRIMARY KEY,
    taak_proces_id INTEGER NOT NULL REFERENCES taak_processen(id) ON DELETE CASCADE,
    tekst          TEXT NOT NULL,
    positie        INTEGER NOT NULL DEFAULT 0,
    afgevinkt_door INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    afgevinkt_op   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_taakprocessen_taak  ON taak_processen(taak_id);
  CREATE INDEX IF NOT EXISTS idx_taakstappen_proces  ON taak_stappen(taak_proces_id);

  CREATE TABLE IF NOT EXISTS bijlagen (
    id             INTEGER PRIMARY KEY,
    taak_id        INTEGER NOT NULL REFERENCES taken(id) ON DELETE CASCADE,
    bestandsnaam   TEXT NOT NULL,   -- zoals de gebruiker hem kent
    opslagnaam     TEXT NOT NULL,   -- willekeurige naam op schijf
    type           TEXT,
    grootte        INTEGER NOT NULL,
    geupload_door  INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    aangemaakt_op  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Vaste werkwijzen, bedrijfsbreed. Een taak krijgt er straks een kopie van,
  -- dus deze tabel is de bibliotheek en niet de administratie van wat er gedaan is.
  CREATE TABLE IF NOT EXISTS werkprocessen (
    id              INTEGER PRIMARY KEY,
    naam            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    toelichting     TEXT NOT NULL DEFAULT '',
    versie          INTEGER NOT NULL DEFAULT 1,
    aangemaakt_door INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    aangemaakt_op   TEXT NOT NULL DEFAULT (datetime('now')),
    gewijzigd_op    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS werkproces_stappen (
    id            INTEGER PRIMARY KEY,
    werkproces_id INTEGER NOT NULL REFERENCES werkprocessen(id) ON DELETE CASCADE,
    tekst         TEXT NOT NULL,
    positie       INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_stappen_werkproces ON werkproces_stappen(werkproces_id);

  CREATE TABLE IF NOT EXISTS historie (
    id            INTEGER PRIMARY KEY,
    taak_id       INTEGER NOT NULL REFERENCES taken(id) ON DELETE CASCADE,
    gebruiker_id  INTEGER REFERENCES gebruikers(id) ON DELETE SET NULL,
    veld          TEXT NOT NULL,
    oude_waarde   TEXT,
    nieuwe_waarde TEXT,
    aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_taken_bord      ON taken(bord_id);
  CREATE INDEX IF NOT EXISTS idx_opmerkingen_taak ON opmerkingen(taak_id);
  CREATE INDEX IF NOT EXISTS idx_historie_taak   ON historie(taak_id);
`);

// ── Meegroeien met bestaande databases ───────────────────────────────────
// CREATE TABLE IF NOT EXISTS raakt een tabel die er al staat niet meer aan.
// Nieuwe kolommen moeten er dus apart bij, anders werkt een nieuwe versie wel
// op een lege database maar niet op die van de server.

function voegKolomToe(tabel, kolom, definitie) {
  const bestaat = db.prepare(`PRAGMA table_info(${tabel})`).all().some((k) => k.name === kolom);
  if (!bestaat) db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${definitie}`);
}

// Bestaande borden blijven zichtbaar voor iedereen — dat was immers hoe ze werkten.
voegKolomToe('borden', 'zichtbaar_voor_iedereen', 'INTEGER NOT NULL DEFAULT 1');
voegKolomToe('borden', 'aangemaakt_door', 'INTEGER REFERENCES gebruikers(id)');

// Leeg betekent: geen prioriteit opgegeven. Bestaande taken beginnen zo.
voegKolomToe('taken', 'prioriteit', 'TEXT');

// Recht om de werkprocesbibliotheek te beheren. Standaard uit; beheerders mogen
// het al via hun rol, dus niemand raakt hierdoor iets kwijt.
voegKolomToe('gebruikers', 'mag_werkprocessen', 'INTEGER NOT NULL DEFAULT 0');

// Een bijlage is een bestand óf een link. Is url gevuld, dan is het een link:
// er staat dan niets op schijf, dus opslagnaam is leeg en grootte 0.
voegKolomToe('bijlagen', 'url', 'TEXT');

export const STATUSSEN = [
  'Not Started',
  'Working on it',
  'Validating',
  'Done',
  'On Hold',
  'Cancelled',
];

// Van dringend naar rustig. Geen prioriteit is ook een geldige keuze; die staat
// als lege waarde in de database.
export const PRIORITEITEN = ['Critical', 'High', 'Medium', 'Low'];

/** Aantal gebruikers — gebruikt om te bepalen of de eerste installatie nog moet. */
export function aantalGebruikers() {
  return db.prepare('SELECT COUNT(*) AS n FROM gebruikers').get().n;
}

/** Schrijf een wijziging weg in de historie van een taak. */
export function logHistorie(taakId, gebruikerId, veld, oud, nieuw) {
  db.prepare(
    `INSERT INTO historie (taak_id, gebruiker_id, veld, oude_waarde, nieuwe_waarde)
     VALUES (?, ?, ?, ?, ?)`
  ).run(taakId, gebruikerId, veld, oud === null || oud === undefined ? null : String(oud), nieuw === null || nieuw === undefined ? null : String(nieuw));
}
