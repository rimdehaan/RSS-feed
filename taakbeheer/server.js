// Transafe Taakbeheer — startpunt van de server.
// Starten:  node server.js   ->  http://localhost:3000

import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import api from './src/api.js';
import { metGebruiker, ruimOp } from './src/auth.js';
import { db, aantalGebruikers } from './src/db.js';

const hier = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Achter een hostingplatform staat een proxy; hierdoor weet Express dat de
// bezoeker via https binnenkwam en werken 'secure' cookies zoals bedoeld.
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(metGebruiker);

// Een paar standaard beveiligingsheaders.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use('/api', api);

// De app-pagina is alleen voor wie is ingelogd; de rest gaat naar inloggen.
app.get('/', (req, res, next) => {
  if (!req.gebruiker) {
    return res.redirect(aantalGebruikers() === 0 ? '/inloggen.html?setup=1' : '/inloggen.html');
  }
  next();
});

app.use(express.static(join(hier, 'public'), { extensions: ['html'] }));

// Onbekend adres.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ fout: 'Onbekend adres.' });
  res.status(404).send('Niet gevonden');
});

// Vangnet: laat de server niet omvallen op één fout, maar log hem wel.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ fout: 'Er ging iets mis op de server.' });
});

/**
 * Noodluik voor als er niemand meer beheerder is, of jezelf per ongeluk hebt
 * gedegradeerd. Zet op de hostingomgeving HERSTEL_BEHEERDER op je e-mailadres
 * en start opnieuw op; dat account wordt dan beheerder en weer actief gezet.
 * Haal de variabele daarna weg — bij elke start doet hij het opnieuw.
 * Alleen wie bij de instellingen van de server kan, kan dit gebruiken.
 */
function herstelBeheerder() {
  const email = String(process.env.HERSTEL_BEHEERDER ?? '').trim().toLowerCase();
  if (!email) return;

  const gebruiker = db.prepare('SELECT id, naam, rol, actief FROM gebruikers WHERE email = ?').get(email);
  if (!gebruiker) {
    console.log(`HERSTEL_BEHEERDER: geen account gevonden met ${email}. Er is niets gewijzigd.`);
    return;
  }

  db.prepare("UPDATE gebruikers SET rol = 'beheerder', actief = 1 WHERE id = ?").run(gebruiker.id);
  console.log(`HERSTEL_BEHEERDER: ${gebruiker.naam} (${email}) is nu beheerder en actief.`);
  console.log('Haal de variabele HERSTEL_BEHEERDER weg nu het gelukt is.');
}

herstelBeheerder();
ruimOp();

app.listen(PORT, () => {
  console.log(`Taakbeheer draait op http://localhost:${PORT}`);
  if (aantalGebruikers() === 0) {
    console.log('Nog geen gebruikers: open die link om de eerste beheerder aan te maken.');
  }
});
