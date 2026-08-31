// Wat voor omgeving is dit: het werk, of thuis?
//
// Dezelfde code draait op twee servers. Ze verschillen alleen in hun naam, hun
// logo, en een handvol woorden — bij Transafe heet het een collega, thuis niet.
//
// Alles staat hier bij elkaar. Er is dus geen enkele plek in de app waar staat
// "als het thuis is, dan…": de code vraagt gewoon het woord op en krijgt het
// woord dat bij deze server hoort.

/** De naam in het tabblad, de zijbalk en op het inlogscherm. */
export const APP_NAAM = String(process.env.APP_NAAM ?? '').trim() || 'Transafe Taakbeheer';

/** 'thuis' zet de huishoudwoorden en het huislogo aan. Leeg = het werk. */
export const THUIS = String(process.env.OMGEVING ?? '').trim().toLowerCase() === 'thuis';

/**
 * De woorden zoals ze op het werk zijn. Dit is de volledige lijst; hieronder
 * staat alleen wat er thuis van afwijkt.
 */
const WERK = {
  mensenMenu: 'Team',
  mensenTitel: 'Team',
  mensenKop: 'Teamleden',
  uitnodigenKop: 'Collega uitnodigen',
  uitnodigenVoorbeeld: 'collega@transafe.nl',
  uitnodigingGemaakt: 'Stuur de link hieronder naar je collega.',
  herstelUitleg: 'Je krijgt een link die je persoonlijk doorgeeft. Je collega kiest daarmee zelf een '
    + 'nieuw wachtwoord, zodat jij het wachtwoord nooit kent.',
  bordIedereen: 'Alle teamleden zien dit bord. Dit is de standaard.',
  mijnTakenlijst: 'Alleen jij ziet deze lijst; collega’s en beheerders niet. Ga je uit dienst, dan '
    + 'kan een beheerder de lijst overnemen zodat lopende taken niet blijven liggen.',
  prikbordLeeg: 'Nog geen notities. Zet hier neer wat je wilt bewaren: instructies, afspraken met '
    + 'collega’s of nummers die je steeds kwijt bent.',
  naamHint: 'Zo wordt je naam weergegeven bij taken, opmerkingen en in het team.',
  inlogUitleg: 'Nog geen account? Een beheerder van Transafe nodigt je uit als dat nodig is.',
  setupUitleg: 'Dit scherm verschijnt alleen zolang er geen account bestaat. Daarna nodig je als '
    + 'beheerder collega’s uit vanuit het scherm Team.',
  inlogboekUitleg: 'Hier zie je wie er is ingelogd en wie dat zonder succes probeerde. Een reeks '
    + 'mislukte pogingen op één adres is reden om het wachtwoord van die collega te laten '
    + 'wijzigen. Regels verdwijnen na 90 dagen automatisch.',
};

/** Alleen wat thuis anders is. De rest komt uit WERK. */
const HUISHOUDEN = {
  mensenMenu: 'Mensen',
  mensenTitel: 'Mensen',
  mensenKop: 'Wie doet mee',
  uitnodigenKop: 'Iemand uitnodigen',
  uitnodigenVoorbeeld: 'naam@voorbeeld.nl',
  uitnodigingGemaakt: 'Stuur de link hieronder naar de ander.',
  herstelUitleg: 'Je krijgt een link die je persoonlijk doorgeeft. De ander kiest daarmee zelf een '
    + 'nieuw wachtwoord, zodat jij het wachtwoord nooit kent.',
  bordIedereen: 'Iedereen ziet dit bord. Dit is de standaard.',
  mijnTakenlijst: 'Alleen jij ziet deze lijst; de anderen niet. Handig voor wat je zelf moet doen '
    + 'en waar niemand mee hoeft te kijken.',
  prikbordLeeg: 'Nog geen notities. Zet hier neer wat je wilt bewaren: afspraken, maten die je '
    + 'steeds opnieuw opmeet, of nummers die je altijd kwijt bent.',
  naamHint: 'Zo wordt je naam weergegeven bij taken en opmerkingen.',
  inlogUitleg: 'Nog geen account? Je krijgt een uitnodiging van iemand die er al in zit.',
  setupUitleg: 'Dit scherm verschijnt alleen zolang er geen account bestaat. Daarna nodig je vanuit '
    + 'het scherm Mensen de anderen uit.',
  inlogboekUitleg: 'Hier zie je wie er is ingelogd en wie dat zonder succes probeerde. Een reeks '
    + 'mislukte pogingen op één adres is reden om het wachtwoord van die persoon te laten '
    + 'wijzigen. Regels verdwijnen na 90 dagen automatisch.',
};

export const woorden = THUIS ? { ...WERK, ...HUISHOUDEN } : WERK;

/**
 * De naam als bestandsnaam, voor de CSV-export. "Takenplanner Thuis" wordt
 * takenplanner_thuis. Blijft er niets over, dan vallen we terug op 'taken'.
 */
export function naamAlsBestandsnaam() {
  const kaal = APP_NAAM
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // é wordt e
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return kaal || 'taken';
}
