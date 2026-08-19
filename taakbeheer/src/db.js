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

/** Geeft true terug als de kolom er nu pas bij komt — handig om eenmalig te vullen. */
function voegKolomToe(tabel, kolom, definitie) {
  const bestaat = db.prepare(`PRAGMA table_info(${tabel})`).all().some((k) => k.name === kolom);
  if (!bestaat) db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${definitie}`);
  return !bestaat;
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

/**
 * De persoonlijke takenlijst. Is prive_van gevuld, dan is het bord van die ene
 * persoon en ziet niemand anders het — ook een beheerder niet. Dat is de enige
 * uitzondering op "een beheerder ziet elk bord"; die regel bestaat om te
 * voorkomen dat een bord onbereikbaar wordt, en hier is het overnemen van de
 * lijst bij uitdiensttreding het antwoord op datzelfde probleem.
 */
voegKolomToe('borden', 'prive_van', 'INTEGER REFERENCES gebruikers(id)');

export const PRIVELIJST_NAAM = 'Mijn takenlijst';

/** Maakt de persoonlijke lijst voor wie er nog geen heeft. */
export function zorgVoorPriveLijst(gebruikerId) {
  const bestaat = db.prepare('SELECT id FROM borden WHERE prive_van = ?').get(gebruikerId);
  if (bestaat) return bestaat.id;

  return db.prepare(
    `INSERT INTO borden (naam, prive_van, zichtbaar_voor_iedereen, aangemaakt_door)
     VALUES (?, ?, 0, ?)`
  ).run(PRIVELIJST_NAAM, gebruikerId, gebruikerId).lastInsertRowid;
}

/**
 * Het prikbord. Briefjes zijn naslag en geen werk: geen status, geen deadline,
 * geen uitvoerende. Ze zijn van één persoon en van niemand anders.
 *
 * `weggegooid_op` leeg betekent: hij hangt op de muur. Staat er een datum, dan
 * zit hij in de prullenbak en verdwijnt hij na PRULLENBAK_DAGEN vanzelf.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS briefjes (
    id            INTEGER PRIMARY KEY,
    gebruiker_id  INTEGER NOT NULL REFERENCES gebruikers(id),
    titel         TEXT NOT NULL,
    tekst         TEXT NOT NULL DEFAULT '',
    vastgepind    INTEGER NOT NULL DEFAULT 0,
    aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
    gewijzigd_op  TEXT,
    weggegooid_op TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_briefjes_gebruiker ON briefjes(gebruiker_id);
`);

/**
 * Categorieën van het prikbord. Van één persoon, net als de briefjes zelf.
 * Elke categorie heeft één kleur uit de vaste post-it-lijst; zo betekent een
 * kleur altijd hetzelfde en wordt de muur geen kerstboom.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS briefje_categorieen (
    id           INTEGER PRIMARY KEY,
    gebruiker_id INTEGER NOT NULL REFERENCES gebruikers(id),
    naam         TEXT NOT NULL,
    kleur        TEXT NOT NULL,
    positie      INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_categorieen_gebruiker ON briefje_categorieen(gebruiker_id);
`);

// Leeg = geen categorie; zo'n briefje blijft gewoon geel. Een categorie
// verwijderen laat de briefjes staan, die vallen dan terug op geel.
voegKolomToe('briefjes', 'categorie_id',
  'INTEGER REFERENCES briefje_categorieen(id) ON DELETE SET NULL');

// Je eigen volgorde, die je met slepen bepaalt. Lager staat hoger op de muur.
if (voegKolomToe('briefjes', 'positie', 'INTEGER NOT NULL DEFAULT 0')) {
  // Bestaande briefjes krijgen eenmalig de volgorde die ze op het scherm al
  // hadden: het nieuwste bovenaan.
  const opVolgorde = db.prepare('SELECT id FROM briefjes ORDER BY aangemaakt_op DESC, id DESC').all();
  const zet = db.prepare('UPDATE briefjes SET positie = ? WHERE id = ?');
  opVolgorde.forEach((briefje, i) => zet.run(i + 1, briefje.id));
}

/**
 * Geel is gereserveerd voor een briefje zónder categorie. Zou een categorie
 * ook geel mogen zijn, dan zijn die twee op de muur niet uit elkaar te houden
 * — en dan betekent een kleur niets meer. Er blijven dus vijf kleuren voor
 * categorieën over, en daarmee vijf categorieën.
 */
export const GEEN_CATEGORIE_KLEUR = '#FDF3A7';

export const POSTIT_KLEUREN = [
  { naam: 'Roze',   kleur: '#FBC6D4' },
  { naam: 'Oranje', kleur: '#FCD9A8' },
  { naam: 'Groen',  kleur: '#C9E7BE' },
  { naam: 'Blauw',  kleur: '#BFDCF2' },
  { naam: 'Paars',  kleur: '#DBC9EC' },
];

export const MAX_CATEGORIEEN = POSTIT_KLEUREN.length;

export const PRULLENBAK_DAGEN = 30;

/**
 * Ruimt op wat langer dan 30 dagen in de prullenbak ligt. Er draait geen klok
 * in de app; dit loopt bij het opstarten en telkens als iemand zijn prikbord
 * opent. Dat is genoeg: wat er te lang ligt, is weg zodra je gaat kijken.
 */
export function ruimPrullenbakOp() {
  return db.prepare(
    `DELETE FROM briefjes
      WHERE weggegooid_op IS NOT NULL
        AND weggegooid_op < datetime('now', '-${PRULLENBAK_DAGEN} days')`
  ).run().changes;
}

ruimPrullenbakOp();

// Bestaande gebruikers krijgen er eenmalig ook een.
for (const { id } of db.prepare('SELECT id FROM gebruikers').all()) zorgVoorPriveLijst(id);

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
