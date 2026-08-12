// Alle API-routes. De browser praat via deze adressen met de server.
// Elk antwoord is JSON. Fouten geven een statuscode + { fout: "uitleg" }.

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, STATUSSEN, aantalGebruikers, logHistorie } from './db.js';
import {
  hashWachtwoord, wachtwoordKlopt, maakSessie, verwijderSessie,
  vereistLogin, vereistBeheerder,
} from './auth.js';

const api = Router();

// ── Hulpjes ──────────────────────────────────────────────────────────────

function tekst(waarde, max = 500) {
  return String(waarde ?? '').trim().slice(0, max);
}

function geldigEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  if (gebruiker.rol === 'beheerder' || bord.zichtbaar_voor_iedereen) return bord;

  const lid = db.prepare('SELECT 1 FROM bord_leden WHERE bord_id = ? AND gebruiker_id = ?')
    .get(bord.id, gebruiker.id);
  return lid ? bord : null;
}

/** Instellingen wijzigen mag een beheerder, en wie het bord heeft aangemaakt. */
function magBeheren(gebruiker, bord) {
  return gebruiker.rol === 'beheerder' || bord.aangemaakt_door === gebruiker.id;
}

/** Mag deze persoon een taak op dit bord toegewezen krijgen? */
function magToegewezenWorden(bord, gebruikerId) {
  if (!gebruikerId) return true;   // niemand toewijzen mag altijd

  const gebruiker = db.prepare('SELECT rol FROM gebruikers WHERE id = ? AND actief = 1').get(gebruikerId);
  if (!gebruiker) return false;
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

  // Een leeg bord om mee te beginnen.
  db.prepare('INSERT INTO borden (naam) VALUES (?)').run('Takenbord');

  maakSessie(res, resultaat.lastInsertRowid);
  res.json({ ok: true });
});

// ── Inloggen en uitloggen ────────────────────────────────────────────────

api.post('/inloggen', (req, res) => {
  const email = tekst(req.body.email, 160).toLowerCase();
  const wachtwoord = String(req.body.wachtwoord ?? '');

  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE email = ?').get(email);

  // Bewust dezelfde melding voor "onbekend adres" en "verkeerd wachtwoord":
  // anders kan iemand uitvissen welke adressen bestaan.
  if (!gebruiker || !gebruiker.actief || !wachtwoordKlopt(wachtwoord, gebruiker.wachtwoord_hash)) {
    return res.status(401).json({ fout: 'E-mailadres of wachtwoord klopt niet.' });
  }

  maakSessie(res, gebruiker.id);
  res.json({ ok: true });
});

api.post('/uitloggen', (req, res) => {
  verwijderSessie(req, res);
  res.json({ ok: true });
});

api.get('/ik', (req, res) => {
  res.json({ gebruiker: req.gebruiker, statussen: STATUSSEN });
});

// ── Uitnodigingen ────────────────────────────────────────────────────────

api.get('/uitnodiging/:token', (req, res) => {
  const uitnodiging = db.prepare(
    'SELECT email, verloopt_op, gebruikt_op FROM uitnodigingen WHERE token = ?'
  ).get(req.params.token);

  if (!uitnodiging || uitnodiging.gebruikt_op || new Date(uitnodiging.verloopt_op) < new Date()) {
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
    'SELECT id, naam, email, rol, actief FROM gebruikers ORDER BY actief DESC, naam COLLATE NOCASE'
  ).all());
});

api.patch('/gebruikers/:id', vereistBeheerder, (req, res) => {
  const id = Number(req.params.id);
  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(id);
  if (!gebruiker) return res.status(404).json({ fout: 'Gebruiker niet gevonden.' });

  const rol = req.body.rol === 'beheerder' ? 'beheerder' : req.body.rol === 'lid' ? 'lid' : gebruiker.rol;
  const actief = req.body.actief === undefined ? gebruiker.actief : (req.body.actief ? 1 : 0);

  // Voorkom dat de laatste beheerder zichzelf buitensluit.
  const beheerders = db.prepare("SELECT COUNT(*) AS n FROM gebruikers WHERE rol = 'beheerder' AND actief = 1").get().n;
  const verliestRechten = gebruiker.rol === 'beheerder' && gebruiker.actief && (rol !== 'beheerder' || !actief);
  if (verliestRechten && beheerders <= 1) {
    return res.status(400).json({ fout: 'Er moet minstens één actieve beheerder overblijven.' });
  }

  db.prepare('UPDATE gebruikers SET rol = ?, actief = ? WHERE id = ?').run(rol, actief, id);
  if (!actief) db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(id);

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
  const rij = db.prepare(
    `SELECT h.gebruikt_op, h.verloopt_op, g.naam, g.email
       FROM herstel h JOIN gebruikers g ON g.id = h.gebruiker_id
      WHERE h.token = ?`
  ).get(req.params.token);

  if (!rij || rij.gebruikt_op || new Date(rij.verloopt_op) < new Date()) {
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

api.post('/wachtwoord', vereistLogin, (req, res) => {
  const huidig = String(req.body.huidig ?? '');
  const nieuw = String(req.body.nieuw ?? '');

  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(req.gebruiker.id);
  if (!wachtwoordKlopt(huidig, gebruiker.wachtwoord_hash)) {
    return res.status(403).json({ fout: 'Je huidige wachtwoord klopt niet.' });
  }
  if (nieuw.length < 10) {
    return res.status(400).json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' });
  }

  db.prepare('UPDATE gebruikers SET wachtwoord_hash = ? WHERE id = ?')
    .run(hashWachtwoord(nieuw), gebruiker.id);
  res.json({ ok: true });
});

// ── Borden ───────────────────────────────────────────────────────────────

api.get('/borden', vereistLogin, (req, res) => {
  const borden = db.prepare(
    `SELECT b.id, b.naam, b.gearchiveerd, b.zichtbaar_voor_iedereen, b.aangemaakt_door,
            (SELECT COUNT(*) FROM taken t WHERE t.bord_id = b.id) AS aantal_taken
       FROM borden b
      WHERE ? = 1
         OR b.zichtbaar_voor_iedereen = 1
         OR EXISTS (SELECT 1 FROM bord_leden bl WHERE bl.bord_id = b.id AND bl.gebruiker_id = ?)
      ORDER BY b.gearchiveerd, b.positie, b.id`
  ).all(req.gebruiker.rol === 'beheerder' ? 1 : 0, req.gebruiker.id);

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

  db.prepare('DELETE FROM borden WHERE id = ?').run(bord.id);
  res.json({ ok: true });
});

// ── Taken ────────────────────────────────────────────────────────────────

const TAAK_SELECT = `
  SELECT t.id, t.bord_id, t.opdracht, t.uitvoerend_id, t.status, t.deadline,
         t.omschrijving, t.positie, t.aangemaakt_op, t.gewijzigd_op,
         g.naam AS uitvoerend_naam,
         (SELECT COUNT(*) FROM opmerkingen o WHERE o.taak_id = t.id) AS aantal_opmerkingen
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
    `SELECT t.id, t.bord_id, t.opdracht, t.uitvoerend_id, t.status, t.deadline,
            t.omschrijving, t.positie, t.aangemaakt_op, t.gewijzigd_op,
            g.naam AS uitvoerend_naam,
            b.naam AS bord_naam,
            (SELECT COUNT(*) FROM opmerkingen o WHERE o.taak_id = t.id) AS aantal_opmerkingen
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
  const uitvoerendId = req.body.uitvoerend_id ? Number(req.body.uitvoerend_id) : null;

  if (!magToegewezenWorden(bord, uitvoerendId)) {
    return res.status(400).json({ fout: 'Die persoon kan dit bord niet zien. Geef hem eerst toegang bij de bordinstellingen.' });
  }

  const onderaan = db.prepare('SELECT COALESCE(MAX(positie), 0) + 1 AS p FROM taken WHERE bord_id = ?').get(bordId).p;

  const r = db.prepare(
    `INSERT INTO taken (bord_id, opdracht, uitvoerend_id, status, deadline, omschrijving, positie, aangemaakt_door)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(bordId, opdracht, uitvoerendId, status, datumOfNull(req.body.deadline),
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

  if (req.body.uitvoerend_id !== undefined) {
    const bord = db.prepare('SELECT * FROM borden WHERE id = ?').get(taak.bord_id);
    const nieuweUitvoerder = req.body.uitvoerend_id ? Number(req.body.uitvoerend_id) : null;
    if (!magToegewezenWorden(bord, nieuweUitvoerder)) {
      return res.status(400).json({ fout: 'Die persoon kan dit bord niet zien. Geef hem eerst toegang bij de bordinstellingen.' });
    }
  }

  const nieuw = {
    opdracht: req.body.opdracht === undefined ? taak.opdracht : (tekst(req.body.opdracht, 200) || taak.opdracht),
    uitvoerend_id: req.body.uitvoerend_id === undefined
      ? taak.uitvoerend_id
      : (req.body.uitvoerend_id ? Number(req.body.uitvoerend_id) : null),
    status: req.body.status === undefined
      ? taak.status
      : (STATUSSEN.includes(req.body.status) ? req.body.status : taak.status),
    deadline: req.body.deadline === undefined ? taak.deadline : datumOfNull(req.body.deadline),
    omschrijving: req.body.omschrijving === undefined ? taak.omschrijving : tekst(req.body.omschrijving, 20000),
  };

  // Alleen echte wijzigingen belanden in de historie.
  const namen = { opdracht: 'opdracht', uitvoerend_id: 'uitvoerend', status: 'status', deadline: 'deadline', omschrijving: 'omschrijving' };
  const naamVan = (id) => id ? (db.prepare('SELECT naam FROM gebruikers WHERE id = ?').get(id)?.naam ?? null) : null;

  db.transaction(() => {
    for (const veld of Object.keys(nieuw)) {
      if (nieuw[veld] === taak[veld]) continue;
      const toon = veld === 'uitvoerend_id' ? naamVan : (v) => v;
      logHistorie(taak.id, req.gebruiker.id, namen[veld], toon(taak[veld]), toon(nieuw[veld]));
    }
    db.prepare(
      `UPDATE taken SET opdracht = ?, uitvoerend_id = ?, status = ?, deadline = ?, omschrijving = ?,
              gewijzigd_op = datetime('now')
         WHERE id = ?`
    ).run(nieuw.opdracht, nieuw.uitvoerend_id, nieuw.status, nieuw.deadline, nieuw.omschrijving, taak.id);
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

  db.prepare('DELETE FROM taken WHERE id = ?').run(taak.id);
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

export default api;
