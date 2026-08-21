// Alle API-routes. De browser praat via deze adressen met de server.
// Elk antwoord is JSON. Fouten geven een statuscode + { fout: "uitleg" }.

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { createWriteStream, createReadStream, unlinkSync, statSync, readFileSync } from 'node:fs';
import { maakZip } from './zip.js';
import { join } from 'node:path';
import { db, BIJLAGEMAP, STATUSSEN, PRIORITEITEN, aantalGebruikers, logHistorie,
         zorgVoorPriveLijst, ruimPrullenbakOp, PRULLENBAK_DAGEN,
         POSTIT_KLEUREN, MAX_CATEGORIEEN } from './db.js';
import { splitsStappen, MAX_STAPPEN, MAX_STAP_TEKENS } from '../public/stappen.js';
import {
  hashWachtwoord, wachtwoordKlopt, maakSessie, verwijderSessie,
  vereistLogin, vereistBeheerder,
} from './auth.js';
import { GRENZEN, wachtNog, telFout, vergeet, teVeelMelding } from './rem.js';

const api = Router();

// ── Hulpjes ──────────────────────────────────────────────────────────────

function tekst(waarde, max = 500) {
  return String(waarde ?? '').trim().slice(0, max);
}

function geldigEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Rem op het raden van uitnodigings- en herstellinks. Geeft het antwoord terug
 * als je geblokkeerd bent, anders null.
 */
function tokenRem(req, res) {
  const wacht = wachtNog(`token:${req.ip}`, GRENZEN.tokenPerIp);
  return wacht === null ? null : res.status(429).json({ fout: teVeelMelding(wacht) });
}

/** Datum als jjjj-mm-dd, of null. */
function datumOfNull(waarde) {
  const d = tekst(waarde, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// ── Toegang tot borden ───────────────────────────────────────────────────
// Een bord is voor iedereen zichtbaar, of alleen voor de mensen op zijn lijst.
// Beheerders zien alles: anders kan een bord onbereikbaar raken zodra de laatste
// deelnemer vertrekt, en kan niemand dat meer rechtzetten.

/** Geeft het bord terug als de gebruiker het mag zien, anders null. */
function zichtbaarBord(gebruiker, bordId) {
  const bord = db.prepare('SELECT * FROM borden WHERE id = ?').get(Number(bordId));
  if (!bord) return null;

  // Let op de volgorde: deze regel moet vóór de beheerderscontrole staan.
  // Een persoonlijke takenlijst is van één iemand, en van niemand anders.
  if (bord.prive_van) return bord.prive_van === gebruiker.id ? bord : null;

  if (gebruiker.rol === 'beheerder' || bord.zichtbaar_voor_iedereen) return bord;

  const lid = db.prepare('SELECT 1 FROM bord_leden WHERE bord_id = ? AND gebruiker_id = ?')
    .get(bord.id, gebruiker.id);
  return lid ? bord : null;
}

/** Instellingen wijzigen mag een beheerder, en wie het bord heeft aangemaakt. */
function magBeheren(gebruiker, bord) {
  // Aan een persoonlijke lijst valt niets in te stellen: hij heeft een vaste
  // naam en er is maar één iemand die hem ziet.
  if (bord.prive_van) return false;
  return gebruiker.rol === 'beheerder' || bord.aangemaakt_door === gebruiker.id;
}

/** Mag deze persoon een taak op dit bord toegewezen krijgen? */
function magToegewezenWorden(bord, gebruikerId) {
  if (!gebruikerId) return true;   // niemand toewijzen mag altijd

  const gebruiker = db.prepare('SELECT rol FROM gebruikers WHERE id = ? AND actief = 1').get(gebruikerId);
  if (!gebruiker) return false;

  // Ook hier vóór de beheerderscontrole: op een persoonlijke takenlijst is de
  // eigenaar de enige die er iets op kan krijgen.
  if (bord.prive_van) return bord.prive_van === gebruikerId;

  if (bord.zichtbaar_voor_iedereen || gebruiker.rol === 'beheerder') return true;

  return Boolean(db.prepare('SELECT 1 FROM bord_leden WHERE bord_id = ? AND gebruiker_id = ?')
    .get(bord.id, gebruikerId));
}

/** Zoekt een taak op en controleert meteen of je het bord eronder mag zien. */
function zichtbareTaak(gebruiker, taakId) {
  const taak = db.prepare('SELECT * FROM taken WHERE id = ?').get(Number(taakId));
  if (!taak) return null;
  return zichtbaarBord(gebruiker, taak.bord_id) ? taak : null;
}

// ── Eerste installatie ───────────────────────────────────────────────────
// Zolang er nog geen enkele gebruiker is, mag iedereen de eerste beheerder
// aanmaken. Daarna sluit deze route zichzelf af.

api.get('/setup-nodig', (req, res) => {
  res.json({ nodig: aantalGebruikers() === 0 });
});

api.post('/setup', (req, res) => {
  if (aantalGebruikers() > 0) {
    return res.status(403).json({ fout: 'De installatie is al gedaan.' });
  }

  const naam = tekst(req.body.naam, 80);
  const email = tekst(req.body.email, 160).toLowerCase();
  const wachtwoord = String(req.body.wachtwoord ?? '');

  if (!naam) return res.status(400).json({ fout: 'Vul je naam in.' });
  if (!geldigEmail(email)) return res.status(400).json({ fout: 'Dat lijkt geen geldig e-mailadres.' });
  if (wachtwoord.length < 10) {
    return res.status(400).json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' });
  }

  const resultaat = db.prepare(
    `INSERT INTO gebruikers (email, naam, wachtwoord_hash, rol) VALUES (?, ?, ?, 'beheerder')`
  ).run(email, naam, hashWachtwoord(wachtwoord));

  // Een leeg bord om mee te beginnen, en je eigen takenlijst.
  db.prepare('INSERT INTO borden (naam) VALUES (?)').run('Takenbord');
  zorgVoorPriveLijst(resultaat.lastInsertRowid);

  maakSessie(res, resultaat.lastInsertRowid);
  res.json({ ok: true });
});

// ── Inloggen en uitloggen ────────────────────────────────────────────────

api.post('/inloggen', (req, res) => {
  const email = tekst(req.body.email, 160).toLowerCase();
  const wachtwoord = String(req.body.wachtwoord ?? '');

  // Twee sleutels: streng per adres, ruim per IP. Het juiste wachtwoord komt er
  // bewust ook niet doorheen zolang je geblokkeerd bent — anders heeft de rem
  // geen zin, want dat is precies wat een aanvaller aan het zoeken is.
  const perAdres = `inloggen:adres:${email}`;
  const perIp = `inloggen:ip:${req.ip}`;

  const wacht = wachtNog(perAdres, GRENZEN.inloggenPerAdres)
             ?? wachtNog(perIp, GRENZEN.inloggenPerIp);
  if (wacht !== null) {
    return res.status(429).json({ fout: teVeelMelding(wacht) });
  }

  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE email = ?').get(email);

  // Bewust dezelfde melding voor "onbekend adres" en "verkeerd wachtwoord":
  // anders kan iemand uitvissen welke adressen bestaan. Om diezelfde reden telt
  // een onbekend adres gewoon mee in de teller.
  if (!gebruiker || !gebruiker.actief || !wachtwoordKlopt(wachtwoord, gebruiker.wachtwoord_hash)) {
    telFout(perAdres);
    telFout(perIp);
    return res.status(401).json({ fout: 'E-mailadres of wachtwoord klopt niet.' });
  }

  vergeet(perAdres);
  maakSessie(res, gebruiker.id);
  res.json({ ok: true });
});

api.post('/uitloggen', (req, res) => {
  verwijderSessie(req, res);
  res.json({ ok: true });
});

api.get('/ik', (req, res) => {
  res.json({
    gebruiker: req.gebruiker,
    statussen: STATUSSEN,
    prioriteiten: PRIORITEITEN,
    mag_werkprocessen: req.gebruiker ? magWerkprocessenBeheren(req.gebruiker) : false,
    max_bijlage_mb: Math.round(MAX_BIJLAGE / 1024 / 1024),
  });
});

// ── Uitnodigingen ────────────────────────────────────────────────────────

api.get('/uitnodiging/:token', (req, res) => {
  const geblokkeerd = tokenRem(req, res);
  if (geblokkeerd) return geblokkeerd;

  const uitnodiging = db.prepare(
    'SELECT email, verloopt_op, gebruikt_op FROM uitnodigingen WHERE token = ?'
  ).get(req.params.token);

  if (!uitnodiging || uitnodiging.gebruikt_op || new Date(uitnodiging.verloopt_op) < new Date()) {
    telFout(`token:${req.ip}`);
    return res.status(404).json({ fout: 'Deze uitnodiging is niet meer geldig.' });
  }
  res.json({ email: uitnodiging.email });
});

api.post('/registreren', (req, res) => {
  const token = tekst(req.body.token, 100);
  const naam = tekst(req.body.naam, 80);
  const wachtwoord = String(req.body.wachtwoord ?? '');

  const uitnodiging = db.prepare('SELECT * FROM uitnodigingen WHERE token = ?').get(token);
  if (!uitnodiging || uitnodiging.gebruikt_op || new Date(uitnodiging.verloopt_op) < new Date()) {
    return res.status(404).json({ fout: 'Deze uitnodiging is niet meer geldig.' });
  }
  if (!naam) return res.status(400).json({ fout: 'Vul je naam in.' });
  if (wachtwoord.length < 10) {
    return res.status(400).json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' });
  }
  if (db.prepare('SELECT 1 FROM gebruikers WHERE email = ?').get(uitnodiging.email)) {
    return res.status(409).json({ fout: 'Er bestaat al een account met dit e-mailadres.' });
  }

  const maakAan = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO gebruikers (email, naam, wachtwoord_hash, rol) VALUES (?, ?, ?, ?)'
    ).run(uitnodiging.email, naam, hashWachtwoord(wachtwoord), uitnodiging.rol);

    db.prepare("UPDATE uitnodigingen SET gebruikt_op = datetime('now') WHERE token = ?").run(token);
    zorgVoorPriveLijst(r.lastInsertRowid);   // iedereen begint met een eigen lijst
    return r.lastInsertRowid;
  });

  maakSessie(res, maakAan());
  res.json({ ok: true });
});

api.get('/uitnodigingen', vereistBeheerder, (req, res) => {
  res.json(db.prepare(
    `SELECT token, email, rol, verloopt_op, gebruikt_op
       FROM uitnodigingen
      WHERE gebruikt_op IS NULL
      ORDER BY aangemaakt_op DESC`
  ).all());
});

api.post('/uitnodigingen', vereistBeheerder, (req, res) => {
  const email = tekst(req.body.email, 160).toLowerCase();
  const rol = req.body.rol === 'beheerder' ? 'beheerder' : 'lid';

  if (!geldigEmail(email)) return res.status(400).json({ fout: 'Dat lijkt geen geldig e-mailadres.' });
  if (db.prepare('SELECT 1 FROM gebruikers WHERE email = ?').get(email)) {
    return res.status(409).json({ fout: 'Deze persoon heeft al een account.' });
  }

  // Al een openstaande uitnodiging? Dan geen tweede erbij: dat levert alleen
  // twee links op waarvan je niet weet welke je moet doorsturen. Verlopen of
  // ingetrokken uitnodigingen tellen niet mee.
  const openstaand = db.prepare(
    'SELECT 1 FROM uitnodigingen WHERE email = ? AND gebruikt_op IS NULL AND verloopt_op > ?'
  ).get(email, new Date().toISOString());

  if (openstaand) {
    return res.status(409).json({
      fout: 'Dit e-mailadres is al uitgenodigd. Trek de openstaande uitnodiging hieronder in als je een nieuwe wilt maken.',
    });
  }

  const token = randomBytes(24).toString('hex');
  const verloopt = new Date(Date.now() + 14 * 864e5).toISOString();

  db.prepare(
    'INSERT INTO uitnodigingen (token, email, rol, uitgenodigd_door, verloopt_op) VALUES (?, ?, ?, ?, ?)'
  ).run(token, email, rol, req.gebruiker.id, verloopt);

  // Bewust geen mail vanuit de app: je krijgt de link terug en stuurt hem zelf
  // door. Zie het kopje "Waarom er geen mail in zit" in de README.
  res.json({ token, email, rol });
});

api.delete('/uitnodigingen/:token', vereistBeheerder, (req, res) => {
  db.prepare('DELETE FROM uitnodigingen WHERE token = ? AND gebruikt_op IS NULL').run(req.params.token);
  res.json({ ok: true });
});

// ── Gebruikers ───────────────────────────────────────────────────────────

api.get('/gebruikers', vereistLogin, (req, res) => {
  res.json(db.prepare(
    `SELECT g.id, g.naam, g.email, g.rol, g.actief, g.mag_werkprocessen,
            EXISTS(SELECT 1 FROM borden b WHERE b.prive_van = g.id) AS heeft_takenlijst
       FROM gebruikers g ORDER BY g.actief DESC, g.naam COLLATE NOCASE`
  ).all());
});

api.patch('/gebruikers/:id', vereistBeheerder, (req, res) => {
  const id = Number(req.params.id);
  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(id);
  if (!gebruiker) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });

  const rol = req.body.rol === 'beheerder' ? 'beheerder' : req.body.rol === 'lid' ? 'lid' : gebruiker.rol;
  const actief = req.body.actief === undefined ? gebruiker.actief : (req.body.actief ? 1 : 0);

  // Jezelf degraderen of uitschakelen is een deur die maar één kant op gaat:
  // daarna heb je de rechten niet meer om het terug te draaien. Een collega-
  // beheerder kan het wel.
  if (id === req.gebruiker.id) {
    if (rol !== gebruiker.rol) {
      return res.status(400).json({ fout: 'Je kunt je eigen rol niet wijzigen. Vraag een andere beheerder.' });
    }
    if (!actief) {
      return res.status(400).json({ fout: 'Je kunt jezelf niet uitschakelen. Vraag een andere beheerder.' });
    }
  }

  // Voorkom dat de laatste beheerder zichzelf buitensluit.
  const beheerders = db.prepare("SELECT COUNT(*) AS n FROM gebruikers WHERE rol = 'beheerder' AND actief = 1").get().n;
  const verliestRechten = gebruiker.rol === 'beheerder' && gebruiker.actief && (rol !== 'beheerder' || !actief);
  if (verliestRechten && beheerders <= 1) {
    return res.status(400).json({ fout: 'Er moet minstens één actieve beheerder overblijven.' });
  }

  const magWerkprocessen = req.body.mag_werkprocessen === undefined
    ? gebruiker.mag_werkprocessen
    : (req.body.mag_werkprocessen ? 1 : 0);

  // Een beheerder mag de naam van een collega herstellen; een lege naam niet.
  let naam = gebruiker.naam;
  if (req.body.naam !== undefined) {
    naam = tekst(req.body.naam, 80);
    if (!naam) return res.status(400).json({ fout: 'Vul een naam in.' });
  }

  db.prepare('UPDATE gebruikers SET naam = ?, rol = ?, actief = ?, mag_werkprocessen = ? WHERE id = ?')
    .run(naam, rol, actief, magWerkprocessen, id);

  if (!actief) db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(id);

  // Komt iemand terug in dienst en is zijn takenlijst intussen overgenomen,
  // dan krijgt hij hier een nieuwe. Bij het opstarten gebeurt dat alleen voor
  // wie actief is, dus zonder dit zou hij tot de eerstvolgende herstart zonder
  // takenlijst zitten.
  if (actief && !gebruiker.actief) zorgVoorPriveLijst(id);

  res.json({ ok: true });
});

// Wachtwoord vergeten: een beheerder maakt een herstellink aan en geeft die
// persoonlijk door. Juist deze link mailen we niet — hij geeft toegang tot een
// bestaand account.
api.post('/gebruikers/:id/herstel', vereistBeheerder, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM gebruikers WHERE id = ?').get(id)) {
    return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });
  }

  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO herstel (token, gebruiker_id, verloopt_op) VALUES (?, ?, ?)')
    .run(token, id, new Date(Date.now() + 2 * 864e5).toISOString());

  res.json({ token });
});

api.get('/herstel/:token', (req, res) => {
  const geblokkeerd = tokenRem(req, res);
  if (geblokkeerd) return geblokkeerd;

  const rij = db.prepare(
    `SELECT h.gebruikt_op, h.verloopt_op, g.naam, g.email
       FROM herstel h JOIN gebruikers g ON g.id = h.gebruiker_id
      WHERE h.token = ?`
  ).get(req.params.token);

  if (!rij || rij.gebruikt_op || new Date(rij.verloopt_op) < new Date()) {
    telFout(`token:${req.ip}`);
    return res.status(404).json({ fout: 'Deze herstellink is niet meer geldig.' });
  }
  res.json({ naam: rij.naam, email: rij.email });
});

api.post('/herstel', (req, res) => {
  const token = tekst(req.body.token, 100);
  const wachtwoord = String(req.body.wachtwoord ?? '');

  const rij = db.prepare('SELECT * FROM herstel WHERE token = ?').get(token);
  if (!rij || rij.gebruikt_op || new Date(rij.verloopt_op) < new Date()) {
    return res.status(404).json({ fout: 'Deze herstellink is niet meer geldig.' });
  }
  if (wachtwoord.length < 10) {
    return res.status(400).json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' });
  }

  db.transaction(() => {
    db.prepare('UPDATE gebruikers SET wachtwoord_hash = ? WHERE id = ?')
      .run(hashWachtwoord(wachtwoord), rij.gebruiker_id);
    db.prepare("UPDATE herstel SET gebruikt_op = datetime('now') WHERE token = ?").run(token);
    // Oude sessies ongeldig maken: wie nog ingelogd was, moet opnieuw inloggen.
    db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(rij.gebruiker_id);
  })();

  maakSessie(res, rij.gebruiker_id);
  res.json({ ok: true });
});

// Je eigen naam wijzigen. De naam staat op één plek en wordt overal live
// opgehaald, dus een wijziging werkt meteen door bij taken en opmerkingen.
api.patch('/mij', vereistLogin, (req, res) => {
  const naam = tekst(req.body.naam, 80);
  if (!naam) return res.status(400).json({ fout: 'Vul je naam in.' });

  db.prepare('UPDATE gebruikers SET naam = ? WHERE id = ?').run(naam, req.gebruiker.id);
  res.json({ naam });
});

api.post('/wachtwoord', vereistLogin, (req, res) => {
  const huidig = String(req.body.huidig ?? '');
  const nieuw = String(req.body.nieuw ?? '');

  // Ook hier een rem: dit is de tweede plek waar je een wachtwoord kunt raden.
  const sleutel = `wachtwoord:${req.gebruiker.id}`;
  const wacht = wachtNog(sleutel, GRENZEN.inloggenPerAdres);
  if (wacht !== null) return res.status(429).json({ fout: teVeelMelding(wacht) });

  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(req.gebruiker.id);
  if (!wachtwoordKlopt(huidig, gebruiker.wachtwoord_hash)) {
    telFout(sleutel);
    return res.status(403).json({ fout: 'Je huidige wachtwoord klopt niet.' });
  }
  if (nieuw.length < 10) {
    return res.status(400).json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' });
  }

  db.transaction(() => {
    db.prepare('UPDATE gebruikers SET wachtwoord_hash = ? WHERE id = ?')
      .run(hashWachtwoord(nieuw), gebruiker.id);

    // Alle sessies eruit, ook die van jezelf: verander je je wachtwoord omdat je
    // vermoedt dat iemand meekijkt, dan moet die meekijker er meteen uit en niet
    // pas over dertig dagen. Hieronder krijg je zelf meteen een nieuwe, dus in je
    // eigen scherm merk je er niets van. Zo doet de herstellink het ook.
    db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(gebruiker.id);
  })();

  vergeet(sleutel);
  maakSessie(res, gebruiker.id);
  res.json({ ok: true });
});

// ── Borden ───────────────────────────────────────────────────────────────

api.get('/borden', vereistLogin, (req, res) => {
  const borden = db.prepare(
    `SELECT b.id, b.naam, b.gearchiveerd, b.zichtbaar_voor_iedereen, b.aangemaakt_door, b.prive_van,
            (SELECT COUNT(*) FROM taken t WHERE t.bord_id = b.id) AS aantal_taken
       FROM borden b
      WHERE CASE WHEN b.prive_van IS NOT NULL
                 THEN b.prive_van = ?              -- alleen je eigen lijst
                 ELSE ? = 1
                      OR b.zichtbaar_voor_iedereen = 1
                      OR EXISTS (SELECT 1 FROM bord_leden bl
                                  WHERE bl.bord_id = b.id AND bl.gebruiker_id = ?)
            END
      ORDER BY b.gearchiveerd, b.positie, b.id`
  ).all(req.gebruiker.id, req.gebruiker.rol === 'beheerder' ? 1 : 0, req.gebruiker.id);

  res.json(borden.map((bord) => ({ ...bord, mag_beheren: magBeheren(req.gebruiker, bord) })));
});

api.post('/borden', vereistLogin, (req, res) => {
  const naam = tekst(req.body.naam, 80);
  if (!naam) return res.status(400).json({ fout: 'Geef het bord een naam.' });

  // Standaard voor iedereen zichtbaar; beperken doe je daarna bij de instellingen.
  const r = db.prepare('INSERT INTO borden (naam, aangemaakt_door) VALUES (?, ?)')
    .run(naam, req.gebruiker.id);

  res.json({ id: r.lastInsertRowid, naam });
});

/** Instellingen van één bord, inclusief wie het mag zien. */
api.get('/borden/:id/instellingen', vereistLogin, (req, res) => {
  const bord = zichtbaarBord(req.gebruiker, req.params.id);
  if (!bord) return res.status(404).json({ fout: 'Bord niet gevonden.' });

  res.json({
    id: bord.id,
    naam: bord.naam,
    zichtbaar_voor_iedereen: Boolean(bord.zichtbaar_voor_iedereen),
    leden: db.prepare('SELECT gebruiker_id FROM bord_leden WHERE bord_id = ?').all(bord.id)
      .map((r) => r.gebruiker_id),
    mag_beheren: magBeheren(req.gebruiker, bord),
  });
});

api.patch('/borden/:id', vereistLogin, (req, res) => {
  const bord = zichtbaarBord(req.gebruiker, req.params.id);
  if (!bord) return res.status(404).json({ fout: 'Bord niet gevonden.' });
  if (!magBeheren(req.gebruiker, bord)) {
    return res.status(403).json({ fout: 'Alleen een beheerder of de maker van dit bord kan dit wijzigen.' });
  }

  const naam = req.body.naam === undefined ? bord.naam : tekst(req.body.naam, 80) || bord.naam;
  const gearchiveerd = req.body.gearchiveerd === undefined ? bord.gearchiveerd : (req.body.gearchiveerd ? 1 : 0);
  const voorIedereen = req.body.zichtbaar_voor_iedereen === undefined
    ? bord.zichtbaar_voor_iedereen
    : (req.body.zichtbaar_voor_iedereen ? 1 : 0);

  db.transaction(() => {
    db.prepare('UPDATE borden SET naam = ?, gearchiveerd = ?, zichtbaar_voor_iedereen = ? WHERE id = ?')
      .run(naam, gearchiveerd, voorIedereen, bord.id);

    if (voorIedereen) {
      // Zichtbaar voor iedereen: dan doet de lijst er niet meer toe.
      db.prepare('DELETE FROM bord_leden WHERE bord_id = ?').run(bord.id);
      return;
    }

    if (req.body.leden === undefined) return;

    const gekozen = new Set((req.body.leden ?? []).map(Number).filter(Boolean));

    // Wie hier een taak heeft staan, houdt toegang. Anders zou iemand werk
    // toegewezen krijgen op een bord dat hij niet meer kan openen.
    for (const rij of db.prepare(
      'SELECT DISTINCT uitvoerend_id FROM taken WHERE bord_id = ? AND uitvoerend_id IS NOT NULL'
    ).all(bord.id)) gekozen.add(rij.uitvoerend_id);

    // En wie het bord beheert, raakt zijn eigen bord niet kwijt.
    gekozen.add(req.gebruiker.id);
    if (bord.aangemaakt_door) gekozen.add(bord.aangemaakt_door);

    db.prepare('DELETE FROM bord_leden WHERE bord_id = ?').run(bord.id);
    const voegToe = db.prepare('INSERT OR IGNORE INTO bord_leden (bord_id, gebruiker_id) VALUES (?, ?)');
    for (const id of gekozen) {
      if (db.prepare('SELECT 1 FROM gebruikers WHERE id = ?').get(id)) voegToe.run(bord.id, id);
    }
  })();

  res.json({ ok: true });
});

api.delete('/borden/:id', vereistLogin, (req, res) => {
  const bord = zichtbaarBord(req.gebruiker, req.params.id);
  if (!bord) return res.status(404).json({ fout: 'Bord niet gevonden.' });
  if (!magBeheren(req.gebruiker, bord)) {
    return res.status(403).json({ fout: 'Alleen een beheerder of de maker van dit bord kan het verwijderen.' });
  }

  const bestanden = db.prepare(
    `SELECT bl.opslagnaam FROM bijlagen bl
       JOIN taken t ON t.id = bl.taak_id
      WHERE t.bord_id = ?`
  ).all(bord.id);

  db.prepare('DELETE FROM borden WHERE id = ?').run(bord.id);
  bestanden.forEach((b) => verwijderBestand(b.opslagnaam));

  res.json({ ok: true });
});

// ── Taken ────────────────────────────────────────────────────────────────

// Voortgang van de gekoppelde werkprocessen, om op de kaart en in de tabel te tonen.
// Eén beschrijving van een bijlage, zodat url overal meekomt. Is url gevuld,
// dan is het een link en niet een bestand.
const BIJLAGE_SELECT = `
  SELECT b.id, b.bestandsnaam, b.type, b.grootte, b.url, b.aangemaakt_op,
         b.geupload_door, g.naam AS geupload_door_naam
    FROM bijlagen b LEFT JOIN gebruikers g ON g.id = b.geupload_door`;

const STAP_TELLERS = `
  (SELECT COUNT(*) FROM taak_stappen ts
     JOIN taak_processen tp ON tp.id = ts.taak_proces_id
    WHERE tp.taak_id = t.id) AS aantal_stappen,
  (SELECT COUNT(*) FROM taak_stappen ts
     JOIN taak_processen tp ON tp.id = ts.taak_proces_id
    WHERE tp.taak_id = t.id AND ts.afgevinkt_op IS NOT NULL) AS aantal_afgevinkt`;

const TAAK_SELECT = `
  SELECT t.id, t.bord_id, t.opdracht, t.uitvoerend_id, t.status, t.prioriteit, t.deadline,
         t.omschrijving, t.positie, t.aangemaakt_op, t.gewijzigd_op,
         g.naam AS uitvoerend_naam,
         (SELECT COUNT(*) FROM opmerkingen o WHERE o.taak_id = t.id) AS aantal_opmerkingen,
         (SELECT COUNT(*) FROM bijlagen bl WHERE bl.taak_id = t.id) AS aantal_bijlagen,
         ${STAP_TELLERS}
    FROM taken t
    LEFT JOIN gebruikers g ON g.id = t.uitvoerend_id
`;

api.get('/borden/:id/taken', vereistLogin, (req, res) => {
  const bord = zichtbaarBord(req.gebruiker, req.params.id);
  if (!bord) return res.status(404).json({ fout: 'Bord niet gevonden.' });

  res.json(db.prepare(`${TAAK_SELECT} WHERE t.bord_id = ? ORDER BY t.positie, t.id`).all(bord.id));
});

/**
 * Het persoonlijke bord: alle taken die aan jou zijn toegewezen, uit alle
 * projecten bij elkaar. Alleen van jezelf — niemand kan het bord van een ander
 * opvragen, want er is geen adres om dat mee te vragen.
 */
api.get('/mijn-taken', vereistLogin, (req, res) => {
  res.json(db.prepare(
    `SELECT t.id, t.bord_id, t.opdracht, t.uitvoerend_id, t.status, t.prioriteit, t.deadline,
            t.omschrijving, t.positie, t.aangemaakt_op, t.gewijzigd_op,
            g.naam AS uitvoerend_naam,
            b.naam AS bord_naam,
            (SELECT COUNT(*) FROM opmerkingen o WHERE o.taak_id = t.id) AS aantal_opmerkingen,
            (SELECT COUNT(*) FROM bijlagen bl WHERE bl.taak_id = t.id) AS aantal_bijlagen,
            ${STAP_TELLERS}
       FROM taken t
       JOIN borden b ON b.id = t.bord_id
       LEFT JOIN gebruikers g ON g.id = t.uitvoerend_id
      WHERE t.uitvoerend_id = ?
      ORDER BY b.gearchiveerd, b.positie, b.id, t.positie, t.id`
  ).all(req.gebruiker.id));
});

api.post('/borden/:id/taken', vereistLogin, (req, res) => {
  const bord = zichtbaarBord(req.gebruiker, req.params.id);
  if (!bord) return res.status(404).json({ fout: 'Bord niet gevonden.' });
  const bordId = bord.id;

  const opdracht = tekst(req.body.opdracht, 200);
  if (!opdracht) return res.status(400).json({ fout: 'Geef de opdracht een naam.' });

  const status = STATUSSEN.includes(req.body.status) ? req.body.status : 'Not Started';
  const prioriteit = PRIORITEITEN.includes(req.body.prioriteit) ? req.body.prioriteit : null;
  // Op je eigen takenlijst ben jij per definitie de uitvoerder; zo komt de taak
  // ook meteen in het overzicht Mijn taken te staan.
  const uitvoerendId = req.body.uitvoerend_id
    ? Number(req.body.uitvoerend_id)
    : (bord.prive_van ? req.gebruiker.id : null);

  if (!magToegewezenWorden(bord, uitvoerendId)) {
    return res.status(400).json({ fout: 'Die persoon kan dit bord niet zien. Geef hem eerst toegang bij de bordinstellingen.' });
  }

  const onderaan = db.prepare('SELECT COALESCE(MAX(positie), 0) + 1 AS p FROM taken WHERE bord_id = ?').get(bordId).p;

  const r = db.prepare(
    `INSERT INTO taken (bord_id, opdracht, uitvoerend_id, status, prioriteit, deadline, omschrijving, positie, aangemaakt_door)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(bordId, opdracht, uitvoerendId, status, prioriteit, datumOfNull(req.body.deadline),
        tekst(req.body.omschrijving, 20000), onderaan, req.gebruiker.id);

  logHistorie(r.lastInsertRowid, req.gebruiker.id, 'aangemaakt', null, opdracht);
  res.json(db.prepare(`${TAAK_SELECT} WHERE t.id = ?`).get(r.lastInsertRowid));
});

api.get('/taken/:id', vereistLogin, (req, res) => {
  if (!zichtbareTaak(req.gebruiker, req.params.id)) {
    return res.status(404).json({ fout: 'Taak niet gevonden.' });
  }

  const id = Number(req.params.id);
  const taak = db.prepare(`${TAAK_SELECT} WHERE t.id = ?`).get(id);

  taak.opmerkingen = db.prepare(
    `SELECT o.id, o.tekst, o.aangemaakt_op, o.gebruiker_id, g.naam AS gebruiker_naam
       FROM opmerkingen o LEFT JOIN gebruikers g ON g.id = o.gebruiker_id
      WHERE o.taak_id = ? ORDER BY o.aangemaakt_op, o.id`
  ).all(id);

  taak.processen = processenVan(id);

  taak.bijlagen = db.prepare(
    `${BIJLAGE_SELECT} WHERE b.taak_id = ? ORDER BY b.aangemaakt_op, b.id`
  ).all(id);

  taak.historie = db.prepare(
    `SELECT h.veld, h.oude_waarde, h.nieuwe_waarde, h.aangemaakt_op, g.naam AS gebruiker_naam
       FROM historie h LEFT JOIN gebruikers g ON g.id = h.gebruiker_id
      WHERE h.taak_id = ? ORDER BY h.aangemaakt_op DESC, h.id DESC LIMIT 50`
  ).all(id);

  res.json(taak);
});

api.patch('/taken/:id', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  // Naar een ander project verplaatsen. Opmerkingen, historie en bijlagen hangen
  // aan de taak zelf en gaan dus vanzelf mee.
  const huidigBord = db.prepare('SELECT * FROM borden WHERE id = ?').get(taak.bord_id);
  let doelBord = huidigBord;

  if (req.body.bord_id !== undefined && Number(req.body.bord_id) !== taak.bord_id) {
    doelBord = zichtbaarBord(req.gebruiker, req.body.bord_id);
    if (!doelBord) {
      return res.status(400).json({ fout: 'Dat project bestaat niet, of je kunt het niet zien.' });
    }
    // Uit je eigen lijst naar een project mag; andersom niet. Anders kun je een
    // taak die collega's zien voor iedereen laten verdwijnen.
    if (doelBord.prive_van) {
      return res.status(400).json({ fout: 'Een taak kan niet naar een persoonlijke takenlijst verhuizen.' });
    }
  }

  // De uitvoerder moet het bord kunnen zien waar de taak terechtkomt.
  const uitvoerderNa = req.body.uitvoerend_id === undefined
    ? taak.uitvoerend_id
    : (req.body.uitvoerend_id ? Number(req.body.uitvoerend_id) : null);

  if (!magToegewezenWorden(doelBord, uitvoerderNa)) {
    const naam = db.prepare('SELECT naam FROM gebruikers WHERE id = ?').get(uitvoerderNa)?.naam ?? 'Die persoon';
    return res.status(400).json({
      fout: doelBord.id === taak.bord_id
        ? `${naam} kan dit project niet zien. Geef hem eerst toegang bij de projectinstellingen.`
        : `${naam} kan "${doelBord.naam}" niet zien. Geef hem daar eerst toegang, of haal hem van de taak af.`,
    });
  }

  const nieuw = {
    opdracht: req.body.opdracht === undefined ? taak.opdracht : (tekst(req.body.opdracht, 200) || taak.opdracht),
    uitvoerend_id: req.body.uitvoerend_id === undefined
      ? taak.uitvoerend_id
      : (req.body.uitvoerend_id ? Number(req.body.uitvoerend_id) : null),
    status: req.body.status === undefined
      ? taak.status
      : (STATUSSEN.includes(req.body.status) ? req.body.status : taak.status),
    // Een lege waarde is hier een geldige keuze: "geen prioriteit".
    prioriteit: req.body.prioriteit === undefined
      ? taak.prioriteit
      : (PRIORITEITEN.includes(req.body.prioriteit) ? req.body.prioriteit : null),
    deadline: req.body.deadline === undefined ? taak.deadline : datumOfNull(req.body.deadline),
    omschrijving: req.body.omschrijving === undefined ? taak.omschrijving : tekst(req.body.omschrijving, 20000),
  };

  // Alleen echte wijzigingen belanden in de historie.
  const namen = {
    opdracht: 'opdracht', uitvoerend_id: 'uitvoerend', status: 'status',
    prioriteit: 'prioriteit', deadline: 'deadline', omschrijving: 'omschrijving',
  };
  const naamVan = (id) => id ? (db.prepare('SELECT naam FROM gebruikers WHERE id = ?').get(id)?.naam ?? null) : null;
  const verhuist = doelBord.id !== taak.bord_id;

  db.transaction(() => {
    for (const veld of Object.keys(nieuw)) {
      if (nieuw[veld] === taak[veld]) continue;
      const toon = veld === 'uitvoerend_id' ? naamVan : (v) => v;
      logHistorie(taak.id, req.gebruiker.id, namen[veld], toon(taak[veld]), toon(nieuw[veld]));
    }

    if (verhuist) {
      logHistorie(taak.id, req.gebruiker.id, 'project', huidigBord.naam, doelBord.naam);
      // Onderaan het nieuwe project, zodat hij niet tussen bestaand werk inschuift.
      const onderaan = db.prepare('SELECT COALESCE(MAX(positie), 0) + 1 AS p FROM taken WHERE bord_id = ?')
        .get(doelBord.id).p;
      db.prepare('UPDATE taken SET bord_id = ?, positie = ? WHERE id = ?').run(doelBord.id, onderaan, taak.id);
    }

    db.prepare(
      `UPDATE taken SET opdracht = ?, uitvoerend_id = ?, status = ?, prioriteit = ?,
              deadline = ?, omschrijving = ?, gewijzigd_op = datetime('now')
         WHERE id = ?`
    ).run(nieuw.opdracht, nieuw.uitvoerend_id, nieuw.status, nieuw.prioriteit,
          nieuw.deadline, nieuw.omschrijving, taak.id);
  })();

  res.json(db.prepare(`${TAAK_SELECT} WHERE t.id = ?`).get(taak.id));
});

/**
 * Verplaatsen op het kanbanbord. De browser stuurt mee tussen welke twee kaarten
 * de taak is losgelaten; hier rekenen we de nieuwe positie uit.
 */
api.post('/taken/:id/verplaats', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  const status = STATUSSEN.includes(req.body.status) ? req.body.status : taak.status;
  const positieVan = (id) => id
    ? db.prepare('SELECT positie FROM taken WHERE id = ? AND bord_id = ?').get(Number(id), taak.bord_id)?.positie
    : undefined;

  const boven = positieVan(req.body.vorige_id);
  const onder = positieVan(req.body.volgende_id);

  let positie;
  if (boven !== undefined && onder !== undefined) positie = (boven + onder) / 2;
  else if (boven !== undefined) positie = boven + 0.5;
  else if (onder !== undefined) positie = onder - 0.5;
  else positie = taak.positie;

  db.transaction(() => {
    if (status !== taak.status) {
      logHistorie(taak.id, req.gebruiker.id, 'status', taak.status, status);
    }
    db.prepare("UPDATE taken SET status = ?, positie = ?, gewijzigd_op = datetime('now') WHERE id = ?")
      .run(status, positie, taak.id);

    // Posities weer op hele getallen zetten (1, 2, 3, ...). Anders worden de
    // tussenruimtes na veel slepen steeds kleiner en kunnen taken gelijk komen
    // te staan; zo blijft de volgorde altijd eenduidig.
    const opVolgorde = db.prepare('SELECT id FROM taken WHERE bord_id = ? ORDER BY positie, id').all(taak.bord_id);
    const zet = db.prepare('UPDATE taken SET positie = ? WHERE id = ?');
    opVolgorde.forEach((rij, index) => zet.run(index + 1, rij.id));
  })();

  res.json(db.prepare(`${TAAK_SELECT} WHERE t.id = ?`).get(taak.id));
});

api.delete('/taken/:id', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  // De databaseregels verdwijnen vanzelf, de bestanden op schijf niet.
  const bestanden = db.prepare('SELECT opslagnaam FROM bijlagen WHERE taak_id = ?').all(taak.id);
  db.prepare('DELETE FROM taken WHERE id = ?').run(taak.id);
  bestanden.forEach((b) => verwijderBestand(b.opslagnaam));

  res.json({ ok: true });
});

// ── Werkprocessen op een taak ────────────────────────────────────────────
// Koppelen maakt een kopie van de stappen zoals ze op dat moment zijn. Wijzigt
// of verdwijnt het origineel daarna, dan verandert er niets aan lopende taken.

function zichtbaarTaakProces(gebruiker, id) {
  const proces = db.prepare('SELECT * FROM taak_processen WHERE id = ?').get(Number(id));
  if (!proces) return null;
  return zichtbareTaak(gebruiker, proces.taak_id) ? proces : null;
}

const processenVan = (taakId) => {
  const processen = db.prepare(
    `SELECT p.id, p.werkproces_id, p.naam, p.versie, p.positie, p.aangemaakt_op,
            g.naam AS gekoppeld_door_naam
       FROM taak_processen p
       LEFT JOIN gebruikers g ON g.id = p.gekoppeld_door
      WHERE p.taak_id = ? ORDER BY p.positie, p.id`
  ).all(taakId);

  const stappenVanProces = db.prepare(
    `SELECT s.id, s.tekst, s.positie, s.afgevinkt_op, s.afgevinkt_door,
            g.naam AS afgevinkt_door_naam
       FROM taak_stappen s
       LEFT JOIN gebruikers g ON g.id = s.afgevinkt_door
      WHERE s.taak_proces_id = ? ORDER BY s.positie, s.id`
  );

  return processen.map((proces) => ({ ...proces, stappen: stappenVanProces.all(proces.id) }));
};

api.post('/taken/:id/processen', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  const werkproces = db.prepare('SELECT * FROM werkprocessen WHERE id = ?').get(Number(req.body.werkproces_id));
  if (!werkproces) return res.status(404).json({ fout: 'Werkproces niet gevonden.' });

  const stappen = db.prepare(
    'SELECT tekst FROM werkproces_stappen WHERE werkproces_id = ? ORDER BY positie, id'
  ).all(werkproces.id);

  if (stappen.length === 0) {
    return res.status(400).json({ fout: 'Dit werkproces heeft geen stappen.' });
  }

  const id = db.transaction(() => {
    const onderaan = db.prepare(
      'SELECT COALESCE(MAX(positie), 0) + 1 AS p FROM taak_processen WHERE taak_id = ?'
    ).get(taak.id).p;

    const r = db.prepare(
      `INSERT INTO taak_processen (taak_id, werkproces_id, naam, versie, positie, gekoppeld_door)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(taak.id, werkproces.id, werkproces.naam, werkproces.versie, onderaan, req.gebruiker.id);

    const voegToe = db.prepare('INSERT INTO taak_stappen (taak_proces_id, tekst, positie) VALUES (?, ?, ?)');
    stappen.forEach((stap, index) => voegToe.run(r.lastInsertRowid, stap.tekst, index + 1));

    return r.lastInsertRowid;
  })();

  logHistorie(taak.id, req.gebruiker.id, 'werkproces gekoppeld', null, `${werkproces.naam} (versie ${werkproces.versie})`);
  res.json({ id, naam: werkproces.naam, versie: werkproces.versie, aantal_stappen: stappen.length });
});

api.delete('/taak-processen/:id', vereistLogin, (req, res) => {
  const proces = zichtbaarTaakProces(req.gebruiker, req.params.id);
  if (!proces) return res.status(404).json({ fout: 'Werkproces niet gevonden bij deze taak.' });

  db.prepare('DELETE FROM taak_processen WHERE id = ?').run(proces.id);
  logHistorie(proces.taak_id, req.gebruiker.id, 'werkproces ontkoppeld', proces.naam, null);

  res.json({ ok: true });
});

/** De browser stuurt de nieuwe volgorde als lijst met ids. */
api.post('/taken/:id/processen/volgorde', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  const eigen = new Set(
    db.prepare('SELECT id FROM taak_processen WHERE taak_id = ?').all(taak.id).map((r) => r.id)
  );
  const volgorde = (req.body.volgorde ?? []).map(Number).filter((id) => eigen.has(id));

  if (volgorde.length !== eigen.size) {
    return res.status(400).json({ fout: 'De volgorde klopt niet met de gekoppelde werkprocessen.' });
  }

  const zet = db.prepare('UPDATE taak_processen SET positie = ? WHERE id = ?');
  db.transaction(() => volgorde.forEach((id, index) => zet.run(index + 1, id)))();

  res.json({ ok: true });
});

api.patch('/taak-stappen/:id', vereistLogin, (req, res) => {
  const stap = db.prepare('SELECT * FROM taak_stappen WHERE id = ?').get(Number(req.params.id));
  if (!stap || !zichtbaarTaakProces(req.gebruiker, stap.taak_proces_id)) {
    return res.status(404).json({ fout: 'Stap niet gevonden.' });
  }

  if (req.body.afgevinkt) {
    db.prepare("UPDATE taak_stappen SET afgevinkt_door = ?, afgevinkt_op = datetime('now') WHERE id = ?")
      .run(req.gebruiker.id, stap.id);
  } else {
    db.prepare('UPDATE taak_stappen SET afgevinkt_door = NULL, afgevinkt_op = NULL WHERE id = ?').run(stap.id);
  }

  res.json(db.prepare(
    `SELECT s.id, s.afgevinkt_op, s.afgevinkt_door, g.naam AS afgevinkt_door_naam
       FROM taak_stappen s LEFT JOIN gebruikers g ON g.id = s.afgevinkt_door WHERE s.id = ?`
  ).get(stap.id));
});

// ── Bijlagen ─────────────────────────────────────────────────────────────
// Het bestand komt als kale stroom binnen, met de naam in een header. Dat
// scheelt een pakket voor formulierupload en is goed te volgen.
//
// Op schijf krijgt elk bestand een willekeurige naam. De naam die de gebruiker
// koos bewaren we alleen in de database: zo kan niemand met een naam als
// "../../server.js" buiten de opslagmap schrijven.

const MAX_BIJLAGE = Number(process.env.MAX_BIJLAGE_MB || 10) * 1024 * 1024;
const MAX_PER_TAAK = 20;

function schoneBestandsnaam(ruw) {
  return String(ruw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')   // stuurtekens
    .replace(/[\\/]/g, '-')                  // padscheidingen
    .trim()
    .slice(0, 150);
}

/**
 * Haalt een bestand meteen van schijf, niet ergens later. Zo betekent een
 * geslaagd verzoek ook echt dat het bestand weg is. Al weg is ook goed.
 */
function verwijderBestand(opslagnaam) {
  try {
    unlinkSync(join(BIJLAGEMAP, opslagnaam));
  } catch {
    // Bestond niet meer; niets aan de hand.
  }
}

api.post('/taken/:id/bijlagen', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  const bestandsnaam = schoneBestandsnaam(decodeURIComponent(req.get('x-bestandsnaam') || ''));
  if (!bestandsnaam) return res.status(400).json({ fout: 'De naam van het bestand ontbreekt.' });

  const aantal = db.prepare('SELECT COUNT(*) AS n FROM bijlagen WHERE taak_id = ?').get(taak.id).n;
  if (aantal >= MAX_PER_TAAK) {
    return res.status(400).json({ fout: `Er passen maximaal ${MAX_PER_TAAK} bestanden bij één taak.` });
  }

  const teGroot = `Dit bestand is te groot. Maximaal ${Math.round(MAX_BIJLAGE / 1024 / 1024)} MB per bestand.`;

  /**
   * Weigeren terwijl de browser nog aan het versturen is.
   *
   * Antwoorden en meteen ophangen lijkt logisch, maar dan blijft er ongelezen
   * data op de verbinding staan en loopt het volgende verzoek daarop stuk. We
   * lezen de rest daarom uit en gooien die weg, en antwoorden pas daarna. Dan
   * blijft de verbinding schoon.
   */
  const stopMet = (status, fout) => {
    let geantwoord = false;
    const antwoord = () => {
      if (geantwoord) return;
      geantwoord = true;
      res.status(status).json({ fout });
    };

    // Is alles al binnen — bijvoorbeeld bij een leeg bestand — dan valt er niets
    // meer af te wachten en kunnen we meteen antwoorden.
    if (req.complete || req.readableEnded) return antwoord();

    let weggegooid = 0;
    req.on('data', (stuk) => {
      weggegooid += stuk.length;
      // Noodrem: blijft er onzinnig veel komen, dan toch de verbinding dicht.
      if (weggegooid > 5 * MAX_BIJLAGE) {
        if (!res.headersSent) res.setHeader('connection', 'close');
        antwoord();
        req.destroy();
      }
    });

    req.on('end', antwoord);
    req.on('close', antwoord);
    req.on('error', antwoord);
    req.resume();
  };

  // De browser stuurt vooraf hoe groot het bestand is. Dan hoeven we een te
  // groot bestand niet eerst helemaal naar schijf te schrijven.
  if (Number(req.get('content-length')) > MAX_BIJLAGE) {
    return stopMet(413, teGroot);
  }

  const opslagnaam = randomBytes(16).toString('hex');
  const schrijver = createWriteStream(join(BIJLAGEMAP, opslagnaam));
  let bytes = 0;
  let afgebroken = false;

  const afbreken = (status, fout) => {
    if (afgebroken) return;
    afgebroken = true;
    req.unpipe(schrijver);
    schrijver.destroy();
    verwijderBestand(opslagnaam);
    stopMet(status, fout);
  };

  req.on('data', (stuk) => {
    bytes += stuk.length;
    if (bytes > MAX_BIJLAGE) afbreken(413, teGroot);
  });

  req.on('aborted', () => afbreken(400, 'De upload is afgebroken.'));
  schrijver.on('error', () => afbreken(500, 'Opslaan is mislukt.'));

  schrijver.on('finish', () => {
    if (afgebroken) return;
    if (bytes === 0) return afbreken(400, 'Het bestand is leeg.');

    const r = db.prepare(
      `INSERT INTO bijlagen (taak_id, bestandsnaam, opslagnaam, type, grootte, geupload_door)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(taak.id, bestandsnaam, opslagnaam, tekst(req.get('x-bestandstype'), 100) || null, bytes, req.gebruiker.id);

    logHistorie(taak.id, req.gebruiker.id, 'bijlage toegevoegd', null, bestandsnaam);
    res.json(db.prepare(`${BIJLAGE_SELECT} WHERE b.id = ?`).get(r.lastInsertRowid));
  });

  req.pipe(schrijver);
});

/**
 * Een link als bijlage, bijvoorbeeld naar OneDrive voor bestanden die te groot
 * zijn om te uploaden. Alleen http en https: een bijlage is zichtbaar voor
 * iedereen die de taak mag zien, en een 'javascript:'-adres zou code kunnen
 * uitvoeren in de browser van je collega.
 */
function leesLink(waarde) {
  let ruw = tekst(waarde, 2000);
  if (!ruw) return { fout: 'Vul een adres in.' };

  // Zonder protocol ervoor bedoelt bijna iedereen https.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(ruw)) ruw = 'https://' + ruw;

  let adres;
  try {
    adres = new URL(ruw);
  } catch {
    return { fout: 'Dit is geen geldig webadres.' };
  }
  if (adres.protocol !== 'http:' && adres.protocol !== 'https:') {
    return { fout: 'Alleen adressen die met http:// of https:// beginnen.' };
  }
  return { url: adres.href, host: adres.host };
}

api.post('/taken/:id/bijlagen/link', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  const { url, host, fout } = leesLink(req.body.url);
  if (fout) return res.status(400).json({ fout });

  // Geen naam ingevuld? Dan zegt de bestemming genoeg.
  const naam = tekst(req.body.naam, 200) || host;

  const r = db.prepare(
    `INSERT INTO bijlagen (taak_id, bestandsnaam, opslagnaam, type, grootte, url, geupload_door)
     VALUES (?, ?, '', NULL, 0, ?, ?)`
  ).run(taak.id, naam, url, req.gebruiker.id);

  logHistorie(taak.id, req.gebruiker.id, 'link toegevoegd', null, naam);
  res.json(db.prepare(`${BIJLAGE_SELECT} WHERE b.id = ?`).get(r.lastInsertRowid));
});

/** Alle bijlagen van één taak in één ZIP. */
api.get('/taken/:id/bijlagen.zip', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });

  const bijlagen = db.prepare(
    'SELECT bestandsnaam, opslagnaam, grootte, url FROM bijlagen WHERE taak_id = ? ORDER BY aangemaakt_op, id'
  ).all(taak.id);

  if (bijlagen.length === 0) {
    return res.status(404).json({ fout: 'Deze taak heeft geen bijlagen.' });
  }

  // Alles gaat door het geheugen, dus een bovengrens is op zijn plaats.
  const totaal = bijlagen.reduce((som, b) => som + b.grootte, 0);
  if (totaal > 200 * 1024 * 1024) {
    return res.status(413).json({ fout: 'De bijlagen zijn samen te groot om in één keer te downloaden. Haal ze los op.' });
  }

  const bestanden = [];
  for (const bijlage of bijlagen.filter(b => !b.url)) {
    try {
      bestanden.push({ naam: bijlage.bestandsnaam, inhoud: readFileSync(join(BIJLAGEMAP, bijlage.opslagnaam)) });
    } catch {
      // Bestand ontbreekt op schijf; de rest hoeft er niet onder te lijden.
    }
  }

  // Een link kun je niet inpakken, maar hem stilzwijgend weglaten zou betekenen
  // dat je informatie mist zonder het te merken. Vandaar een tekstbestandje.
  const links = bijlagen.filter(b => b.url);
  if (links.length > 0) {
    const regels = ['Links bij deze taak', '='.repeat(19), ''];
    for (const link of links) regels.push(link.bestandsnaam, link.url, '');
    bestanden.push({ naam: 'Links.txt', inhoud: Buffer.from(regels.join('\r\n'), 'utf8') });
  }

  if (bestanden.length === 0) {
    return res.status(404).json({ fout: 'De bestanden staan niet meer op de server.' });
  }

  const zip = maakZip(bestanden);
  const naam = `${taak.opdracht.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'taak'} - bijlagen.zip`;

  res.setHeader('content-type', 'application/zip');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-length', zip.length);
  res.setHeader(
    'content-disposition',
    `attachment; filename="${naam.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(naam)}`
  );

  res.end(zip);
});

api.get('/bijlagen/:id', vereistLogin, (req, res) => {
  const bijlage = db.prepare('SELECT * FROM bijlagen WHERE id = ?').get(Number(req.params.id));
  if (!bijlage || !zichtbareTaak(req.gebruiker, bijlage.taak_id)) {
    return res.status(404).json({ fout: 'Bijlage niet gevonden.' });
  }
  if (bijlage.url) {
    return res.status(400).json({ fout: 'Dit is een link, geen bestand. Open hem vanuit de taak.' });
  }

  const pad = join(BIJLAGEMAP, bijlage.opslagnaam);
  try {
    statSync(pad);
  } catch {
    return res.status(404).json({ fout: 'Het bestand staat niet meer op de server.' });
  }

  // Altijd downloaden, nooit tonen in het scherm. Een geüpload html- of
  // svg-bestand zou anders als pagina van deze site kunnen draaien, en dan bij
  // de sessie van de kijker kunnen komen.
  const veiligeNaam = bijlage.bestandsnaam.replace(/["\\]/g, '');
  res.setHeader('content-type', 'application/octet-stream');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-length', bijlage.grootte);
  res.setHeader(
    'content-disposition',
    `attachment; filename="${veiligeNaam.replace(/[^\x20-\x7e]/g, '_')}"; ` +
    `filename*=UTF-8''${encodeURIComponent(bijlage.bestandsnaam)}`
  );

  createReadStream(pad).pipe(res);
});

api.delete('/bijlagen/:id', vereistLogin, (req, res) => {
  const bijlage = db.prepare('SELECT * FROM bijlagen WHERE id = ?').get(Number(req.params.id));
  if (!bijlage) return res.json({ ok: true });

  const taak = zichtbareTaak(req.gebruiker, bijlage.taak_id);
  if (!taak) return res.status(404).json({ fout: 'Bijlage niet gevonden.' });

  db.prepare('DELETE FROM bijlagen WHERE id = ?').run(bijlage.id);
  if (!bijlage.url) verwijderBestand(bijlage.opslagnaam);   // bij een link staat er niets op schijf
  logHistorie(taak.id, req.gebruiker.id,
    bijlage.url ? 'link verwijderd' : 'bijlage verwijderd', bijlage.bestandsnaam, null);

  res.json({ ok: true });
});

// ── Werkprocessen ────────────────────────────────────────────────────────
// De bibliotheek met vaste werkwijzen. Iedereen mag kijken; beheren mag een
// beheerder en wie dat recht heeft gekregen.

function magWerkprocessenBeheren(gebruiker) {
  return gebruiker.rol === 'beheerder' || gebruiker.mag_werkprocessen;
}

function vereistWerkprocesRecht(req, res, next) {
  if (!req.gebruiker) return res.status(401).json({ fout: 'Je bent niet ingelogd.' });
  if (!magWerkprocessenBeheren(req.gebruiker)) {
    return res.status(403).json({ fout: 'Je hebt geen recht om werkprocessen te beheren. Vraag een beheerder om dat aan te zetten.' });
  }
  next();
}

/** Controleert de stappen die de browser stuurt. Vertrouw nooit de voorvertoning. */
function controleerStappen(ruw) {
  if (!Array.isArray(ruw)) return { fout: 'Er zijn geen stappen meegestuurd.' };

  const stappen = ruw
    .map((stap) => tekst(stap, MAX_STAP_TEKENS))
    .filter((stap) => stap.length > 0);

  if (stappen.length === 0) {
    return { fout: 'Er zijn geen stappen gevonden. Plak een lijst met één stap per regel.' };
  }
  if (stappen.length > MAX_STAPPEN) {
    return { fout: `Dit werkproces heeft ${stappen.length} stappen. Er passen er maximaal ${MAX_STAPPEN} in.` };
  }
  return { stappen };
}

function schrijfStappen(werkprocesId, stappen) {
  db.prepare('DELETE FROM werkproces_stappen WHERE werkproces_id = ?').run(werkprocesId);
  const voegToe = db.prepare('INSERT INTO werkproces_stappen (werkproces_id, tekst, positie) VALUES (?, ?, ?)');
  stappen.forEach((stap, index) => voegToe.run(werkprocesId, stap, index + 1));
}

const stappenVan = (werkprocesId) => db
  .prepare('SELECT tekst FROM werkproces_stappen WHERE werkproces_id = ? ORDER BY positie, id')
  .all(werkprocesId).map((rij) => rij.tekst);

api.get('/werkprocessen', vereistLogin, (req, res) => {
  res.json({
    mag_beheren: magWerkprocessenBeheren(req.gebruiker),
    werkprocessen: db.prepare(
      `SELECT w.id, w.naam, w.toelichting, w.versie, w.aangemaakt_op, w.gewijzigd_op,
              g.naam AS aangemaakt_door_naam,
              (SELECT COUNT(*) FROM werkproces_stappen s WHERE s.werkproces_id = w.id) AS aantal_stappen
         FROM werkprocessen w
         LEFT JOIN gebruikers g ON g.id = w.aangemaakt_door
        ORDER BY w.naam COLLATE NOCASE`
    ).all(),
  });
});

api.get('/werkprocessen/:id', vereistLogin, (req, res) => {
  const werkproces = db.prepare('SELECT * FROM werkprocessen WHERE id = ?').get(Number(req.params.id));
  if (!werkproces) return res.status(404).json({ fout: 'Werkproces niet gevonden.' });

  res.json({ ...werkproces, stappen: stappenVan(werkproces.id) });
});

api.post('/werkprocessen', vereistWerkprocesRecht, (req, res) => {
  const naam = tekst(req.body.naam, 120);
  if (!naam) return res.status(400).json({ fout: 'Geef het werkproces een naam.' });

  if (db.prepare('SELECT 1 FROM werkprocessen WHERE naam = ?').get(naam)) {
    return res.status(409).json({ fout: `Er bestaat al een werkproces met de naam "${naam}".` });
  }

  const gecontroleerd = controleerStappen(req.body.stappen);
  if (gecontroleerd.fout) return res.status(400).json({ fout: gecontroleerd.fout });

  const id = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO werkprocessen (naam, toelichting, aangemaakt_door) VALUES (?, ?, ?)'
    ).run(naam, tekst(req.body.toelichting, 300), req.gebruiker.id);

    schrijfStappen(r.lastInsertRowid, gecontroleerd.stappen);
    return r.lastInsertRowid;
  })();

  res.json({ id, naam, versie: 1 });
});

api.patch('/werkprocessen/:id', vereistWerkprocesRecht, (req, res) => {
  const werkproces = db.prepare('SELECT * FROM werkprocessen WHERE id = ?').get(Number(req.params.id));
  if (!werkproces) return res.status(404).json({ fout: 'Werkproces niet gevonden.' });

  const naam = req.body.naam === undefined ? werkproces.naam : tekst(req.body.naam, 120);
  if (!naam) return res.status(400).json({ fout: 'Geef het werkproces een naam.' });

  const bezet = db.prepare('SELECT 1 FROM werkprocessen WHERE naam = ? AND id != ?').get(naam, werkproces.id);
  if (bezet) return res.status(409).json({ fout: `Er bestaat al een werkproces met de naam "${naam}".` });

  const toelichting = req.body.toelichting === undefined
    ? werkproces.toelichting
    : tekst(req.body.toelichting, 300);

  // Alleen een echte wijziging in de stappen hoogt de versie op. De naam of de
  // toelichting bijwerken is geen nieuwe werkwijze.
  let versie = werkproces.versie;
  let nieuweStappen = null;

  if (req.body.stappen !== undefined) {
    const gecontroleerd = controleerStappen(req.body.stappen);
    if (gecontroleerd.fout) return res.status(400).json({ fout: gecontroleerd.fout });

    const huidige = stappenVan(werkproces.id);
    const verschilt = gecontroleerd.stappen.length !== huidige.length
      || gecontroleerd.stappen.some((stap, index) => stap !== huidige[index]);

    if (verschilt) {
      nieuweStappen = gecontroleerd.stappen;
      versie += 1;
    }
  }

  db.transaction(() => {
    db.prepare(
      "UPDATE werkprocessen SET naam = ?, toelichting = ?, versie = ?, gewijzigd_op = datetime('now') WHERE id = ?"
    ).run(naam, toelichting, versie, werkproces.id);

    if (nieuweStappen) schrijfStappen(werkproces.id, nieuweStappen);
  })();

  res.json({ ok: true, versie });
});

api.delete('/werkprocessen/:id', vereistWerkprocesRecht, (req, res) => {
  db.prepare('DELETE FROM werkprocessen WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── Opmerkingen ──────────────────────────────────────────────────────────

api.post('/taken/:id/opmerkingen', vereistLogin, (req, res) => {
  const taak = zichtbareTaak(req.gebruiker, req.params.id);
  if (!taak) return res.status(404).json({ fout: 'Taak niet gevonden.' });
  const taakId = taak.id;

  const tekstInhoud = tekst(req.body.tekst, 5000);
  if (!tekstInhoud) return res.status(400).json({ fout: 'Typ eerst een opmerking.' });

  const r = db.prepare('INSERT INTO opmerkingen (taak_id, gebruiker_id, tekst) VALUES (?, ?, ?)')
    .run(taakId, req.gebruiker.id, tekstInhoud);

  res.json(db.prepare(
    `SELECT o.id, o.tekst, o.aangemaakt_op, o.gebruiker_id, g.naam AS gebruiker_naam
       FROM opmerkingen o LEFT JOIN gebruikers g ON g.id = o.gebruiker_id WHERE o.id = ?`
  ).get(r.lastInsertRowid));
});

api.delete('/opmerkingen/:id', vereistLogin, (req, res) => {
  const opmerking = db.prepare('SELECT * FROM opmerkingen WHERE id = ?').get(Number(req.params.id));
  if (!opmerking) return res.json({ ok: true });
  if (!zichtbareTaak(req.gebruiker, opmerking.taak_id)) {
    return res.status(404).json({ fout: 'Opmerking niet gevonden.' });
  }

  if (opmerking.gebruiker_id !== req.gebruiker.id && req.gebruiker.rol !== 'beheerder') {
    return res.status(403).json({ fout: 'Je kunt alleen je eigen opmerkingen verwijderen.' });
  }

  db.prepare('DELETE FROM opmerkingen WHERE id = ?').run(opmerking.id);
  res.json({ ok: true });
});

/**
 * De takenlijst van een vertrokken collega overnemen. Dit is de belofte die op
 * dat scherm staat: alleen jij ziet je lijst, maar als je uit dienst gaat kan
 * een beheerder hem overnemen zodat lopend werk niet blijft liggen.
 *
 * Alleen bij een uitgeschakelde collega. Dat is wat "uit dienst" hier betekent,
 * en het is de enige reden waarom die belofte geen achterdeur is: zolang iemand
 * gewoon werkt, komt er niemand bij zijn lijst.
 */
api.post('/gebruikers/:id/takenlijst-overnemen', vereistBeheerder, (req, res) => {
  const id = Number(req.params.id);
  const collega = db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(id);
  if (!collega) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });

  if (collega.actief) {
    return res.status(400).json({
      fout: 'Je kunt de takenlijst pas overnemen als deze collega is uitgeschakeld.',
    });
  }

  const lijst = db.prepare('SELECT * FROM borden WHERE prive_van = ?').get(id);
  if (!lijst) return res.status(404).json({ fout: 'Deze collega heeft geen eigen takenlijst (meer).' });

  const naam = `Takenlijst van ${collega.naam}`.slice(0, 80);

  db.transaction(() => {
    // Geen privélijst meer, maar een gewoon afgeschermd project van de
    // beheerder die hem overneemt.
    db.prepare(
      `UPDATE borden SET prive_van = NULL, naam = ?, zichtbaar_voor_iedereen = 0,
              aangemaakt_door = ? WHERE id = ?`
    ).run(naam, req.gebruiker.id, lijst.id);

    db.prepare('DELETE FROM bord_leden WHERE bord_id = ?').run(lijst.id);
    db.prepare('INSERT OR IGNORE INTO bord_leden (bord_id, gebruiker_id) VALUES (?, ?)')
      .run(lijst.id, req.gebruiker.id);

    // De taken stonden op naam van iemand die niet meer werkt. Die naam laten
    // staan zou de lijst laten lijken alsof er nog iemand mee bezig is; boven-
    // dien weigert de app een uitgeschakelde collega als uitvoerder, waardoor
    // je de taken daarna niet meer zou kunnen bewerken. Wie het was staat in
    // de naam van het project.
    db.prepare('UPDATE taken SET uitvoerend_id = NULL WHERE bord_id = ?').run(lijst.id);
  })();

  const aantal = db.prepare('SELECT COUNT(*) AS n FROM taken WHERE bord_id = ?').get(lijst.id).n;
  res.json({ id: lijst.id, naam, aantal_taken: aantal });
});

// ── Prikbord ─────────────────────────────────────────────────────────────
// Briefjes zijn van één persoon. Er is hier bewust géén uitzondering voor
// beheerders: een beheerder die een bord niet ziet kan het overnemen, maar bij
// naslag van een ander valt er niets over te nemen. Elke route zoekt daarom op
// id én gebruiker_id tegelijk, zodat het briefje van een ander simpelweg niet
// bestaat.
const BRIEFJE_SELECT = `SELECT id, titel, tekst, vastgepind, categorie_id, positie,
                               aangemaakt_op, gewijzigd_op, weggegooid_op FROM briefjes`;

function eigenBriefje(gebruiker, id) {
  return db.prepare(`${BRIEFJE_SELECT} WHERE id = ? AND gebruiker_id = ?`)
    .get(Number(id), gebruiker.id);
}

/**
 * Vastgepind bovenaan, daarbinnen je eigen volgorde. Een nieuw briefje krijgt
 * de laagste positie en komt dus bovenaan te staan.
 */
const MUUR_VOLGORDE = 'ORDER BY vastgepind DESC, positie, id DESC';

/** Bestaat deze categorie, en is hij van jou? */
function eigenCategorie(gebruiker, id) {
  return db.prepare('SELECT * FROM briefje_categorieen WHERE id = ? AND gebruiker_id = ?')
    .get(Number(id), gebruiker.id);
}

/**
 * Leest een categorie uit het verzoek. Geeft `undefined` als het veld er niet
 * in zat (dan blijft de huidige staan), `null` voor geen categorie, en anders
 * het nummer. Een categorie van iemand anders telt als geen categorie.
 */
function leesCategorie(gebruiker, waarde) {
  if (waarde === undefined) return undefined;
  if (!waarde) return null;
  return eigenCategorie(gebruiker, waarde) ? Number(waarde) : null;
}

api.get('/briefje-categorieen', vereistLogin, (req, res) => {
  res.json({
    categorieen: db.prepare(
      'SELECT id, naam, kleur FROM briefje_categorieen WHERE gebruiker_id = ? ORDER BY positie, id'
    ).all(req.gebruiker.id),
    kleuren: POSTIT_KLEUREN,
    maximum: MAX_CATEGORIEEN,
  });
});

api.post('/briefje-categorieen', vereistLogin, (req, res) => {
  const naam = tekst(req.body.naam, 40);
  if (!naam) return res.status(400).json({ fout: 'Geef de categorie een naam.' });

  const aantal = db.prepare('SELECT COUNT(*) AS n FROM briefje_categorieen WHERE gebruiker_id = ?')
    .get(req.gebruiker.id).n;
  if (aantal >= MAX_CATEGORIEEN) {
    return res.status(400).json({
      fout: `Meer dan ${MAX_CATEGORIEEN} categorieën kan niet: geel is voor briefjes zonder `
          + `categorie, dus er blijven ${MAX_CATEGORIEEN} post-it-kleuren over.`,
    });
  }

  // Standaard de eerste kleur die nog vrij is, zodat twee categorieën nooit
  // per ongeluk dezelfde kleur krijgen.
  const bezet = db.prepare('SELECT kleur FROM briefje_categorieen WHERE gebruiker_id = ?')
    .all(req.gebruiker.id).map((c) => c.kleur);
  const gevraagd = POSTIT_KLEUREN.some((k) => k.kleur === req.body.kleur) ? req.body.kleur : null;
  const kleur = gevraagd ?? POSTIT_KLEUREN.find((k) => !bezet.includes(k.kleur))?.kleur
             ?? POSTIT_KLEUREN[0].kleur;

  const r = db.prepare(
    'INSERT INTO briefje_categorieen (gebruiker_id, naam, kleur, positie) VALUES (?, ?, ?, ?)'
  ).run(req.gebruiker.id, naam, kleur, aantal + 1);

  res.json(db.prepare('SELECT id, naam, kleur FROM briefje_categorieen WHERE id = ?').get(r.lastInsertRowid));
});

api.patch('/briefje-categorieen/:id', vereistLogin, (req, res) => {
  const categorie = eigenCategorie(req.gebruiker, req.params.id);
  if (!categorie) return res.status(404).json({ fout: 'Categorie niet gevonden.' });

  const naam = req.body.naam === undefined ? categorie.naam : tekst(req.body.naam, 40);
  if (!naam) return res.status(400).json({ fout: 'Geef de categorie een naam.' });

  const kleur = POSTIT_KLEUREN.some((k) => k.kleur === req.body.kleur) ? req.body.kleur : categorie.kleur;

  db.prepare('UPDATE briefje_categorieen SET naam = ?, kleur = ? WHERE id = ?')
    .run(naam, kleur, categorie.id);

  res.json(db.prepare('SELECT id, naam, kleur FROM briefje_categorieen WHERE id = ?').get(categorie.id));
});

/** Verwijderen laat de briefjes staan; die vallen terug op geen categorie. */
api.delete('/briefje-categorieen/:id', vereistLogin, (req, res) => {
  const categorie = eigenCategorie(req.gebruiker, req.params.id);
  if (!categorie) return res.status(404).json({ fout: 'Categorie niet gevonden.' });

  db.transaction(() => {
    db.prepare('UPDATE briefjes SET categorie_id = NULL WHERE categorie_id = ?').run(categorie.id);
    db.prepare('DELETE FROM briefje_categorieen WHERE id = ?').run(categorie.id);
  })();

  res.json({ ok: true });
});

api.get('/briefjes', vereistLogin, (req, res) => {
  ruimPrullenbakOp();

  const vanMij = (voorwaarde) => db.prepare(
    `${BRIEFJE_SELECT} WHERE gebruiker_id = ? AND ${voorwaarde} ${MUUR_VOLGORDE}`
  ).all(req.gebruiker.id);

  res.json({
    briefjes: vanMij('weggegooid_op IS NULL'),
    prullenbak: vanMij('weggegooid_op IS NOT NULL'),
    prullenbak_dagen: PRULLENBAK_DAGEN,
  });
});

api.post('/briefjes', vereistLogin, (req, res) => {
  const titel = tekst(req.body.titel, 100);
  if (!titel) return res.status(400).json({ fout: 'Geef het briefje een titel.' });

  // Bovenaan, want dat is waar je een nieuw briefje verwacht.
  const bovenaan = db.prepare(
    'SELECT COALESCE(MIN(positie), 1) - 1 AS p FROM briefjes WHERE gebruiker_id = ?'
  ).get(req.gebruiker.id).p;

  const r = db.prepare(
    `INSERT INTO briefjes (gebruiker_id, titel, tekst, vastgepind, categorie_id, positie)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.gebruiker.id, titel, tekst(req.body.tekst, 5000), req.body.vastgepind ? 1 : 0,
        leesCategorie(req.gebruiker, req.body.categorie_id) ?? null, bovenaan);

  res.json(eigenBriefje(req.gebruiker, r.lastInsertRowid));
});

api.patch('/briefjes/:id', vereistLogin, (req, res) => {
  const briefje = eigenBriefje(req.gebruiker, req.params.id);
  if (!briefje) return res.status(404).json({ fout: 'Briefje niet gevonden.' });

  const titel = req.body.titel === undefined ? briefje.titel : tekst(req.body.titel, 100);
  if (!titel) return res.status(400).json({ fout: 'Geef het briefje een titel.' });

  const inhoud = req.body.tekst === undefined ? briefje.tekst : tekst(req.body.tekst, 5000);
  const vastgepind = req.body.vastgepind === undefined
    ? briefje.vastgepind
    : (req.body.vastgepind ? 1 : 0);

  const gelezen = leesCategorie(req.gebruiker, req.body.categorie_id);
  const categorie = gelezen === undefined ? briefje.categorie_id : gelezen;

  db.prepare(
    `UPDATE briefjes SET titel = ?, tekst = ?, vastgepind = ?, categorie_id = ?,
            gewijzigd_op = datetime('now')
      WHERE id = ?`
  ).run(titel, inhoud, vastgepind, categorie, briefje.id);

  res.json(eigenBriefje(req.gebruiker, briefje.id));
});

/** Weggooien is één klik zonder waarschuwing; hij belandt in de prullenbak. */
api.delete('/briefjes/:id', vereistLogin, (req, res) => {
  const briefje = eigenBriefje(req.gebruiker, req.params.id);
  if (!briefje) return res.status(404).json({ fout: 'Briefje niet gevonden.' });

  if (briefje.weggegooid_op) {
    // Al in de prullenbak: dan is dit de tweede klik, en gaat hij er echt uit.
    db.prepare('DELETE FROM briefjes WHERE id = ?').run(briefje.id);
    return res.json({ ok: true, definitief: true });
  }

  db.prepare("UPDATE briefjes SET weggegooid_op = datetime('now') WHERE id = ?").run(briefje.id);
  res.json({ ok: true, definitief: false });
});

/**
 * Slepen. Werkt met de buren uit het scherm, zodat het ook klopt als je op een
 * categorie hebt gefilterd en je dus niet alle briefjes ziet. Dezelfde aanpak
 * als bij het slepen van kaarten in Kanban.
 */
api.post('/briefjes/:id/verplaats', vereistLogin, (req, res) => {
  const briefje = eigenBriefje(req.gebruiker, req.params.id);
  if (!briefje) return res.status(404).json({ fout: 'Briefje niet gevonden.' });

  const positieVan = (id) => id
    ? db.prepare('SELECT positie FROM briefjes WHERE id = ? AND gebruiker_id = ?')
        .get(Number(id), req.gebruiker.id)?.positie
    : undefined;

  const boven = positieVan(req.body.vorige_id);
  const onder = positieVan(req.body.volgende_id);

  let positie;
  if (boven !== undefined && onder !== undefined) positie = (boven + onder) / 2;
  else if (boven !== undefined) positie = boven + 0.5;
  else if (onder !== undefined) positie = onder - 0.5;
  else positie = briefje.positie;

  db.transaction(() => {
    db.prepare('UPDATE briefjes SET positie = ? WHERE id = ?').run(positie, briefje.id);

    // Weer op hele getallen zetten; anders worden de tussenruimtes na veel
    // slepen zo klein dat twee briefjes gelijk komen te staan.
    const opVolgorde = db.prepare(
      'SELECT id FROM briefjes WHERE gebruiker_id = ? ORDER BY positie, id'
    ).all(req.gebruiker.id);
    const zet = db.prepare('UPDATE briefjes SET positie = ? WHERE id = ?');
    opVolgorde.forEach((rij, index) => zet.run(index + 1, rij.id));
  })();

  res.json(eigenBriefje(req.gebruiker, briefje.id));
});

api.post('/briefjes/:id/terug', vereistLogin, (req, res) => {
  const briefje = eigenBriefje(req.gebruiker, req.params.id);
  if (!briefje) return res.status(404).json({ fout: 'Briefje niet gevonden.' });

  db.prepare('UPDATE briefjes SET weggegooid_op = NULL WHERE id = ?').run(briefje.id);
  res.json(eigenBriefje(req.gebruiker, briefje.id));
});

export default api;
