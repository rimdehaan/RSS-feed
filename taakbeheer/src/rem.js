// Een rem op het raden van wachtwoorden en tokens.
//
// Zonder deze rem kan iemand onbeperkt wachtwoorden proberen. Dat is niet
// alleen een inbraakrisico: elke poging kost de server rekenwerk, omdat het
// controleren van een wachtwoord met opzet traag is. Een paar honderd pogingen
// per seconde legt de app dus ook plat.
//
// De tellers staan in het geheugen. Dat scheelt een tabel en een pakket, en bij
// een herstart zijn ze leeg — geen echte opening, want een aanvaller kan geen
// herstart afdwingen.

const VENSTER_MS = 15 * 60 * 1000;

/**
 * Twee grenzen naast elkaar:
 *
 * - Streng per e-mailadres. Dit is de grens die het raden echt stopt.
 * - Ruim per IP-adres. Een kantoor deelt één internetverbinding, dus deze mag
 *   collega's niet in de weg zitten. Hij vangt alleen het grove werk af.
 */
export const GRENZEN = {
  inloggenPerAdres: 5,
  inloggenPerIp: 50,
  tokenPerIp: 20,
};

// sleutel -> { aantal, tot }
const tellers = new Map();

/** Oude tellers weggooien, zodat de kaart niet blijft groeien. */
function ruimOp(nu) {
  for (const [sleutel, teller] of tellers) {
    if (teller.tot <= nu) tellers.delete(sleutel);
  }
}

/**
 * Kijkt of deze sleutel nog mag. Telt zelf niets op — dat doet `telFout()`,
 * want alleen mislukte pogingen horen mee te tellen.
 *
 * Geeft `null` als het mag, anders het aantal seconden dat je moet wachten.
 */
export function wachtNog(sleutel, grens) {
  const teller = tellers.get(sleutel);
  if (!teller) return null;

  const nu = Date.now();
  if (teller.tot <= nu) {
    tellers.delete(sleutel);
    return null;
  }

  return teller.aantal >= grens ? Math.ceil((teller.tot - nu) / 1000) : null;
}

/** Eén mislukte poging bijschrijven. */
export function telFout(sleutel) {
  const nu = Date.now();
  if (tellers.size > 5000) ruimOp(nu);

  const teller = tellers.get(sleutel);
  if (!teller || teller.tot <= nu) {
    // Het venster begint bij de eerste fout, en loopt daarna gewoon door.
    tellers.set(sleutel, { aantal: 1, tot: nu + VENSTER_MS });
    return;
  }
  teller.aantal += 1;
}

/** Gelukt: de teller mag schoon. */
export function vergeet(sleutel) {
  tellers.delete(sleutel);
}

/** Alleen voor de tests: alles wissen. */
export function wisAlles() {
  tellers.clear();
}

/** Nette melding met de wachttijd erin. */
export function teVeelMelding(seconden) {
  const minuten = Math.max(1, Math.ceil(seconden / 60));
  return `Te veel mislukte pogingen. Probeer het over ${minuten} `
       + `${minuten === 1 ? 'minuut' : 'minuten'} opnieuw.`;
}
