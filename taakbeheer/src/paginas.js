// De naam en het logo in de twee HTML-pagina's zetten.
//
// Waarom niet vanuit de browser? Omdat je dan eerst een tel de verkeerde naam
// in je tabblad ziet staan voordat het script hem verbetert. Dat is lelijk, en
// het is niet nodig: de naam verandert nooit terwijl de server draait. Dus doen
// we het één keer bij het opstarten, en serveren we daarna gewoon die tekst.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAAM, THUIS, woorden } from './omgeving.js';

const hier = dirname(fileURLToPath(import.meta.url));
const PUBLIEK = join(hier, '..', 'public');

function esc(tekst) {
  return String(tekst).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Het merk: thuis het huis met de naam ernaast, op het werk het Transafe-logo
 * zoals het altijd was.
 */
function merk(waar) {
  const wit = waar === 'zijbalk';
  if (!THUIS) {
    return `<img src="/logo-${wit ? 'wit' : 'kleur'}.svg" alt="${esc(APP_NAAM)}" />`;
  }
  return `<span class="merk">`
    + `<img src="/huis-${wit ? 'wit' : 'kleur'}.svg" alt="" width="${wit ? 34 : 40}" height="${wit ? 34 : 40}" />`
    + `<span class="merk-naam">${esc(APP_NAAM)}</span>`
    + `</span>`;
}

const VERVANGINGEN = {
  '{{NAAM}}': esc(APP_NAAM),
  '{{MERK_ZIJBALK}}': merk('zijbalk'),
  '{{MERK_INLOG}}': merk('inlog'),
  '{{INLOG_UITLEG}}': esc(woorden.inlogUitleg),
};

function lees(bestand) {
  let tekst = readFileSync(join(PUBLIEK, bestand), 'utf8');
  for (const [plek, waarde] of Object.entries(VERVANGINGEN)) {
    tekst = tekst.split(plek).join(waarde);
  }
  return tekst;
}

// Eén keer inlezen. Verandert er iets aan de pagina's, dan herstart je toch.
const PAGINAS = {
  '/': lees('index.html'),
  '/index.html': lees('index.html'),
  '/inloggen': lees('inloggen.html'),
  '/inloggen.html': lees('inloggen.html'),
};

/**
 * Serveert de twee ingevulde pagina's. Moet vóór express.static staan, anders
 * krijgt de bezoeker het bestand van schijf met de plaatshouders er nog in.
 */
export function metNaamErin(req, res, next) {
  const pagina = req.method === 'GET' && PAGINAS[req.path];
  if (!pagina) return next();

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(pagina);
}
