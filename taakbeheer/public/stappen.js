// Tekst omzetten naar losse stappen.
//
// Dit bestand staat in public/ omdat de browser hem nodig heeft voor de
// voorvertoning, maar de server gebruikt precies dezelfde functie bij het
// opslaan. Eén regelset dus, in plaats van twee die uit elkaar gaan lopen.
//
// De regel: één stap per regel. Nummering en opsommingstekens gaan eraf.

export const MAX_STAPPEN = 200;
export const MAX_STAP_TEKENS = 500;

// "1." "1)" "12." "Stap 3." — punt of haakje, spatie erna mag ontbreken.
const NUMMER_MET_LEESTEKEN = /^\s*(?:stap\s*)?\d+\s*[.)]\s*/i;

// "1 - " "Stap 2: " — hier is een spatie erna verplicht, anders zou "10-15 stuks"
// worden aangezien voor nummering.
const NUMMER_MET_STREEP = /^\s*(?:stap\s*)?\d+\s*[-:]\s+/i;

// "- " "• " "* " — ook hier een spatie erna, zodat "-15 graden" heel blijft.
const OPSOMMINGSTEKEN = /^\s*[-*•–—→>]\s+/;

function haalVoorloopWeg(regel) {
  let uit = regel;

  // Twee rondes: "- 1. Controleer" heeft er allebei een.
  for (let ronde = 0; ronde < 2; ronde++) {
    const vorige = uit;
    uit = uit.replace(NUMMER_MET_LEESTEKEN, '')
             .replace(NUMMER_MET_STREEP, '')
             .replace(OPSOMMINGSTEKEN, '');
    if (uit === vorige) break;
  }

  return uit.trim();
}

/**
 * Knipt geplakte tekst in stappen. Geeft een lijst met regels terug; lege
 * regels vallen weg en te lange regels worden afgekapt, zodat wat je in de
 * voorvertoning ziet ook is wat er wordt opgeslagen.
 */
export function splitsStappen(tekst) {
  return String(tekst ?? '')
    .split(/\r?\n/)
    .map(haalVoorloopWeg)
    .filter((regel) => regel.length > 0)
    .map((regel) => regel.slice(0, MAX_STAP_TEKENS));
}
