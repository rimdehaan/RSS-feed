// Transafe Taakbeheer — alles wat er in de browser gebeurt.

import { splitsStappen, MAX_STAPPEN } from './stappen.js';

// ── Gedeelde toestand ────────────────────────────────────────────────────
const staat = {
  ik: null,
  statussen: [],
  gebruikers: [],
  borden: [],
  bordId: null,        // null = het persoonlijke bord
  taken: [],
  weergave: 'tabel',   // 'tabel' | 'team' | 'werkprocessen' | 'prikbord'
  bewerktId: null,
  detailId: null,
  deadlineFilter: null,  // null | 'te-laat' | 'komt-eraan'
  sortering: null,       // null = eigen volgorde; anders { kolom, richting }
  // Statussen waarvan het blok dicht staat. Afgerond werk begint dicht: dat
  // groeit eindeloos en is zelden waar je naar zoekt.
  dichtgeklapt: new Set(['Done', 'Cancelled']),
  toegestaneUitvoerders: null,   // null = iedereen mag; anders een Set met ids

  // Het prikbord: je eigen briefjes, en wat er in de prullenbak ligt.
  briefjes: [],
  prullenbak: [],
  prullenbakOpen: false,
  prullenbakDagen: 30,
  briefjeId: null,
  categorieen: [],
  postitKleuren: [],
  maxCategorieen: 6,
  categorieFilter: null,   // null = alles; 'geen' = zonder categorie; anders een id
};

const KLEUREN = {
  'Not Started':   '#B3B3B3',
  'Working on it': '#F2C94C',
  'Validating':    '#9B51E0',
  'Done':          '#27AE60',
  'On Hold':       '#F2994A',
  'Cancelled':     '#EB5757',
};

// Kleuren en klasse voor prioriteit. Leeg = geen prioriteit opgegeven.
const PRIO_KLEUREN = {
  Critical: '#C4314B',
  High: '#E2445C',
  Medium: '#F2C94C',
  Low: '#6C9FF5',
  '': '#eceef1',
};

// Op geel en op lichtgrijs zijn witte letters onleesbaar; daar donkere letters.
const LETTER_OP = { '#F2C94C': '#5a4000', '#eceef1': '#8b8f98' };
const optieStijl = (achtergrond) => `background:${achtergrond};color:${LETTER_OP[achtergrond] ?? '#fff'}`;

// Tekentjes voor bijlagen. Bewust getekend en geen emoji: een emoji ziet er
// op elk apparaat anders uit — op Windows is de paperclip die van de oude
// Office-assistent, mét oogjes — en hij kleurt niet mee met de tekst.
const PAPERCLIP = `<svg class="teken" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
const SCHAKEL = `<svg class="teken" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
// Om dezelfde reden getekend: het slotje in de zijbalk was een emoji en kwam er
// als goudbruin hangslot uit tussen de witte letters.
const SLOT = `<svg class="slot" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><title>Alleen zichtbaar voor gekozen mensen</title><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

const el = (id) => document.getElementById(id);
const statusKlasse = (status) => 's-' + status.toLowerCase().replace(/\s+/g, '-');
const prioKlasse = (prioriteit) => 'p-' + (prioriteit ? prioriteit.toLowerCase() : 'geen');
const prioTekst = (prioriteit) => prioriteit === 'Critical' ? 'Critical ⚠' : (prioriteit || '—');

function esc(waarde) {
  return String(waarde ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function datumNL(waarde) {
  if (!waarde) return '';
  return new Date(waarde).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function momentNL(waarde) {
  // De server slaat tijden op in UTC; de 'Z' zorgt dat de browser goed omrekent.
  return new Date(waarde.replace(' ', 'T') + 'Z')
    .toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function initialen(naam) {
  if (!naam) return '?';
  return naam.trim().split(/\s+/).slice(0, 2).map(d => d[0].toUpperCase()).join('');
}

/** Datum als jjjj-mm-dd in de tijdzone van de gebruiker, niet in UTC. */
function datumSleutel(datum) {
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`;
}

const vandaag = () => datumSleutel(new Date());

function morgen() {
  const datum = new Date();
  datum.setDate(datum.getDate() + 1);
  return datumSleutel(datum);
}

// Af of vervallen: dan hoeft een deadline geen aandacht meer te vragen.
const AFGEROND = ['Done', 'Cancelled'];

/**
 * Te laat: de deadline ligt achter ons en de taak is nog niet afgerond.
 * Of er al aan gewerkt wordt doet er bewust niet toe — te laat is te laat,
 * en dat blijft zo tot de taak op Done of Cancelled staat.
 */
function isTeLaat(taak) {
  if (!taak.deadline || AFGEROND.includes(taak.status)) return false;
  return taak.deadline < vandaag();
}

/**
 * Komt eraan: de deadline is vandaag of morgen terwijl er nog niet aan gewerkt
 * wordt. "Working on it" telt als opgepakt, "Done" en "Cancelled" zijn klaar;
 * de rest — ook On Hold en Validating — vraagt dan om aandacht.
 * Een taak is nooit tegelijk te laat en komt-eraan.
 */
function komtEraan(taak) {
  if (!taak.deadline || isTeLaat(taak)) return false;
  if (taak.status === 'Working on it' || AFGEROND.includes(taak.status)) return false;
  return taak.deadline <= morgen();
}

/** Hele kalenderdagen tussen de deadline en vandaag. */
function dagenTeLaat(taak) {
  const dag = 24 * 60 * 60 * 1000;
  return Math.round((new Date(vandaag()) - new Date(taak.deadline)) / dag);
}

function teLaatTekst(taak) {
  const dagen = dagenTeLaat(taak);
  return `${dagen} ${dagen === 1 ? 'dag' : 'dagen'} te laat`;
}

function waaromAandacht(taak) {
  if (isTeLaat(taak)) return `Deze taak is ${teLaatTekst(taak)}.`;
  if (taak.deadline === vandaag()) return 'De deadline is vandaag en er wordt nog niet aan deze taak gewerkt.';
  return 'De deadline is morgen en er wordt nog niet aan deze taak gewerkt.';
}

// ── Praten met de server ─────────────────────────────────────────────────
async function api(pad, opties = {}) {
  const antwoord = await fetch('/api' + pad, {
    ...opties,
    headers: opties.body ? { 'content-type': 'application/json' } : {},
    body: opties.body ? JSON.stringify(opties.body) : undefined,
  });

  if (antwoord.status === 401) { location.href = '/inloggen.html'; throw new Error('Niet ingelogd'); }

  const data = await antwoord.json().catch(() => ({}));
  if (!antwoord.ok) throw new Error(data.fout || 'Er ging iets mis.');
  return data;
}

// ── Vensters ─────────────────────────────────────────────────────────────
function openVenster(id) { el(id).classList.add('open'); }
function sluitVenster(id) { el(id).classList.remove('open'); }

document.querySelectorAll('.overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.hasAttribute('data-sluit')) overlay.classList.remove('open');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
});

// ── Opstarten ────────────────────────────────────────────────────────────
async function start() {
  const { gebruiker, statussen, prioriteiten, max_bijlage_mb } = await api('/ik');
  if (!gebruiker) { location.href = '/inloggen.html'; return; }

  staat.ik = gebruiker;
  staat.statussen = statussen;
  staat.prioriteiten = prioriteiten ?? [];
  staat.maxBijlageMB = max_bijlage_mb ?? 10;
  el('wieBenIk').textContent = gebruiker.naam;

  vulStatusKeuzes();
  staat.gebruikers = await api('/gebruikers');
  vulGebruikerKeuzes();

  staat.borden = await api('/borden');
  if (staat.borden.length === 0 && gebruiker.rol === 'beheerder') {
    await api('/borden', { method: 'POST', body: { naam: 'Takenbord' } });
    staat.borden = await api('/borden');
  }

  tekenZijbalk();
  await kiesBord(null);   // begin op je eigen taken
}

function vulStatusKeuzes() {
  const opties = staat.statussen
    .map(s => `<option value="${esc(s)}" style="${optieStijl(KLEUREN[s])}">${esc(s)}</option>`).join('');
  el('vStatus').innerHTML = opties;
  el('filterStatus').innerHTML = '<option value="">Alle statussen</option>' + opties;

  const prio = staat.prioriteiten
    .map(p => `<option value="${esc(p)}" style="${optieStijl(PRIO_KLEUREN[p])}">${esc(p)}</option>`).join('');
  el('vPrioriteit').innerHTML =
    `<option value="" style="${optieStijl(PRIO_KLEUREN[''])}">— geen —</option>` + prio;
  el('filterPrioriteit').innerHTML = '<option value="">Alle prioriteiten</option>' + prio +
    '<option value="geen">Zonder prioriteit</option>';
}

function vulGebruikerKeuzes() {
  const opties = staat.gebruikers.filter(g => g.actief)
    .map(g => `<option value="${g.id}">${esc(g.naam)}</option>`).join('');
  el('filterUitvoerend').innerHTML = '<option value="">Iedereen</option>' + opties;
}

/** Wie mag er op dit bord een taak krijgen? null = iedereen. */
async function toegestaneVoorBord(bordId) {
  const bord = staat.borden.find(b => b.id === bordId);
  if (!bord || bord.zichtbaar_voor_iedereen) return null;
  return new Set((await api(`/borden/${bordId}/instellingen`)).leden);
}

/**
 * De keuzelijst voor "uitvoerend" toont alleen mensen die het gekozen project
 * kunnen zien. Anders wijs je werk toe dat de ontvanger niet kan openen — de
 * server weigert dat, maar het is prettiger die keuze niet eens aan te bieden.
 */
function vulUitvoerendKeuze(toegestaan = staat.toegestaneUitvoerders) {
  const vorige = el('vUitvoerend').value;
  const mag = (g) => !toegestaan || g.rol === 'beheerder' || toegestaan.has(g.id);

  el('vUitvoerend').innerHTML = '<option value="">— niemand —</option>' +
    staat.gebruikers.filter(g => g.actief && mag(g))
      .map(g => `<option value="${g.id}">${esc(g.naam)}</option>`).join('');

  // Selectie behouden als die persoon ook op het nieuwe project mag.
  el('vUitvoerend').value = [...el('vUitvoerend').options].some(o => o.value === vorige) ? vorige : '';
}

function vulProjectKeuze(huidigBordId) {
  // Je eigen takenlijst kan wel een vertrekpunt zijn maar geen bestemming:
  // anders kun je een taak die collega's zien voor iedereen laten verdwijnen.
  const keuzes = staat.borden.filter(b => !b.prive_van || b.id === huidigBordId);

  el('vProject').innerHTML = keuzes
    .map(b => `<option value="${b.id}" ${b.id === huidigBordId ? 'selected' : ''}>${esc(b.naam)}</option>`)
    .join('');
}

/**
 * Op je eigen takenlijst ben jij per definitie de uitvoerder, dus daar valt
 * niets te kiezen. De server weigerde een collega al, maar dan krijg je pas ná
 * het opslaan te horen dat het niet mocht — beter is de keuze niet aanbieden.
 */
function uitvoerendVeldBijwerken(bordId) {
  el('vUitvoerendVeld').hidden = bordId !== null && bordId === mijnTakenlijst()?.id;
}

// Kies je een ander project, dan verandert ook wie de taak mag uitvoeren.
el('vProject').addEventListener('change', async () => {
  try {
    const bordId = Number(el('vProject').value);
    uitvoerendVeldBijwerken(bordId);
    vulUitvoerendKeuze(await toegestaneVoorBord(bordId));
  } catch (fout) {
    el('taakMelding').textContent = fout.message;
  }
});

const isPersoonlijk = () => staat.bordId === null;

/** Je eigen takenlijst; die staat als enige bord met prive_van in de lijst. */
const mijnTakenlijst = () => staat.borden.find(b => b.prive_van) ?? null;
const isMijnTakenlijst = () => staat.bordId !== null && staat.bordId === mijnTakenlijst()?.id;

function tekenZijbalk() {
  // Team, Werkprocessen en het prikbord zijn eigen schermen; dan is er geen
  // enkel bord actief, ook al staat er nog een bordId in de staat.
  const opTaken = staat.weergave === 'tabel';
  const opMijnBord = isPersoonlijk() && opTaken;
  const lijst = mijnTakenlijst();

  el('persoonlijkLijst').innerHTML = `
    <a data-mijn class="${opMijnBord ? 'actief' : ''}">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span class="naam">Mijn taken</span>
    </a>
    <a data-prikbord class="${staat.weergave === 'prikbord' ? 'actief' : ''}" title="Mijn prikbord">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/></svg>
      <span class="naam">Mijn prikbord</span>
    </a>
    ${lijst ? `
      <a data-bord="${lijst.id}" title="${esc(lijst.naam)}" class="${lijst.id === staat.bordId && opTaken ? 'actief' : ''}">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>
        <span class="naam">${esc(lijst.naam)}</span>
        <span class="telling">${lijst.aantal_taken}</span>
      </a>` : ''}`;

  // Via de zijbalk kom je op het prikbord zelf, niet in de prullenbak — ook
  // niet als je die de vorige keer had openstaan. tekenPrikbord() laat hem met
  // rust, want dat is ook de herteken-functie na elke actie.
  el('persoonlijkLijst').querySelector('[data-prikbord]')
    .addEventListener('click', () => { staat.prullenbakOpen = false; tekenPrikbord(); });

  el('persoonlijkLijst').querySelector('[data-mijn]')
    .addEventListener('click', () => kiesBord(null));
  el('persoonlijkLijst').querySelectorAll('[data-bord]').forEach(link => {
    link.addEventListener('click', () => kiesBord(Number(link.dataset.bord)));
  });

  // De eigen takenlijst staat hierboven al; die hoort niet bij de projecten.
  const projecten = staat.borden.filter(b => !b.prive_van);
  el('bordenLijst').innerHTML = projecten.length === 0
    ? '<p style="padding:6px 20px;font-size:.8rem;color:rgba(255,255,255,.35)">Nog geen projecten.</p>'
    : projecten.map(bord => `
        <a data-bord="${bord.id}" title="${esc(bord.naam)}" class="${bord.id === staat.bordId && opTaken ? 'actief' : ''}">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <span class="naam">${esc(bord.naam)}</span>
          ${bord.zichtbaar_voor_iedereen ? '' : SLOT}
          <span class="telling">${bord.aantal_taken}</span>
        </a>`).join('');

  el('bordenLijst').querySelectorAll('[data-bord]').forEach(link => {
    link.addEventListener('click', () => kiesBord(Number(link.dataset.bord)));
  });

  el('teamKnop').classList.toggle('actief', staat.weergave === 'team');
  el('werkprocessenKnop').classList.toggle('actief', staat.weergave === 'werkprocessen');
}

async function kiesBord(id) {
  staat.bordId = id;
  staat.weergave = 'tabel';

  if (isPersoonlijk()) {
    staat.taken = await api('/mijn-taken');
    staat.toegestaneUitvoerders = null;
    el('paginaTitel').textContent = 'Mijn taken';
  } else {
    staat.taken = await api(`/borden/${id}/taken`);
    const bord = staat.borden.find(b => b.id === id);
    el('paginaTitel').textContent = bord?.naam ?? 'Project';

    staat.toegestaneUitvoerders = bord?.zichtbaar_voor_iedereen
      ? null
      : new Set((await api(`/borden/${id}/instellingen`)).leden);
  }

  // Bij een ander project begin je met alles in beeld.
  staat.deadlineFilter = null;

  el('werkbalk').hidden = false;
  el('prikbordBalk').hidden = true;
  el('categorieBalk').hidden = true;
  werkbalkBijwerken();
  tekenZijbalk();
  teken();
}

const UITLEG = {
  mijnTaken: 'Alle taken die aan jou zijn toegewezen, uit alle projecten. '
    + 'Nieuwe taken maak je aan op een project of op je eigen takenlijst.',
  mijnTakenlijst: 'Alleen jij ziet deze lijst; collega’s en beheerders niet. '
    + 'Ga je uit dienst, dan kan een beheerder de lijst overnemen zodat lopende taken niet blijven liggen.',
  prikbord: 'Dingen die je moet onthouden en vroeger opschreef op een post-it: instructies, '
    + 'afspraken, telefoonnummers. Alleen jij ziet ze. Zoeken doe je via het vak rechtsboven.',
  prullenbak: 'Weggegooide notities blijven hier 30 dagen staan. Daarna ruimt de app ze op. '
    + 'Zolang ze hier staan kun je ze nog terugzetten.',
};

/** Op het persoonlijke bord kun je geen taak aanmaken of instellingen wijzigen. */
function werkbalkBijwerken() {
  const bord = staat.borden.find(b => b.id === staat.bordId);
  el('nieuwTaakKnop').hidden = isPersoonlijk();
  el('bordInstellingenKnop').hidden = isPersoonlijk() || !bord?.mag_beheren;

  // Op je eigen bord en op je eigen lijst staat overal jouw naam, dus dat
  // filter heeft daar geen zin.
  const alleenIk = isPersoonlijk() || isMijnTakenlijst();
  el('uitvoerendFilter').hidden = alleenIk;
  if (alleenIk) el('filterUitvoerend').value = '';

  // Eén regel uitleg boven beide persoonlijke schermen, zodat niemand hoeft te
  // raden wat het verschil is: het overzicht verzamelt, de lijst is van jou.
  const uitleg = isPersoonlijk() ? UITLEG.mijnTaken
    : isMijnTakenlijst() ? UITLEG.mijnTakenlijst : '';
  el('lijstUitleg').textContent = uitleg;
  el('lijstUitleg').hidden = !uitleg;
}

async function herlaadTaken() {
  staat.taken = isPersoonlijk() ? await api('/mijn-taken') : await api(`/borden/${staat.bordId}/taken`);
  staat.borden = await api('/borden');
  werkbalkBijwerken();
  tekenZijbalk();
  teken();
}

// ── Filteren ─────────────────────────────────────────────────────────────
/** Alles wat het zoekvak en de drie keuzelijsten overlaten. */
function basisTaken() {
  const zoek = el('zoek').value.trim().toLowerCase();
  const status = el('filterStatus').value;
  const prioriteit = el('filterPrioriteit').value;
  const uitvoerend = el('filterUitvoerend').value;

  return staat.taken.filter(taak => {
    if (status && taak.status !== status) return false;
    if (prioriteit === 'geen' && taak.prioriteit) return false;
    if (prioriteit && prioriteit !== 'geen' && taak.prioriteit !== prioriteit) return false;
    if (uitvoerend && String(taak.uitvoerend_id) !== uitvoerend) return false;
    if (!zoek) return true;
    return (taak.opdracht + ' ' + (taak.uitvoerend_naam || '') + ' ' + taak.omschrijving)
      .toLowerCase().includes(zoek);
  });
}

function gefilterdeTaken() {
  const basis = basisTaken();
  if (staat.deadlineFilter === 'te-laat') return basis.filter(isTeLaat);
  if (staat.deadlineFilter === 'komt-eraan') return basis.filter(komtEraan);
  return basis;
}

// ── Sorteren ─────────────────────────────────────────────────────────────
/**
 * De kolommen waarop je kunt sorteren, met per kolom de waarde waarop
 * vergeleken wordt. Prioriteit wordt vergeleken op zijn plek in de vaste lijst
 * en niet alfabetisch — anders komt Low tussen High en Medium.
 *
 * Status staat er bewust niet bij: de tabel is al op status gegroepeerd, dus
 * daarop sorteren zou niets doen.
 */
const SORTEERBAAR = {
  Opdracht:   (taak) => taak.opdracht,
  Uitvoerend: (taak) => taak.uitvoerend_naam,
  Prioriteit: (taak) => plek(staat.prioriteiten, taak.prioriteit),
  Deadline:   (taak) => taak.deadline,
};

/** Plek in de vaste lijst; onbekend of leeg telt als geen waarde. */
function plek(lijst, waarde) {
  const i = lijst.indexOf(waarde);
  return i === -1 ? null : i;
}

/** Geen waarde ingevuld. Zulke rijen staan altijd onderaan, in beide richtingen. */
const isLeeg = (waarde) => waarde === null || waarde === undefined || waarde === '';

/**
 * Sorteren verandert alleen wat je op je scherm ziet; de opgeslagen volgorde
 * (`positie`) blijft ongemoeid — vandaar een kopie van de lijst. Bij gelijke
 * waarden blijft die eigen volgorde staan, want sorteren in JavaScript is
 * stabiel.
 */
function gesorteerd(taken) {
  if (!staat.sortering) return taken;

  const waardeVan = SORTEERBAAR[staat.sortering.kolom];
  const omgekeerd = staat.sortering.richting === 'af' ? -1 : 1;

  return [...taken].sort((taakA, taakB) => {
    const a = waardeVan(taakA);
    const b = waardeVan(taakB);
    if (isLeeg(a) && isLeeg(b)) return 0;
    if (isLeeg(a)) return 1;
    if (isLeeg(b)) return -1;
    const uitkomst = typeof a === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'nl', { sensitivity: 'base' });
    return uitkomst * omgekeerd;
  });
}

/**
 * De twee tellers boven het overzicht. Ze tellen binnen de basis, dus zonder
 * hun eigen filter; anders zou het getal op nul springen zodra je erop klikt.
 */
function tekenDeadlineKnoppen() {
  const basis = basisTaken();
  const aantal = (n) => (n === 1 ? 'taak' : 'taken');

  tekenTeller('teLaatKnop', 'te-laat', basis.filter(isTeLaat).length,
    (n) => `⚠ ${n} ${aantal(n)} te laat`, 'Alleen verlopen taken tonen');

  tekenTeller('komtEraanKnop', 'komt-eraan', basis.filter(komtEraan).length,
    (n) => `⏱ ${n} ${aantal(n)} ${n === 1 ? 'komt' : 'komen'} eraan`,
    'Alleen taken met een naderende deadline tonen');
}

function tekenTeller(id, soort, gevonden, tekst, filterTitel) {
  const knop = el(id);

  // Niets gevonden? Dan ook geen knop, en een eventueel filter gaat uit —
  // anders sta je naar een leeg scherm te kijken zonder te zien waarom.
  if (gevonden === 0) {
    if (staat.deadlineFilter === soort) staat.deadlineFilter = null;
    knop.classList.remove('actief');
    knop.hidden = true;
    return;
  }

  const aan = staat.deadlineFilter === soort;
  knop.hidden = false;
  knop.textContent = tekst(gevonden);
  knop.classList.toggle('actief', aan);
  knop.title = aan ? 'Klik om alle taken te tonen' : filterTitel;
}

// ── Tekenen ──────────────────────────────────────────────────────────────
function teken() {
  if (staat.weergave === 'prikbord') return tekenMuur();
  if (staat.weergave === 'werkprocessen') return tekenWerkprocessen();
  if (staat.weergave === 'team') return tekenTeam();
  tekenDeadlineKnoppen();
  if (isPersoonlijk()) return tekenMijnTaken();
  tekenTabel();
}

/**
 * Het persoonlijke bord. Eerst per project, daarbinnen per status — zodat je
 * per project ziet waar je nog niet aan begonnen bent en wat al klaar is.
 */
function tekenMijnTaken() {
  const taken = gefilterdeTaken();

  if (taken.length === 0) {
    el('inhoud').innerHTML = `<div class="mijn-leeg">
      ${staat.taken.length === 0
        ? 'Er staan geen taken op jouw naam. Zodra iemand je een taak toewijst in een project, verschijnt die hier.'
        : 'Geen taken die aan je filter voldoen.'}
    </div>`;
    return;
  }

  // Op volgorde van binnenkomst groeperen: de server sorteert al op project.
  const perProject = new Map();
  for (const taak of taken) {
    if (!perProject.has(taak.bord_id)) perProject.set(taak.bord_id, { naam: taak.bord_naam, taken: [] });
    perProject.get(taak.bord_id).taken.push(taak);
  }

  el('inhoud').innerHTML = [...perProject].map(([bordId, project]) => `
    <div class="project-blok">
      <div class="project-kop">
        <h2>${esc(project.naam)}</h2>
        <span class="telling">${project.taken.length} ${project.taken.length === 1 ? 'taak' : 'taken'}</span>
        <a data-open-bord="${bordId}">Open project →</a>
      </div>
      ${statusBlokkenHtml(project.taken)}
    </div>`).join('');

  el('inhoud').querySelectorAll('[data-open-bord]').forEach(link => {
    link.addEventListener('click', () => kiesBord(Number(link.dataset.openBord)));
  });

  koppelStatusKeuzes(el('inhoud'));
  koppelTaakKnoppen(el('inhoud'));
  koppelSorteren(el('inhoud'));
  koppelStatusBlokken(el('inhoud'));
}

// De breedtes zelf staan in stijl.css, zodat elke tabel ze deelt.
const KOLOMMEN = ['Opdracht', 'Uitvoerend', 'Prioriteit', 'Status', 'Deadline',
                  'Bijlagen', 'Stappen', 'Details', 'Acties'];

// Getekende pijltjes, zodat ze meekleuren met de witte letters in de kopbalk.
const CHEVRON_OP = '<polyline points="6 15 12 9 18 15"/>';
const CHEVRON_AF = '<polyline points="6 9 12 15 18 9"/>';
const pijl = (vorm, klasse) => `<svg class="pijl ${klasse}" width="10" height="10" fill="none"
  stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">${vorm}</svg>`;

/**
 * Een kolomkop. De vijf sorteerbare koppen krijgen een pijltje; bij de kolom
 * waarop gesorteerd wordt staat het vast, bij de andere verschijnt het flauw
 * zodra je eroverheen gaat. Het pijltje staat er altijd — anders verspringt de
 * kop op het moment dat je hem aanwijst.
 */
function kopHtml(kolom) {
  if (!SORTEERBAAR[kolom]) return `<th>${kolom}</th>`;

  const actief = staat.sortering?.kolom === kolom;
  const richting = actief ? staat.sortering.richting : null;
  const titel = richting === 'af'
    ? 'Je eigen volgorde herstellen'
    : `Sorteren op ${kolom.toLowerCase()}`;

  return `<th class="sorteerbaar${actief ? ' sorteert' : ''}" data-sorteer="${kolom}" title="${titel}">
    ${kolom}${actief ? pijl(richting === 'af' ? CHEVRON_AF : CHEVRON_OP, 'aan') : pijl(CHEVRON_OP, 'flauw')}
  </th>`;
}

function tabelHtml(taken) {
  const rijen = gesorteerd(taken);
  return `
    <div class="tabel-omhulsel">
      <table>
        <colgroup>${KOLOMMEN.map(k => `<col class="k-${k.toLowerCase()}">`).join('')}</colgroup>
        <thead><tr>${KOLOMMEN.map(kopHtml).join('')}</tr></thead>
        <tbody>${rijen.length === 0
          ? `<tr class="leeg"><td colspan="${KOLOMMEN.length}">Geen taken gevonden.</td></tr>`
          : rijen.map(rijHtml).join('')}</tbody>
      </table>
    </div>`;
}

/** Klikken op een kolomkop loopt rond: oplopend → aflopend → je eigen volgorde. */
function koppelSorteren(wortel) {
  wortel.querySelectorAll('th[data-sorteer]').forEach(kop => {
    kop.addEventListener('click', () => {
      const kolom = kop.dataset.sorteer;
      const nu = staat.sortering;
      staat.sortering = nu?.kolom !== kolom ? { kolom, richting: 'op' }
        : nu.richting === 'op' ? { kolom, richting: 'af' }
        : null;
      teken();
    });
  });
}

function koppelStatusKeuzes(wortel) {
  wortel.querySelectorAll('.status-select[data-taak]').forEach(keuze => {
    keuze.addEventListener('change', async () => {
      await api(`/taken/${keuze.dataset.taak}`, { method: 'PATCH', body: { status: keuze.value } });
      herlaadTaken();
    });
  });

  wortel.querySelectorAll('.status-select[data-prio]').forEach(keuze => {
    keuze.addEventListener('change', async () => {
      await api(`/taken/${keuze.dataset.prio}`, { method: 'PATCH', body: { prioriteit: keuze.value || null } });
      herlaadTaken();
    });
  });
}

// ── Blokken per status ───────────────────────────────────────────────────
// De tabel valt uiteen in een blok per status, in de vaste statusvolgorde.
// Verander je de status van een taak, dan tekent de app het scherm opnieuw en
// springt de rij vanzelf naar het juiste blok.

const KLAP_DICHT = `<polyline points="9 18 15 12 9 6"/>`;
const KLAP_OPEN  = `<polyline points="6 9 12 15 18 9"/>`;

/** Statussen die je hebt dichtgeklapt. Done en Cancelled beginnen dicht. */
function statusBlokkenHtml(taken) {
  // Helemaal niets? Dan één lege tabel met de melding, niet zes keer.
  if (taken.length === 0) return tabelHtml([]);

  return staat.statussen.map(status => {
    const erin = taken.filter(t => t.status === status);
    if (erin.length === 0) return '';   // lege statussen laten we weg

    const dicht = staat.dichtgeklapt.has(status);
    return `
      <section class="status-blok${dicht ? ' dicht' : ''}" data-blok="${esc(status)}"
               style="--status:${KLEUREN[status]}">
        <button type="button" class="status-kop" data-klap="${esc(status)}"
                title="${dicht ? 'Openklappen' : 'Dichtklappen'}">
          <svg class="klap-pijl" width="13" height="13" fill="none" stroke="currentColor"
               stroke-width="2.5" viewBox="0 0 24 24">${dicht ? KLAP_DICHT : KLAP_OPEN}</svg>
          <span class="status-stip"></span>
          <span class="status-naam">${esc(status)}</span>
          <span class="telling">${erin.length} ${erin.length === 1 ? 'taak' : 'taken'}</span>
        </button>
        ${dicht ? '' : tabelHtml(erin)}
      </section>`;
  }).join('');
}

function koppelStatusBlokken(wortel) {
  wortel.querySelectorAll('[data-klap]').forEach(knop => {
    knop.addEventListener('click', () => {
      const status = knop.dataset.klap;
      // Per status, niet per project: klap je Done dicht, dan overal.
      if (staat.dichtgeklapt.has(status)) staat.dichtgeklapt.delete(status);
      else staat.dichtgeklapt.add(status);
      teken();
    });
  });
}

function tekenTabel() {
  el('inhoud').innerHTML = statusBlokkenHtml(gefilterdeTaken());
  koppelStatusKeuzes(el('inhoud'));
  koppelTaakKnoppen(el('inhoud'));
  koppelSorteren(el('inhoud'));
  koppelStatusBlokken(el('inhoud'));
}

function rijHtml(taak) {
  const opties = staat.statussen
    .map(s => `<option value="${esc(s)}" ${s === taak.status ? 'selected' : ''}
                       style="${optieStijl(KLEUREN[s])}">${esc(s)}</option>`).join('');

  const prioOpties =
    `<option value="" ${!taak.prioriteit ? 'selected' : ''} style="${optieStijl(PRIO_KLEUREN[''])}">—</option>` +
    staat.prioriteiten.map(p =>
      `<option value="${esc(p)}" ${p === taak.prioriteit ? 'selected' : ''}
               style="${optieStijl(PRIO_KLEUREN[p])}">${esc(prioTekst(p))}</option>`).join('');

  const teLaat = isTeLaat(taak);
  const eraan = komtEraan(taak);
  const deadline = taak.deadline
    ? `<span class="${teLaat ? 'datum-te-laat' : (eraan ? 'datum-eraan' : '')}">${datumNL(taak.deadline)}</span>`
    : '<span class="zacht">—</span>';

  return `
    <tr class="${teLaat ? 'te-laat' : (eraan ? 'komt-eraan' : '')}"
        ${teLaat || eraan ? `title="${esc(waaromAandacht(taak))}"` : ''}>
      <td class="c-opdracht">
        <strong>${teLaat ? '<span class="teken-te-laat" aria-hidden="true">⚠</span> '
                : (eraan ? '<span class="teken-eraan" aria-hidden="true">⏱</span> ' : '')}${esc(taak.opdracht)}</strong>
        ${teLaat ? `<div class="te-laat-tekst">${esc(teLaatTekst(taak))}</div>` : ''}
      </td>
      <td class="c-kort" ${taak.uitvoerend_naam ? `title="${esc(taak.uitvoerend_naam)}"` : ''}>${
        taak.uitvoerend_naam ? esc(taak.uitvoerend_naam) : '<span class="zacht">—</span>'}</td>
      <td>
        <select class="status-select ${prioKlasse(taak.prioriteit)}" data-prio="${taak.id}"
                style="background:${PRIO_KLEUREN[taak.prioriteit ?? '']}">${prioOpties}</select>
      </td>
      <td>
        <select class="status-select ${statusKlasse(taak.status)}" data-taak="${taak.id}"
                style="background:${KLEUREN[taak.status]}">${opties}</select>
      </td>
      <td>${deadline}</td>
      <td class="c-teller">${taak.aantal_bijlagen
        ? `<span title="${taak.aantal_bijlagen} ${taak.aantal_bijlagen === 1 ? 'bijlage' : 'bijlagen'}">${PAPERCLIP} ${taak.aantal_bijlagen}</span>`
        : '<span class="zacht">—</span>'}</td>
      <td class="c-teller">${taak.aantal_stappen
        ? `<span title="afgevinkte stappen uit werkprocessen"
                 class="${taak.aantal_afgevinkt === taak.aantal_stappen ? 'klaar' : ''}">☑ ${taak.aantal_afgevinkt}/${taak.aantal_stappen}</span>`
        : '<span class="zacht">—</span>'}</td>
      <td class="c-details">
        <button class="knop-link" data-detail="${taak.id}">Bekijk</button>
        ${taak.aantal_opmerkingen ? `<span class="zacht" title="opmerkingen" style="margin-left:6px">💬 ${taak.aantal_opmerkingen}</span>` : ''}
      </td>
      <td><div class="acties">
        <button class="btn btn-secondary btn-sm" data-bewerk="${taak.id}">Bewerken</button>
        <button class="btn btn-danger btn-sm" data-verwijder="${taak.id}">Verwijder</button>
      </div></td>
    </tr>`;
}

// ── Prikbord ─────────────────────────────────────────────────────────────
// Briefjes zijn naslag en geen werk: geen status, geen deadline, geen
// uitvoerende. Ze zijn van jou alleen en staan daarom los van de borden.

const PUNAISE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>`;
const PRULLENBAK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>`;

/**
 * Zet webadressen in de tekst om in een link. Alleen http en https — dezelfde
 * afspraak als bij bijlagen, zodat er geen `javascript:` doorheen glipt. Eerst
 * alles onschadelijk maken met esc(), daarna pas de links erin.
 */
function metLinks(inhoud) {
  return esc(inhoud)
    .replace(/(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g,
      (adres) => `<a href="${adres}" target="_blank" rel="noopener noreferrer">${adres}</a>`)
    .replace(/\n/g, '<br>');
}

const GEEL = '#FDF3A7';

/** De kleur van een briefje: die van zijn categorie, of het standaardgeel. */
function kleurVan(briefje) {
  return staat.categorieen.find(c => c.id === briefje.categorie_id)?.kleur ?? GEEL;
}

/**
 * De kleur als losse waarden, zodat de vervaging onderaan het kaartje dezelfde
 * kleur kan gebruiken. `transparent` in een verloop geeft in sommige browsers
 * een grijze waas; met dezelfde kleur op nul doorzichtigheid nooit.
 */
function kaartStijl(briefje) {
  const kleur = kleurVan(briefje);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(kleur.slice(i, i + 2), 16));
  return `--kaart:${kleur};--kaart-nul:rgba(${r},${g},${b},0)`;
}

/** Wat het zoekvak en de categoriekeuze overlaten. */
function gevondenBriefjes(lijst) {
  const zoek = el('zoek').value.trim().toLowerCase();
  const filter = staat.categorieFilter;

  return lijst.filter(briefje => {
    if (filter === 'geen' && briefje.categorie_id) return false;
    if (filter !== null && filter !== 'geen' && briefje.categorie_id !== filter) return false;
    if (!zoek) return true;
    return (briefje.titel + ' ' + briefje.tekst).toLowerCase().includes(zoek);
  });
}

/**
 * De knoppenbalk om op categorie te filteren. Hij verschijnt pas als je
 * categorieën hebt — anders staat er een balk met alleen "Alles" in.
 */
function tekenCategorieBalk() {
  const balk = el('categorieBalk');
  balk.hidden = staat.prullenbakOpen || staat.categorieen.length === 0;
  if (balk.hidden) return;

  const zonder = staat.briefjes.some(b => !b.categorie_id);
  const knop = (waarde, naam, kleur, aantal) => `
    <button class="cat-knop${staat.categorieFilter === waarde ? ' actief' : ''}"
            data-filter="${waarde}" ${kleur ? `style="--kaart:${kleur}"` : ''}>
      ${kleur ? '<span class="cat-stip"></span>' : ''}${esc(naam)}
      <span class="cat-aantal">${aantal}</span>
    </button>`;

  balk.innerHTML =
    knop('alles', 'Alles', null, staat.briefjes.length)
    + staat.categorieen.map(c => knop(c.id, c.naam, c.kleur,
        staat.briefjes.filter(b => b.categorie_id === c.id).length)).join('')
    + (zonder ? knop('geen', 'Zonder categorie', GEEL,
        staat.briefjes.filter(b => !b.categorie_id).length) : '');

  balk.querySelectorAll('[data-filter]').forEach(k => {
    k.addEventListener('click', () => {
      const waarde = k.dataset.filter;
      staat.categorieFilter = waarde === 'alles' ? null : (waarde === 'geen' ? 'geen' : Number(waarde));
      tekenMuur();
    });
  });
}

/** Hoeveel dagen een weggegooid briefje nog in de prullenbak heeft. */
function dagenTeGaan(briefje) {
  const weg = new Date(briefje.weggegooid_op.replace(' ', 'T') + 'Z');
  const over = staat.prullenbakDagen - Math.floor((Date.now() - weg) / 86400000);
  return Math.max(0, over);
}

async function tekenPrikbord() {
  staat.weergave = 'prikbord';
  el('paginaTitel').textContent = 'Mijn prikbord';
  el('werkbalk').hidden = true;
  el('prikbordBalk').hidden = false;

  const [antwoord, cat] = await Promise.all([api('/briefjes'), api('/briefje-categorieen')]);
  staat.briefjes = antwoord.briefjes;
  staat.prullenbak = antwoord.prullenbak;
  staat.prullenbakDagen = antwoord.prullenbak_dagen;
  staat.categorieen = cat.categorieen;
  staat.postitKleuren = cat.kleuren;
  staat.maxCategorieen = cat.maximum;

  // Stond je te filteren op een categorie die net is weggehaald? Dan alles weer.
  if (typeof staat.categorieFilter === 'number'
      && !staat.categorieen.some(c => c.id === staat.categorieFilter)) {
    staat.categorieFilter = null;
  }

  tekenZijbalk();
  tekenMuur();
}

function tekenMuur() {
  const open = staat.prullenbakOpen;

  // In de prullenbak hoort geen knop om een nieuw briefje te maken, en de weg
  // terug moet een eigen knop zijn — niet nog een keer op Prullenbak klikken.
  el('paginaTitel').textContent = open ? 'Prullenbak' : 'Mijn prikbord';
  el('lijstUitleg').textContent = open ? UITLEG.prullenbak : UITLEG.prikbord;
  el('lijstUitleg').hidden = false;

  el('nieuwBriefjeKnop').hidden = open;
  el('terugKnop').hidden = !open;

  const aantal = staat.prullenbak.length;
  const knop = el('prullenbakKnop');
  knop.innerHTML = `${PRULLENBAK} Prullenbak${aantal ? ` (${aantal})` : ''}`;
  knop.hidden = open || aantal === 0;

  el('categorieKnop').hidden = open;
  tekenCategorieBalk();

  const lijst = gevondenBriefjes(open ? staat.prullenbak : staat.briefjes);
  el('inhoud').innerHTML = lijst.length === 0
    ? `<div class="mijn-leeg">${leegTekst()}</div>`
    : `<div class="muur">${lijst.map(briefjeHtml).join('')}</div>`;

  koppelMuur();
}

function leegTekst() {
  if (el('zoek').value.trim()) return 'Geen briefjes gevonden.';
  if (staat.prullenbakOpen) return 'De prullenbak is leeg.';
  return 'Nog geen notities. Zet hier neer wat je wilt bewaren: '
       + 'instructies, afspraken met collega’s of nummers die je steeds kwijt bent.';
}

function briefjeHtml(briefje) {
  const inPrullenbak = Boolean(briefje.weggegooid_op);
  const dagen = inPrullenbak ? dagenTeGaan(briefje) : 0;

  // Een leeg tekstvak blijft staan, zodat de voet op elk kaartje op dezelfde
  // hoogte eindigt.
  return `
    <article class="briefje${inPrullenbak ? ' weggegooid' : (briefje.vastgepind ? ' vastgepind' : '')}"
             data-briefje="${briefje.id}" style="${kaartStijl(briefje)}"
             ${inPrullenbak ? '' : 'draggable="true"'}>
      <div class="briefje-kop">
        <h3>${esc(briefje.titel)}</h3>
        ${inPrullenbak ? '' : `
          <button class="briefje-knop${briefje.vastgepind ? ' aan' : ''}" data-pin="${briefje.id}"
                  title="${briefje.vastgepind ? 'Losmaken' : 'Bovenaan vastpinnen'}">${PUNAISE}</button>`}
      </div>
      <div class="briefje-tekst">${esc(briefje.tekst)}</div>
      ${inPrullenbak
        ? `<div class="briefje-voet">
             <span class="zacht">Nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}</span>
           </div>
           <div class="briefje-knoppen">
             <button class="knop-link" data-terug="${briefje.id}">Terugzetten</button>
             <button class="knop-link weg" data-weg="${briefje.id}">Definitief weg</button>
           </div>`
        : `<div class="briefje-voet">
             <span class="zacht">${datumNL(briefje.gewijzigd_op || briefje.aangemaakt_op)}</span>
             <button class="briefje-knop" data-weg="${briefje.id}" title="Weggooien">${PRULLENBAK}</button>
           </div>`}
    </article>`;
}

function koppelMuur() {
  const inhoud = el('inhoud');

  // Meten, niet gokken: een briefje krijgt de vervaging pas als zijn tekst
  // langer is dan het kaartje hoog is.
  inhoud.querySelectorAll('.briefje-tekst').forEach(vak => {
    vak.classList.toggle('afgeknipt', vak.scrollHeight > vak.clientHeight + 1);
  });

  // Op het kaartje klikken is lezen; de knoppen erin doen hun eigen ding. In de
  // prullenbak niet: daar kies je eerst terugzetten of definitief weg.
  inhoud.querySelectorAll('.briefje:not(.weggegooid)').forEach(kaart => {
    kaart.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openBriefje(Number(kaart.dataset.briefje), 'lezen');
    });
  });

  inhoud.querySelectorAll('[data-pin]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const briefje = staat.briefjes.find(b => b.id === Number(knop.dataset.pin));
      await api(`/briefjes/${briefje.id}`, { method: 'PATCH', body: { vastgepind: !briefje.vastgepind } });
      tekenPrikbord();
    });
  });

  inhoud.querySelectorAll('[data-weg]').forEach(knop => {
    knop.addEventListener('click', async () => {
      await api(`/briefjes/${knop.dataset.weg}`, { method: 'DELETE' });
      tekenPrikbord();
    });
  });

  inhoud.querySelectorAll('[data-terug]').forEach(knop => {
    knop.addEventListener('click', async () => {
      await api(`/briefjes/${knop.dataset.terug}/terug`, { method: 'POST' });
      tekenPrikbord();
    });
  });

  koppelBriefjesSlepen();
}

/**
 * Slepen om de volgorde te bepalen. De server rekent met de buren die je op je
 * scherm ziet, dus het klopt ook als je op een categorie hebt gefilterd.
 * Vastgepinde briefjes blijven bovenaan staan, wat je ook sleept.
 */
function koppelBriefjesSlepen() {
  const muur = el('inhoud').querySelector('.muur');
  if (!muur) return;
  let gesleept = null;

  muur.querySelectorAll('.briefje[draggable]').forEach(kaart => {
    kaart.addEventListener('dragstart', (e) => {
      gesleept = kaart;
      kaart.classList.add('sleept');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', kaart.dataset.briefje);
    });
    kaart.addEventListener('dragend', () => {
      kaart.classList.remove('sleept');
      gesleept = null;
    });
  });

  muur.addEventListener('dragover', (e) => {
    if (!gesleept) return;
    e.preventDefault();

    // De muur is een raster, dus links-rechts telt net zo goed als boven-onder.
    const anderen = [...muur.querySelectorAll('.briefje:not(.sleept)')];
    const hierna = anderen.find(kaart => {
      const vak = kaart.getBoundingClientRect();
      return e.clientY < vak.bottom
        && (e.clientY < vak.top || e.clientX < vak.left + vak.width / 2);
    });
    muur.insertBefore(gesleept, hierna ?? null);
  });

  muur.addEventListener('drop', async (e) => {
    e.preventDefault();
    const kaart = gesleept;
    if (!kaart) return;

    await api(`/briefjes/${kaart.dataset.briefje}/verplaats`, {
      method: 'POST',
      body: {
        vorige_id: kaart.previousElementSibling?.dataset.briefje ?? null,
        volgende_id: kaart.nextElementSibling?.dataset.briefje ?? null,
      },
    });
    tekenPrikbord();
  });
}

const kleurVanId = (id) => staat.categorieen.find(c => c.id === id)?.kleur ?? GEEL;

// Post-it-kleuren zijn allemaal licht, dus daar horen donkere letters bij —
// niet de witte van optieStijl(), die is voor de volle status- en prioriteitskleuren.
const postitStijl = (kleur) => `background:${kleur};color:#002944`;

/** De keuzelijst in het briefjesvenster, met elke categorie in zijn eigen kleur. */
function vulCategorieKeuze(gekozen) {
  el('brCategorie').innerHTML =
    `<option value="" style="${postitStijl(GEEL)}">Geen categorie</option>`
    + staat.categorieen.map(c =>
        `<option value="${c.id}" ${c.id === gekozen ? 'selected' : ''}
                 style="${postitStijl(c.kleur)}">${esc(c.naam)}</option>`).join('');

  el('brCategorie').value = gekozen ?? '';
  el('brCategorie').style.background = kleurVanId(gekozen);
}

el('brCategorie').addEventListener('change', () => {
  el('brCategorie').style.background = kleurVanId(Number(el('brCategorie').value) || null);
});

/** `stand` is 'lezen' of 'bewerken'; een nieuw briefje begint bij bewerken. */
function openBriefje(id, stand) {
  const briefje = id === null ? null : staat.briefjes.find(b => b.id === id);
  staat.briefjeId = id;
  el('brMelding').textContent = '';

  const lezen = stand === 'lezen' && briefje;
  el('brLezen').hidden = !lezen;
  el('brVorm').hidden = Boolean(lezen);
  el('brBewerken').hidden = !lezen;
  el('brOpslaan').hidden = Boolean(lezen);
  el('brVerwijder').hidden = !briefje;
  el('brAnnuleer').textContent = lezen ? 'Sluiten' : 'Annuleren';
  el('briefjeVensterTitel').textContent = briefje ? briefje.titel : 'Nieuw briefje';

  if (lezen) {
    el('brLeesTekst').innerHTML = briefje.tekst
      ? metLinks(briefje.tekst)
      : '<span class="zacht">Deze notitie heeft alleen een titel.</span>';
    el('brLeesDatum').textContent = briefje.gewijzigd_op
      ? `Gewijzigd op ${datumNL(briefje.gewijzigd_op)}`
      : `Gemaakt op ${datumNL(briefje.aangemaakt_op)}`;
  } else {
    el('brTitel').value = briefje?.titel ?? '';
    el('brTekst').value = briefje?.tekst ?? '';
    el('brVastgepind').checked = Boolean(briefje?.vastgepind);
    vulCategorieKeuze(briefje?.categorie_id ?? null);
    telTitel();
    telTekst();
  }

  el('briefjeVenster').classList.add('open');
  if (!lezen) el('brTitel').focus();
}

/**
 * Laat naast het label zien hoeveel tekens er nog bij kunnen. De browser kapt
 * bij `maxlength` zelf af, maar zonder teller merk je pas dat je aan de grens
 * zit als er niets meer verschijnt — zeker bij plakken.
 */
function maakTekenteller(veldId, tellerId, max) {
  const veld = el(veldId);
  const teller = el(tellerId);

  const bijwerken = () => {
    const over = max - veld.value.length;
    teller.textContent = over === 0 ? 'vol' : `nog ${over} ${over === 1 ? 'teken' : 'tekens'}`;
    teller.classList.toggle('bijna-vol', over > 0 && over <= max / 10);
    teller.classList.toggle('vol', over === 0);
  };

  veld.addEventListener('input', bijwerken);
  return bijwerken;
}

const telTitel = maakTekenteller('brTitel', 'brTitelTeller', 100);
const telTekst = maakTekenteller('brTekst', 'brTekstTeller', 5000);

// ── Categorieën beheren ──────────────────────────────────────────────────
// Naam en kleur worden meteen bewaard zodra je ze wijzigt; er is geen aparte
// opslaanknop, want dan zou je die per regel moeten hebben.

function tekenCategorieVenster() {
  el('catMelding').textContent = '';
  el('catNieuw').hidden = staat.categorieen.length >= staat.maxCategorieen;

  el('catLijst').innerHTML = staat.categorieen.length === 0
    ? '<p class="zacht" style="font-size:.85rem;margin-bottom:12px">Nog geen categorieën.</p>'
    : staat.categorieen.map(c => `
        <div class="cat-regel" data-cat="${c.id}">
          <input type="text" class="cat-naam" value="${esc(c.naam)}" maxlength="40" />
          <div class="cat-kleuren">
            ${staat.postitKleuren.map(k => `
              <button type="button" class="cat-kleur${k.kleur === c.kleur ? ' gekozen' : ''}"
                      data-kleur="${k.kleur}" title="${esc(k.naam)}"
                      style="background:${k.kleur}"></button>`).join('')}
          </div>
          <button class="knop-link weg" data-catweg="${c.id}">Weghalen</button>
        </div>`).join('');

  el('catLijst').querySelectorAll('.cat-regel').forEach(regel => {
    const id = Number(regel.dataset.cat);

    regel.querySelector('.cat-naam').addEventListener('change', async (e) => {
      await bewaarCategorie(id, { naam: e.target.value });
    });

    regel.querySelectorAll('[data-kleur]').forEach(knop => {
      knop.addEventListener('click', () => bewaarCategorie(id, { kleur: knop.dataset.kleur }));
    });
  });

  el('catLijst').querySelectorAll('[data-catweg]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const categorie = staat.categorieen.find(c => c.id === Number(knop.dataset.catweg));
      const aantal = staat.briefjes.filter(b => b.categorie_id === categorie.id).length;

      if (aantal > 0 && !confirm(
        `"${categorie.naam}" weghalen? De ${aantal} ${aantal === 1 ? 'notitie' : 'notities'} `
        + 'in deze categorie blijven staan en worden weer geel.')) return;

      await api(`/briefje-categorieen/${categorie.id}`, { method: 'DELETE' });
      await ververColorenEnTekenen();
    });
  });
}

async function bewaarCategorie(id, wijziging) {
  try {
    await api(`/briefje-categorieen/${id}`, { method: 'PATCH', body: wijziging });
  } catch (fout) {
    el('catMelding').textContent = fout.message;
    return;
  }
  await ververColorenEnTekenen();
}

/** Categorieën opnieuw ophalen, en zowel het venster als de muur bijwerken. */
async function ververColorenEnTekenen() {
  await tekenPrikbord();
  tekenCategorieVenster();
}

el('categorieKnop').addEventListener('click', () => {
  tekenCategorieVenster();
  el('categorieVenster').classList.add('open');
});

el('catToevoegen').addEventListener('click', async () => {
  const naam = el('catNaam').value.trim();
  if (!naam) {
    el('catMelding').textContent = 'Geef de categorie een naam.';
    return;
  }

  try {
    await api('/briefje-categorieen', { method: 'POST', body: { naam } });
  } catch (fout) {
    el('catMelding').textContent = fout.message;
    return;
  }

  el('catNaam').value = '';
  await ververColorenEnTekenen();
});

el('catNaam').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('catToevoegen').click();
});

el('nieuwBriefjeKnop').addEventListener('click', () => openBriefje(null, 'bewerken'));

el('prullenbakKnop').addEventListener('click', () => {
  staat.prullenbakOpen = true;
  tekenMuur();
});

el('terugKnop').addEventListener('click', () => {
  staat.prullenbakOpen = false;
  tekenMuur();
});

el('brBewerken').addEventListener('click', () => openBriefje(staat.briefjeId, 'bewerken'));

el('brOpslaan').addEventListener('click', async () => {
  const body = {
    titel: el('brTitel').value,
    tekst: el('brTekst').value,
    vastgepind: el('brVastgepind').checked,
    categorie_id: Number(el('brCategorie').value) || null,
  };

  if (!body.titel.trim()) {
    el('brMelding').textContent = 'Geef de notitie een titel.';
    return;
  }

  try {
    if (staat.briefjeId === null) await api('/briefjes', { method: 'POST', body });
    else await api(`/briefjes/${staat.briefjeId}`, { method: 'PATCH', body });
  } catch (fout) {
    el('brMelding').textContent = fout.message;
    return;
  }

  el('briefjeVenster').classList.remove('open');
  tekenPrikbord();
});

el('brVerwijder').addEventListener('click', async () => {
  await api(`/briefjes/${staat.briefjeId}`, { method: 'DELETE' });
  el('briefjeVenster').classList.remove('open');
  tekenPrikbord();
});

// ── Knoppen in de tabel ──────────────────────────────────────────────────
function koppelTaakKnoppen(wortel) {
  wortel.querySelectorAll('[data-bewerk]').forEach(knop => {
    knop.addEventListener('click', (e) => { e.stopPropagation(); openTaakVenster(Number(knop.dataset.bewerk)); });
  });

  wortel.querySelectorAll('[data-verwijder]').forEach(knop => {
    knop.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Deze taak verwijderen? Opmerkingen en historie worden ook verwijderd.')) return;
      await api(`/taken/${knop.dataset.verwijder}`, { method: 'DELETE' });
      herlaadTaken();
    });
  });

  wortel.querySelectorAll('[data-detail]').forEach(knop => {
    knop.addEventListener('click', (e) => {
      if (e.target.closest('[data-bewerk], [data-verwijder]')) return;
      openDetail(Number(knop.dataset.detail));
    });
  });
}

// ── Taak toevoegen of bewerken ───────────────────────────────────────────
async function openTaakVenster(id = null) {
  staat.bewerktId = id;
  el('taakMelding').textContent = '';
  el('taakVensterTitel').textContent = id ? 'Taak bewerken' : 'Nieuw item';

  // Even de teamlijst verversen: een collega die net is aangemaakt moet je
  // meteen een taak kunnen geven, zonder de pagina te herladen.
  staat.gebruikers = await api('/gebruikers');
  vulGebruikerKeuzes();

  const taak = id ? staat.taken.find(t => t.id === id) : null;
  const bordVanTaak = taak?.bord_id ?? staat.bordId;

  // Verplaatsen kan alleen bij een bestaande taak, en alleen als er iets is om
  // naartoe te verplaatsen.
  el('vProjectVeld').hidden = !taak || staat.borden.length < 2;
  vulProjectKeuze(bordVanTaak);
  uitvoerendVeldBijwerken(bordVanTaak);
  vulUitvoerendKeuze(taak && taak.bord_id !== staat.bordId
    ? await toegestaneVoorBord(bordVanTaak)
    : staat.toegestaneUitvoerders);

  el('vOpdracht').value     = taak?.opdracht ?? '';
  el('vUitvoerend').value   = taak?.uitvoerend_id ?? '';
  el('vStatus').value       = taak?.status ?? 'Not Started';
  el('vPrioriteit').value   = taak?.prioriteit ?? '';
  el('vDeadline').value     = taak?.deadline ?? '';
  el('vOmschrijving').value = taak?.omschrijving ?? '';

  openVenster('taakVenster');
  el('vOpdracht').focus();

  // Werkprocessen erna, want die haalt gegevens op. Het venster staat dan al open.
  await vulProcesVeld(taak);
}

el('taakOpslaan').addEventListener('click', async () => {
  const gegevens = {
    opdracht: el('vOpdracht').value.trim(),
    // Op je eigen takenlijst staat het veld er niet; dan ben jij de uitvoerder.
    uitvoerend_id: el('vUitvoerendVeld').hidden ? staat.ik.id : (el('vUitvoerend').value || null),
    status: el('vStatus').value,
    prioriteit: el('vPrioriteit').value || null,
    deadline: el('vDeadline').value || null,
    omschrijving: el('vOmschrijving').value.trim(),
  };

  if (!gegevens.opdracht) {
    el('taakMelding').textContent = 'Geef de opdracht een naam.';
    return;
  }

  try {
    let taakId = staat.bewerktId;

    if (taakId) {
      if (!el('vProjectVeld').hidden) gegevens.bord_id = Number(el('vProject').value);
      await api(`/taken/${taakId}`, { method: 'PATCH', body: gegevens });
    } else {
      taakId = (await api(`/borden/${staat.bordId}/taken`, { method: 'POST', body: gegevens })).id;
    }

    await bewaarProcessen(taakId, oorspronkelijkeProcessen);
    await bewaarBijlagen(taakId);

    sluitVenster('taakVenster');
    herlaadTaken();
  } catch (fout) {
    el('taakMelding').textContent = fout.message;
  }
});

// ── Taakdetail: omschrijving, opmerkingen, historie ──────────────────────
async function openDetail(id) {
  staat.detailId = id;
  const taak = await api('/taken/' + id);

  el('detailTitel').textContent = taak.opdracht;
  el('detailTekst').textContent = taak.omschrijving || 'Geen omschrijving.';

  el('detailMeta').innerHTML = `
    <div><span class="naam">Uitvoerend</span><span class="waarde">${esc(taak.uitvoerend_naam || '—')}</span></div>
    <div><span class="naam">Status</span><span class="waarde">
      <span class="status-select ${statusKlasse(taak.status)}" style="background:${KLEUREN[taak.status]};display:inline-block;cursor:default">${esc(taak.status)}</span>
    </span></div>
    <div><span class="naam">Prioriteit</span><span class="waarde">
      <span class="status-select ${prioKlasse(taak.prioriteit)}" style="background:${PRIO_KLEUREN[taak.prioriteit ?? '']};display:inline-block;cursor:default;min-width:auto">${esc(prioTekst(taak.prioriteit))}</span>
    </span></div>
    <div><span class="naam">Deadline</span><span class="waarde ${
      isTeLaat(taak) ? 'datum-te-laat' : (komtEraan(taak) ? 'datum-eraan' : '')
    }">${taak.deadline ? datumNL(taak.deadline) : '—'}</span></div>`;

  const aandacht = isTeLaat(taak) || komtEraan(taak);
  el('detailWaarschuwing').textContent = aandacht ? waaromAandacht(taak) : '';
  el('detailWaarschuwing').classList.toggle('oranje', komtEraan(taak));
  el('detailWaarschuwing').hidden = !aandacht;

  tekenTaakProcessen(taak.processen);
  tekenBijlagen(taak.bijlagen);
  tekenOpmerkingen(taak.opmerkingen);

  el('historieLijst').innerHTML = taak.historie.length === 0
    ? '<li class="zacht">Nog geen wijzigingen.</li>'
    : taak.historie.map(regel => {
        const wie = esc(regel.gebruiker_naam || 'Iemand');
        const wanneer = momentNL(regel.aangemaakt_op);

        if (regel.veld === 'aangemaakt') {
          return `<li><b>${wie}</b> maakte deze taak aan — ${wanneer}</li>`;
        }
        if (regel.veld === 'bijlage toegevoegd') {
          return `<li><b>${wie}</b> voegde de bijlage <b>${esc(regel.nieuwe_waarde)}</b> toe — ${wanneer}</li>`;
        }
        if (regel.veld === 'bijlage verwijderd') {
          return `<li><b>${wie}</b> verwijderde de bijlage <b>${esc(regel.oude_waarde)}</b> — ${wanneer}</li>`;
        }
        if (regel.veld === 'werkproces gekoppeld') {
          return `<li><b>${wie}</b> koppelde het werkproces <b>${esc(regel.nieuwe_waarde)}</b> — ${wanneer}</li>`;
        }
        if (regel.veld === 'werkproces ontkoppeld') {
          return `<li><b>${wie}</b> ontkoppelde het werkproces <b>${esc(regel.oude_waarde)}</b> — ${wanneer}</li>`;
        }
        if (regel.veld === 'project') {
          return `<li><b>${wie}</b> verplaatste deze taak van <b>${esc(regel.oude_waarde)}</b>
            naar <b>${esc(regel.nieuwe_waarde)}</b> — ${wanneer}</li>`;
        }
        return `<li><b>${wie}</b> wijzigde <b>${esc(regel.veld)}</b>
          van “${esc(regel.oude_waarde || 'leeg')}” naar “${esc(regel.nieuwe_waarde || 'leeg')}”
          — ${momentNL(regel.aangemaakt_op)}</li>`;
      }).join('');

  el('nieuweOpmerking').value = '';
  openVenster('detailVenster');
}

// ── Werkprocessen op een taak ────────────────────────────────────────────

// In het detailvenster kun je afvinken, meer niet. Welke werkprocessen aan een
// taak hangen is een instelling, en die staat bij Bewerken.
function tekenTaakProcessen(processen) {
  el('taakProcessen').innerHTML = processen.length === 0
    ? '<p class="zacht" style="font-size:.85rem">Nog geen werkprocessen gekoppeld. Voeg ze toe via <strong>Bewerken</strong>.</p>'
    : processen.map(procesBlokHtml).join('');

  koppelProcesKnoppen();
}

function procesBlokHtml(proces) {
  const af = proces.stappen.filter(stap => stap.afgevinkt_op).length;
  const totaal = proces.stappen.length;
  const klaar = af === totaal && totaal > 0;

  return `
    <div class="taak-proces" data-proces="${proces.id}">
      <div class="taak-proces-kop">
        <span class="naam">${esc(proces.naam)}</span>
        <span class="versie">versie ${proces.versie}</span>
        <span class="voortgang ${klaar ? 'klaar' : ''}">${af} van ${totaal}${klaar ? ' ✓' : ''}</span>
      </div>
      <div class="balkje"><span style="width:${totaal ? Math.round((af / totaal) * 100) : 0}%"></span></div>
      <div>
        ${proces.stappen.map((stap, index) => `
          <label class="proces-stap ${stap.afgevinkt_op ? 'af' : ''}"
                 ${stap.afgevinkt_op ? `title="Afgevinkt door ${esc(stap.afgevinkt_door_naam || 'onbekend')} op ${momentNL(stap.afgevinkt_op)}"` : ''}>
            <input type="checkbox" data-taakstap="${stap.id}" ${stap.afgevinkt_op ? 'checked' : ''} />
            <span class="nr">${index + 1}.</span>
            <span class="tekst">${esc(stap.tekst)}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function koppelProcesKnoppen() {
  el('taakProcessen').querySelectorAll('[data-taakstap]').forEach(vinkje => {
    vinkje.addEventListener('change', async () => {
      try {
        await api('/taak-stappen/' + vinkje.dataset.taakstap, {
          method: 'PATCH',
          body: { afgevinkt: vinkje.checked },
        });
        openDetail(staat.detailId);
        herlaadTaken();
      } catch (fout) {
        vinkje.checked = !vinkje.checked;
        alert(fout.message);
      }
    });
  });

}

// ── Werkprocessen kiezen in het bewerkvenster ────────────────────────────
// Hier bepaal je wélke werkprocessen aan de taak hangen. De wijzigingen worden
// pas doorgevoerd als je opslaat, zodat Annuleren ook echt annuleert.

let conceptProcessen = [];       // { taakProcesId | null, werkprocesId, naam, versie, stappen, af }
let oorspronkelijkeProcessen = [];   // wat er bij het openen op de taak stond
let bibliotheek = [];

async function vulProcesVeld(taak) {
  try {
    bibliotheek = (await api('/werkprocessen')).werkprocessen;
  } catch {
    bibliotheek = [];
  }

  conceptProcessen = [];
  conceptBijlagen = [];

  if (taak) {
    const detail = await api('/taken/' + taak.id);

    conceptProcessen = detail.processen.map(proces => ({
      taakProcesId: proces.id,
      werkprocesId: proces.werkproces_id,
      naam: proces.naam,
      versie: proces.versie,
      stappen: proces.stappen.length,
      af: proces.stappen.filter(stap => stap.afgevinkt_op).length,
    }));

    conceptBijlagen = detail.bijlagen.map(bijlage => ({
      id: bijlage.id,
      naam: bijlage.bestandsnaam,
      grootte: bijlage.grootte,
      bestand: null,
      url: bijlage.url || null,
    }));
  }

  oorspronkelijkeProcessen = conceptProcessen.map(proces => ({ ...proces }));
  oorspronkelijkeBijlagen = conceptBijlagen.map(bijlage => ({ ...bijlage }));
  el('vBijlageHint').textContent = '';
  el('vBijlageHint').classList.remove('fout');
  sluitLinkVak();
  tekenConceptBijlagen();

  const leeg = bibliotheek.length === 0;
  el('vProcesKeuze').innerHTML = leeg
    ? '<option value="">— de bibliotheek is leeg —</option>'
    : bibliotheek.map(p => `<option value="${p.id}">${esc(p.naam)} (${p.aantal_stappen} stappen)</option>`).join('');

  el('vProcesKeuze').disabled = leeg;
  el('vProcesToevoegen').disabled = leeg;
  el('vProcesHint').textContent = leeg ? 'Maak eerst een werkproces aan via Werkprocessen in de zijbalk.' : '';

  tekenConceptProcessen();
}

function tekenConceptProcessen() {
  el('vProcessen').innerHTML = conceptProcessen.length === 0
    ? '<p class="zacht" style="font-size:.82rem;margin-bottom:4px">Nog geen werkprocessen gekozen.</p>'
    : conceptProcessen.map((proces, index) => `
        <div class="proces-regel" data-concept="${index}">
          <span class="hendel" title="Sleep om te verplaatsen">${GRIJPER}</span>
          <span class="naam">${esc(proces.naam)}</span>
          <span class="versie">versie ${proces.versie}</span>
          <span class="bij">${proces.stappen} stappen${proces.af ? ` · ${proces.af} afgevinkt` : ''}</span>
          <button type="button" class="weg" data-conceptweg="${index}" title="Verwijderen">✕</button>
        </div>`).join('');

  el('vProcessen').querySelectorAll('[data-conceptweg]').forEach(knop => {
    knop.addEventListener('click', () => {
      const proces = conceptProcessen[Number(knop.dataset.conceptweg)];

      // Alleen waarschuwen als er werk verloren gaat.
      if (proces.af > 0 &&
          !confirm(`"${proces.naam}" verwijderen? Er zijn ${proces.af} stappen afgevinkt; die gaan verloren.`)) return;

      conceptProcessen.splice(Number(knop.dataset.conceptweg), 1);
      tekenConceptProcessen();
    });
  });

  koppelConceptSlepen();
}

function koppelConceptSlepen() {
  let gesleept = null;

  el('vProcessen').querySelectorAll('.proces-regel').forEach(regel => {
    regel.querySelector('.hendel').addEventListener('mousedown', () => { regel.draggable = true; });

    regel.addEventListener('dragstart', (gebeurtenis) => {
      gesleept = regel;
      regel.classList.add('sleept');
      gebeurtenis.dataTransfer.effectAllowed = 'move';
    });

    regel.addEventListener('dragend', () => {
      regel.draggable = false;
      regel.classList.remove('sleept');
      gesleept = null;

      conceptProcessen = [...el('vProcessen').querySelectorAll('.proces-regel')]
        .map(r => conceptProcessen[Number(r.dataset.concept)]);
      tekenConceptProcessen();
    });

    regel.addEventListener('dragover', (gebeurtenis) => {
      if (!gesleept || gesleept === regel) return;
      gebeurtenis.preventDefault();

      const vak = regel.getBoundingClientRect();
      const bovenhelft = gebeurtenis.clientY < vak.top + vak.height / 2;
      regel.parentNode.insertBefore(gesleept, bovenhelft ? regel : regel.nextSibling);
    });
  });
}

el('vProcesToevoegen').addEventListener('click', () => {
  const gekozen = bibliotheek.find(p => p.id === Number(el('vProcesKeuze').value));
  if (!gekozen) return;

  conceptProcessen.push({
    taakProcesId: null,
    werkprocesId: gekozen.id,
    naam: gekozen.naam,
    versie: gekozen.versie,
    stappen: gekozen.aantal_stappen,
    af: 0,
  });
  tekenConceptProcessen();
});

/**
 * Brengt de gekozen werkprocessen in overeenstemming met wat er op de taak
 * staat. Wordt pas bij het opslaan aangeroepen.
 */
async function bewaarProcessen(taakId, oorspronkelijk) {
  const behouden = new Set(conceptProcessen.map(p => p.taakProcesId).filter(Boolean));

  for (const proces of oorspronkelijk) {
    if (!behouden.has(proces.taakProcesId)) {
      await api('/taak-processen/' + proces.taakProcesId, { method: 'DELETE' });
    }
  }

  const volgorde = [];
  for (const proces of conceptProcessen) {
    if (proces.taakProcesId) {
      volgorde.push(proces.taakProcesId);
    } else {
      const nieuw = await api(`/taken/${taakId}/processen`, {
        method: 'POST',
        body: { werkproces_id: proces.werkprocesId },
      });
      volgorde.push(nieuw.id);
    }
  }

  if (volgorde.length > 1) {
    await api(`/taken/${taakId}/processen/volgorde`, { method: 'POST', body: { volgorde } });
  }
}

// ── Bijlagen ─────────────────────────────────────────────────────────────

function leesbareGrootte(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}


// In het detailvenster open je bijlagen; toevoegen en verwijderen hoort bij
// Bewerken, net als bij de werkprocessen.
function tekenBijlagen(bijlagen) {
  el('bijlagenLijst').innerHTML = bijlagen.length === 0
    ? '<p class="zacht" style="font-size:.85rem">Nog geen bijlagen. Voeg ze toe via <strong>Bewerken</strong>.</p>'
    : bijlagen.map(b => `
        <div class="bijlage">
          ${b.url ? SCHAKEL : PAPERCLIP}
          ${b.url
            ? `<a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.bestandsnaam)}</a>`
            : `<a href="/api/bijlagen/${b.id}" download>${esc(b.bestandsnaam)}</a>`}
          <span class="bij">${b.url ? esc(bestemming(b.url)) : leesbareGrootte(b.grootte)} · ${esc(b.geupload_door_naam || 'onbekend')}</span>
        </div>`).join('');

  el('allesDownloaden').hidden = bijlagen.length < 2;
}

el('allesDownloaden').addEventListener('click', () => {
  // Een gewone link naar de server; die stuurt de ZIP als download terug.
  const link = document.createElement('a');
  link.href = `/api/taken/${staat.detailId}/bijlagen.zip`;
  link.download = '';
  link.click();
});

/** Stuurt het bestand als kale stroom; de naam gaat mee in een header. */
async function uploadBijlage(taakId, bestand) {
  const antwoord = await fetch(`/api/taken/${taakId}/bijlagen`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-bestandsnaam': encodeURIComponent(bestand.name),
      'x-bestandstype': bestand.type || 'onbekend',
    },
    body: bestand,
  });

  const data = await antwoord.json().catch(() => ({}));
  if (!antwoord.ok) throw new Error(data.fout || 'Uploaden is mislukt.');
  return data;
}

// ── Bijlagen kiezen in het bewerkvenster ─────────────────────────────────
// Net als bij de werkprocessen: de keuzes gaan pas bij Opslaan naar de server,
// zodat je bij een nieuwe taak alvast bestanden kunt aanwijzen en Annuleren
// werkelijk annuleert.

let conceptBijlagen = [];            // { id | null, naam, grootte, bestand | null, url | null }
let oorspronkelijkeBijlagen = [];

/** Waar een link heen gaat, zodat je dat ziet voordat je klikt. */
function bestemming(url) {
  try { return new URL(url).host; } catch { return url; }
}

function tekenConceptBijlagen() {
  el('vBijlagen').innerHTML = conceptBijlagen.length === 0
    ? '<p class="zacht" style="font-size:.82rem;margin-bottom:4px">Nog geen bijlagen.</p>'
    : conceptBijlagen.map((bijlage, index) => `
        <div class="bijlage">
          ${bijlage.url ? SCHAKEL : PAPERCLIP}
          <span style="flex:1;min-width:0;word-break:break-all">${esc(bijlage.naam)}</span>
          <span class="bij">${bijlage.url ? esc(bestemming(bijlage.url)) : leesbareGrootte(bijlage.grootte)}${bijlage.id ? '' : ' · nieuw'}</span>
          <button type="button" class="weg" data-bijlageweg="${index}" title="Verwijderen">✕</button>
        </div>`).join('');

  el('vBijlagen').querySelectorAll('[data-bijlageweg]').forEach(knop => {
    knop.addEventListener('click', () => {
      conceptBijlagen.splice(Number(knop.dataset.bijlageweg), 1);
      tekenConceptBijlagen();
    });
  });
}

el('vBijlageInvoer').addEventListener('change', (gebeurtenis) => {
  const hint = el('vBijlageHint');
  hint.classList.remove('fout');
  hint.textContent = '';

  for (const bestand of gebeurtenis.target.files) {
    // Zelf al kijken hoe groot het is: dan hoeft een te groot bestand niet
    // eerst helemaal naar de server voordat je hoort dat het niet past.
    if (bestand.size > staat.maxBijlageMB * 1024 * 1024) {
      hint.textContent = `${bestand.name} is ${leesbareGrootte(bestand.size)}. ` +
        `Maximaal ${staat.maxBijlageMB} MB per bestand.`;
      hint.classList.add('fout');
      continue;
    }
    conceptBijlagen.push({ id: null, naam: bestand.name, grootte: bestand.size, bestand });
  }

  gebeurtenis.target.value = '';        // zodat hetzelfde bestand opnieuw kan
  tekenConceptBijlagen();
});

// ── Een link als bijlage ─────────────────────────────────────────────────
function sluitLinkVak() {
  el('vLinkVak').hidden = true;
  el('vLinkAdres').value = '';
  el('vLinkNaam').value = '';
}

el('vLinkKnop').addEventListener('click', () => {
  el('vBijlageHint').textContent = '';
  el('vBijlageHint').classList.remove('fout');
  el('vLinkVak').hidden = false;
  el('vLinkAdres').focus();
});

el('vLinkAnnuleer').addEventListener('click', sluitLinkVak);

el('vLinkOpslaan').addEventListener('click', () => {
  const hint = el('vBijlageHint');
  hint.classList.remove('fout');

  // De server keurt het adres af als het niet deugt; hier alleen genoeg om
  // meteen te kunnen laten zien wat je hebt gekozen.
  let adres = el('vLinkAdres').value.trim();
  if (!adres) {
    hint.textContent = 'Vul een adres in.';
    hint.classList.add('fout');
    return;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(adres)) adres = 'https://' + adres;
  if (!/^https?:\/\//i.test(adres)) {
    hint.textContent = 'Alleen adressen die met http:// of https:// beginnen.';
    hint.classList.add('fout');
    return;
  }

  hint.textContent = '';
  conceptBijlagen.push({
    id: null, naam: el('vLinkNaam').value.trim() || bestemming(adres),
    grootte: 0, bestand: null, url: adres,
  });
  sluitLinkVak();
  tekenConceptBijlagen();
});

/** Voert de gekozen bijlagen door. Wordt pas bij het opslaan aangeroepen. */
async function bewaarBijlagen(taakId) {
  const behouden = new Set(conceptBijlagen.map(b => b.id).filter(Boolean));

  for (const bijlage of oorspronkelijkeBijlagen) {
    if (!behouden.has(bijlage.id)) await api('/bijlagen/' + bijlage.id, { method: 'DELETE' });
  }

  for (const bijlage of conceptBijlagen) {
    if (bijlage.id) continue;                 // stond er al
    if (bijlage.url) {
      await api(`/taken/${taakId}/bijlagen/link`, {
        method: 'POST', body: { url: bijlage.url, naam: bijlage.naam },
      });
      continue;
    }
    el('taakMelding').textContent = `Bezig met uploaden van ${bijlage.naam}…`;
    await uploadBijlage(taakId, bijlage.bestand);
  }
}

function tekenOpmerkingen(opmerkingen) {
  el('opmerkingenLijst').innerHTML = opmerkingen.length === 0
    ? '<p class="zacht" style="font-size:.85rem">Nog geen opmerkingen.</p>'
    : opmerkingen.map(o => `
        <div class="opmerking">
          <span class="bolletje">${esc(initialen(o.gebruiker_naam))}</span>
          <div class="inhoud">
            <div class="regel">
              <span class="wie">${esc(o.gebruiker_naam || 'Onbekend')}</span>
              <span class="wanneer">${momentNL(o.aangemaakt_op)}</span>
            </div>
            <div class="tekst">${esc(o.tekst)}</div>
          </div>
          ${(o.gebruiker_id === staat.ik.id || staat.ik.rol === 'beheerder')
            ? `<button class="weg" data-opmerking="${o.id}">verwijder</button>` : ''}
        </div>`).join('');

  el('opmerkingenLijst').querySelectorAll('[data-opmerking]').forEach(knop => {
    knop.addEventListener('click', async () => {
      await api('/opmerkingen/' + knop.dataset.opmerking, { method: 'DELETE' });
      openDetail(staat.detailId);
      herlaadTaken();
    });
  });
}

el('plaatsOpmerking').addEventListener('click', async () => {
  const tekst = el('nieuweOpmerking').value.trim();
  if (!tekst) return;
  await api(`/taken/${staat.detailId}/opmerkingen`, { method: 'POST', body: { tekst } });
  el('nieuweOpmerking').value = '';
  openDetail(staat.detailId);
  herlaadTaken();
});

el('detailBewerk').addEventListener('click', () => {
  sluitVenster('detailVenster');
  openTaakVenster(staat.detailId);
});

el('detailVerwijder').addEventListener('click', async () => {
  if (!confirm('Deze taak verwijderen? Opmerkingen en historie worden ook verwijderd.')) return;
  await api('/taken/' + staat.detailId, { method: 'DELETE' });
  sluitVenster('detailVenster');
  herlaadTaken();
});

// ── Werkprocessen: de bibliotheek ────────────────────────────────────────

async function tekenWerkprocessen() {
  staat.weergave = 'werkprocessen';
  el('paginaTitel').textContent = 'Werkprocessen';
  el('werkbalk').hidden = true;
  el('prikbordBalk').hidden = true;
  el('categorieBalk').hidden = true;
  el('lijstUitleg').hidden = true;
  tekenZijbalk();

  const { mag_beheren, werkprocessen } = await api('/werkprocessen');
  staat.magWerkprocessen = mag_beheren;

  el('inhoud').innerHTML = `
    <div style="max-width:900px">
      <p class="hint" style="margin:0 0 16px">
        Vaste werkwijzen die je aan een taak kunt koppelen. Klik op “Nieuw werkproces”, plak een
        bestaande procedure in het tekstvak en de app knipt die in stappen. De stappen kun je
        daarna nog aanpassen.
        ${mag_beheren ? '' : '<br><strong>Je mag werkprocessen wel bekijken, maar niet wijzigen.</strong> Vraag een beheerder om dat recht.'}
      </p>

      ${mag_beheren ? '<button class="btn btn-primary" id="nieuwProcesKnop" style="margin-bottom:16px">Nieuw werkproces</button>' : ''}

      ${werkprocessen.length === 0
        ? '<div class="mijn-leeg">Er zijn nog geen werkprocessen. Maak er een door op de knop “Nieuw werkproces” te klikken.</div>'
        : werkprocessen.map(proces => `
            <div class="proces-kaart">
              <div class="inhoud">
                <h3>${esc(proces.naam)}</h3>
                <div class="bij">
                  ${proces.aantal_stappen} ${proces.aantal_stappen === 1 ? 'stap' : 'stappen'}
                  ${proces.toelichting ? '· ' + esc(proces.toelichting) : ''}
                  · door ${esc(proces.aangemaakt_door_naam || 'onbekend')}
                </div>
              </div>
              <span class="versie">versie ${proces.versie}</span>
              <button class="btn btn-secondary btn-sm" data-bekijk="${proces.id}">
                ${mag_beheren ? 'Bekijken en wijzigen' : 'Bekijken'}
              </button>
            </div>`).join('')}
    </div>`;

  el('nieuwProcesKnop')?.addEventListener('click', () => openProcesVenster(null));
  el('inhoud').querySelectorAll('[data-bekijk]').forEach(knop => {
    knop.addEventListener('click', () => openProcesVenster(Number(knop.dataset.bekijk)));
  });
}

// ── Werkprocesvenster met voorvertoning ──────────────────────────────────
// De voorvertoning is de waarheid: wat daar staat wordt opgeslagen. Daarom kun
// je er stappen aanpassen, verwijderen, verplaatsen en toevoegen.

let procesId = null;
let conceptStappen = [];

const GRIJPER = `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/></svg>`;

async function openProcesVenster(id) {
  procesId = id;
  el('pMelding').textContent = '';
  el('procesVensterTitel').textContent = id ? 'Werkproces' : 'Nieuw werkproces';
  el('pTekst').value = '';

  if (id) {
    const proces = await api('/werkprocessen/' + id);
    el('pNaam').value = proces.naam;
    el('pToelichting').value = proces.toelichting;
    conceptStappen = [...proces.stappen];
  } else {
    el('pNaam').value = '';
    el('pToelichting').value = '';
    conceptStappen = [];
  }

  // Zonder recht mag je kijken, niet wijzigen.
  const mag = staat.magWerkprocessen;
  for (const veld of ['pNaam', 'pToelichting', 'pTekst']) el(veld).readOnly = !mag;
  el('pStapErbij').hidden = !mag;
  el('pOpslaan').hidden = !mag;
  el('pVerwijder').hidden = !mag || !id;

  // Eerst openen, dan tekenen. Een verborgen tekstvak heeft geen hoogte, en dan
  // zouden de vakken op nul blijven staan en de tekst onzichtbaar zijn.
  openVenster('procesVenster');
  tekenConceptStappen();
  if (mag) el('pNaam').focus();
}

function tekenConceptStappen() {
  const mag = staat.magWerkprocessen;

  el('pAantal').textContent = conceptStappen.length === 0
    ? ''
    : `— ${conceptStappen.length} ${conceptStappen.length === 1 ? 'stap' : 'stappen'}`;

  el('pStappen').innerHTML = conceptStappen.length === 0
    ? '<div class="stappen-leeg">Nog geen stappen. Plak hierboven je procedure.</div>'
    : conceptStappen.map((stap, index) => `
        <div class="stap-regel" data-regel="${index}">
          ${mag ? `<span class="hendel" title="Sleep om te verplaatsen">${GRIJPER}</span>` : ''}
          <span class="nummer">${index + 1}.</span>
          <textarea rows="1" data-stap="${index}" ${mag ? '' : 'readonly'}>${esc(stap)}</textarea>
          ${mag ? '<button class="weg" data-weg="' + index + '" title="Verwijderen">✕</button>' : ''}
        </div>`).join('');

  el('pStappen').querySelectorAll('[data-stap]').forEach(veld => {
    pasHoogteAan(veld);

    // Tekst bijwerken zonder opnieuw te tekenen, anders raak je de cursor kwijt.
    veld.addEventListener('input', () => {
      // Eén stap is één regel; geplakte regeleindes worden spaties.
      if (veld.value.includes('\n')) veld.value = veld.value.replace(/\s*\n\s*/g, ' ');
      conceptStappen[Number(veld.dataset.stap)] = veld.value;
      pasHoogteAan(veld);
    });

    veld.addEventListener('keydown', (gebeurtenis) => {
      if (gebeurtenis.key === 'Enter') gebeurtenis.preventDefault();
    });
  });

  el('pStappen').querySelectorAll('[data-weg]').forEach(knop => {
    knop.addEventListener('click', () => {
      conceptStappen.splice(Number(knop.dataset.weg), 1);
      tekenConceptStappen();
    });
  });

  if (mag) koppelStappenSlepen();
}

/** Laat het tekstvak meegroeien met de inhoud. */
function pasHoogteAan(veld) {
  veld.style.height = 'auto';

  // Staat het veld (nog) niet op het scherm, dan meet de browser nul. Die nul
  // vastzetten zou de tekst onzichtbaar maken; laat de hoogte dan met rust.
  if (veld.scrollHeight > 0) veld.style.height = veld.scrollHeight + 'px';
}

/**
 * Slepen aan de hendel. De regel zelf is niet sleepbaar: anders kun je geen
 * tekst meer selecteren in het tekstvak.
 */
function koppelStappenSlepen() {
  let gesleept = null;

  el('pStappen').querySelectorAll('.stap-regel').forEach(regel => {
    const hendel = regel.querySelector('.hendel');

    hendel.addEventListener('mousedown', () => { regel.draggable = true; });
    regel.addEventListener('dragend', () => {
      regel.draggable = false;
      regel.classList.remove('sleept');
      gesleept = null;
      legVolgordeVast();
    });

    regel.addEventListener('dragstart', (gebeurtenis) => {
      gesleept = regel;
      regel.classList.add('sleept');
      gebeurtenis.dataTransfer.effectAllowed = 'move';
      gebeurtenis.dataTransfer.setData('text/plain', regel.dataset.regel);
    });

    regel.addEventListener('dragover', (gebeurtenis) => {
      if (!gesleept || gesleept === regel) return;
      gebeurtenis.preventDefault();

      const vak = regel.getBoundingClientRect();
      const bovenhelft = gebeurtenis.clientY < vak.top + vak.height / 2;
      regel.parentNode.insertBefore(gesleept, bovenhelft ? regel : regel.nextSibling);
    });
  });

  el('pStappen').addEventListener('drop', (gebeurtenis) => gebeurtenis.preventDefault());
}

/** Leest de volgorde van het scherm terug en tekent opnieuw met nieuwe nummers. */
function legVolgordeVast() {
  const volgorde = [...el('pStappen').querySelectorAll('.stap-regel')]
    .map(regel => conceptStappen[Number(regel.dataset.regel)]);

  if (volgorde.length === conceptStappen.length && volgorde.every(stap => stap !== undefined)) {
    conceptStappen = volgorde;
  }
  tekenConceptStappen();
}

// Plakken of typen vervangt de voorvertoning; dat staat er ook bij.
el('pTekst').addEventListener('input', () => {
  conceptStappen = splitsStappen(el('pTekst').value);
  el('pMelding').textContent = conceptStappen.length > MAX_STAPPEN
    ? `Dit zijn ${conceptStappen.length} stappen. Er passen er maximaal ${MAX_STAPPEN} in één werkproces.`
    : '';
  tekenConceptStappen();
});

el('pStapErbij').addEventListener('click', () => {
  conceptStappen.push('');
  tekenConceptStappen();
  el('pStappen').querySelector('[data-stap="' + (conceptStappen.length - 1) + '"]')?.focus();
});

el('pOpslaan').addEventListener('click', async () => {
  const stappen = conceptStappen.map(stap => stap.trim()).filter(Boolean);

  if (!el('pNaam').value.trim()) return toonProcesFout('Geef het werkproces een naam.');
  if (stappen.length === 0) return toonProcesFout('Er zijn geen stappen. Plak een procedure of voeg er handmatig een toe.');

  const gegevens = {
    naam: el('pNaam').value.trim(),
    toelichting: el('pToelichting').value.trim(),
    stappen,
  };

  try {
    if (procesId) await api('/werkprocessen/' + procesId, { method: 'PATCH', body: gegevens });
    else await api('/werkprocessen', { method: 'POST', body: gegevens });

    sluitVenster('procesVenster');
    tekenWerkprocessen();
  } catch (fout) {
    toonProcesFout(fout.message);
  }
});

el('pVerwijder').addEventListener('click', async () => {
  if (!confirm(`"${el('pNaam').value}" verwijderen uit de bibliotheek?`)) return;
  try {
    await api('/werkprocessen/' + procesId, { method: 'DELETE' });
    sluitVenster('procesVenster');
    tekenWerkprocessen();
  } catch (fout) {
    toonProcesFout(fout.message);
  }
});

function toonProcesFout(bericht) {
  el('pMelding').textContent = bericht;
  el('pMelding').classList.remove('goed');
}

el('werkprocessenKnop').addEventListener('click', tekenWerkprocessen);

// ── Bordinstellingen ─────────────────────────────────────────────────────
let instellingenBordId = null;

async function openBordVenster() {
  instellingenBordId = staat.bordId;
  const bord = await api(`/borden/${staat.bordId}/instellingen`);
  const taken = staat.taken;

  el('bNaam').value = bord.naam;
  el('bIedereen').checked = bord.zichtbaar_voor_iedereen;
  el('bGekozen').checked = !bord.zichtbaar_voor_iedereen;
  el('bMelding').textContent = '';

  // Wie een taak op dit bord heeft, kan er niet uit: die zou anders werk
  // toegewezen krijgen dat hij niet kan openen.
  const metTaak = new Set(taken.map(t => t.uitvoerend_id).filter(Boolean));

  el('bLeden').innerHTML = staat.gebruikers.filter(g => g.actief).map(g => {
    const beheerder = g.rol === 'beheerder';
    const vast = beheerder || metTaak.has(g.id);
    const reden = beheerder ? 'beheerder' : metTaak.has(g.id) ? 'heeft hier een taak' : '';

    return `<label class="${vast ? 'vast' : ''}">
      <input type="checkbox" value="${g.id}"
             ${vast || bord.leden.includes(g.id) ? 'checked' : ''} ${vast ? 'disabled' : ''} />
      ${esc(g.naam)}
      ${reden ? `<span class="reden">${reden}</span>` : ''}
    </label>`;
  }).join('');

  el('bHint').textContent = 'Gebruikers met een taak op dit bord houden altijd toegang. ' +
    'Beheerders zien elk bord. Zo kan een bord nooit onbereikbaar worden.';

  el('bVerwijder').hidden = !bord.mag_beheren;
  ledenlijstBijwerken();
  openVenster('bordVenster');
}

function ledenlijstBijwerken() {
  el('bLeden').classList.toggle('open', el('bGekozen').checked);
}

el('bIedereen').addEventListener('change', ledenlijstBijwerken);
el('bGekozen').addEventListener('change', ledenlijstBijwerken);

el('bOpslaan').addEventListener('click', async () => {
  const leden = [...el('bLeden').querySelectorAll('input:checked')].map(i => Number(i.value));

  try {
    await api('/borden/' + instellingenBordId, {
      method: 'PATCH',
      body: {
        naam: el('bNaam').value.trim(),
        zichtbaar_voor_iedereen: el('bIedereen').checked,
        leden,
      },
    });
    sluitVenster('bordVenster');
    staat.borden = await api('/borden');
    kiesBord(instellingenBordId);
  } catch (fout) {
    el('bMelding').textContent = fout.message;
  }
});

el('bVerwijder').addEventListener('click', async () => {
  const bord = staat.borden.find(b => b.id === instellingenBordId);
  if (!confirm(`"${bord?.naam}" verwijderen? Alle taken, opmerkingen en historie erop gaan mee.`)) return;

  try {
    await api('/borden/' + instellingenBordId, { method: 'DELETE' });
    sluitVenster('bordVenster');
    staat.borden = await api('/borden');
    kiesBord(null);
  } catch (fout) {
    el('bMelding').textContent = fout.message;
  }
});

el('bordInstellingenKnop').addEventListener('click', openBordVenster);

// ── Mijn account ─────────────────────────────────────────────────────────
el('wieBenIk').addEventListener('click', () => {
  el('aNaam').value = staat.ik.naam;
  el('aEmail').value = staat.ik.email;
  el('aHuidig').value = '';
  el('aNieuw').value = '';
  el('aHerhaal').value = '';
  for (const id of ['aNaamMelding', 'aWachtwoordMelding']) {
    el(id).textContent = '';
    el(id).classList.remove('goed');
  }
  openVenster('accountVenster');
});

el('aNaamKnop').addEventListener('click', async () => {
  const melding = el('aNaamMelding');
  melding.classList.remove('goed');
  try {
    const { naam } = await api('/mij', { method: 'PATCH', body: { naam: el('aNaam').value } });

    // Overal waar je naam staat opnieuw ophalen: de zijbalk, de keuzelijsten
    // en de taken die al in beeld staan.
    staat.ik.naam = naam;
    el('wieBenIk').textContent = naam;
    staat.gebruikers = await api('/gebruikers');
    vulGebruikerKeuzes();
    await herlaadTaken();

    melding.textContent = 'Je naam is gewijzigd.';
    melding.classList.add('goed');
  } catch (fout) {
    melding.textContent = fout.message;
  }
});

el('aWachtwoordKnop').addEventListener('click', async () => {
  const melding = el('aWachtwoordMelding');
  melding.classList.remove('goed');

  // Je ziet niet wat je typt; twee keer hetzelfde is de enige manier om zeker
  // te weten dat er geen typefout in zit.
  if (el('aNieuw').value !== el('aHerhaal').value) {
    melding.textContent = 'De nieuwe wachtwoorden komen niet overeen. Voer beide opnieuw in.';
    el('aHerhaal').value = '';
    return;
  }

  try {
    await api('/wachtwoord', {
      method: 'POST',
      body: { huidig: el('aHuidig').value, nieuw: el('aNieuw').value },
    });
    el('aHuidig').value = '';
    el('aNieuw').value = '';
    el('aHerhaal').value = '';
    melding.textContent = 'Je wachtwoord is gewijzigd. Je blijft gewoon ingelogd.';
    melding.classList.add('goed');
  } catch (fout) {
    melding.textContent = fout.message;
  }
});

// De twee tellers sluiten elkaar uit: een taak is nooit tegelijk te laat en
// komt-eraan, dus samen aanzetten zou altijd een leeg scherm geven.
for (const [id, soort] of [['teLaatKnop', 'te-laat'], ['komtEraanKnop', 'komt-eraan']]) {
  el(id).addEventListener('click', () => {
    staat.deadlineFilter = staat.deadlineFilter === soort ? null : soort;
    teken();
  });
}

// ── Teamscherm ───────────────────────────────────────────────────────────
// `bericht` blijft staan nadat het scherm opnieuw is getekend — anders zou een
// melding meteen weer verdwijnen doordat we hieronder alles overschrijven.
async function tekenTeam(bericht = null) {
  staat.weergave = 'team';
  el('paginaTitel').textContent = 'Team';
  el('werkbalk').hidden = true;
  el('prikbordBalk').hidden = true;
  el('categorieBalk').hidden = true;
  el('lijstUitleg').hidden = true;
  tekenZijbalk();

  staat.gebruikers = await api('/gebruikers');
  vulGebruikerKeuzes();

  const beheerder = staat.ik.rol === 'beheerder';
  const uitnodigingen = beheerder ? await api('/uitnodigingen') : [];

  el('inhoud').innerHTML = `
    ${beheerder ? `
      <div class="kaartje">
        <h3>Collega uitnodigen</h3>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div class="veld" style="flex:1;min-width:220px">
            <label for="uitEmail">E-mailadres</label>
            <input type="email" id="uitEmail" placeholder="collega@transafe.nl" />
          </div>
          <div class="veld" style="width:150px">
            <label for="uitRol">Rol</label>
            <select id="uitRol"><option value="lid">Lid</option><option value="beheerder">Beheerder</option></select>
          </div>
          <button class="btn btn-primary" id="uitnodigKnop">Uitnodiging maken</button>
        </div>
        <div class="melding" id="uitMelding" style="margin-top:12px"></div>
        <p style="margin-top:10px;font-size:.8rem;color:var(--grijs)">
          De app verstuurt zelf geen e-mail. Je krijgt hieronder een link die je persoonlijk doorstuurt.
        </p>

        ${uitnodigingen.length ? `
          <h3 style="margin-top:22px">Openstaande uitnodigingen</h3>
          ${uitnodigingen.map(u => `
            <div class="uitnodig-link">
              <code>${esc(u.email)} — ${location.origin}/inloggen.html?uitnodiging=${esc(u.token)}</code>
              <button class="btn btn-secondary btn-sm" data-kopieer="${location.origin}/inloggen.html?uitnodiging=${esc(u.token)}">Kopieer</button>
              <button class="btn btn-danger btn-sm" data-introk="${esc(u.token)}">Intrekken</button>
            </div>`).join('')}` : ''}
      </div>` : ''}

    <div class="kaartje">
      <h3>Teamleden</h3>
      <div class="melding" id="herstelMelding" style="margin-bottom:12px"></div>
      <table class="team-tabel">
        <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Werkprocessen</th><th>Status</th>${beheerder ? '<th></th>' : ''}</tr></thead>
        <tbody>${staat.gebruikers.map(g => `
          <tr>
            <td><strong>${esc(g.naam)}</strong>${g.id === staat.ik.id ? ' <span class="zacht">(jij)</span>' : ''}</td>
            <td>${esc(g.email)}</td>
            <td>${g.rol === 'beheerder' ? 'Beheerder' : 'Lid'}</td>
            <td>${g.rol === 'beheerder'
              ? '<span class="zacht" title="Beheerders mogen dit altijd">altijd</span>'
              : `<label style="display:flex;align-items:center;gap:6px;font-size:.82rem;${beheerder ? 'cursor:pointer' : ''}">
                   <input type="checkbox" data-proc-recht="${g.id}" ${g.mag_werkprocessen ? 'checked' : ''} ${beheerder ? '' : 'disabled'} />
                   mag beheren
                 </label>`}</td>
            <td>${g.actief ? 'Actief' : '<span class="zacht">Uitgeschakeld</span>'}</td>
            ${beheerder ? `<td><div class="acties">
              ${g.id === staat.ik.id ? '' : `
                <button class="btn btn-secondary btn-sm" data-rol="${g.id}" data-nieuw="${g.rol === 'beheerder' ? 'lid' : 'beheerder'}">
                  Maak ${g.rol === 'beheerder' ? 'lid' : 'beheerder'}
                </button>`}
              <button class="btn btn-secondary btn-sm" data-naam="${g.id}">Naam wijzigen</button>
              <button class="btn btn-secondary btn-sm" data-herstel="${g.id}">Wachtwoord herstellen</button>
              ${g.id === staat.ik.id ? '' : `
                <button class="btn ${g.actief ? 'btn-danger' : 'btn-secondary'} btn-sm" data-actief="${g.id}" data-waarde="${g.actief ? 0 : 1}">
                  ${g.actief ? 'Uitschakelen' : 'Inschakelen'}
                </button>`}
              ${!g.actief && g.heeft_takenlijst ? `
                <button class="btn btn-secondary btn-sm" data-overnemen="${g.id}" data-wie="${esc(g.naam)}">
                  Takenlijst overnemen
                </button>` : ''}
            </div></td>` : ''}
          </tr>`).join('')}</tbody>
      </table>
      ${beheerder ? `<p class="hint" style="margin-top:12px">
        Is iemand het wachtwoord kwijt? Klik op <strong>Wachtwoord herstellen</strong>.
        Je krijgt een link die je persoonlijk doorgeeft. Je collega kiest daarmee zelf een
        nieuw wachtwoord, zodat jij het wachtwoord nooit kent.
      </p>` : ''}
    </div>

    ${beheerder ? `
      <div class="kaartje">
        <h3>Inlogboek</h3>
        <p class="hint" style="margin-bottom:12px">
          Hier zie je wie er is ingelogd en wie dat zonder succes probeerde. Een reeks mislukte
          pogingen op één adres is reden om het wachtwoord van die collega te laten wijzigen.
          Regels verdwijnen na 90 dagen automatisch.
        </p>
        <button class="btn btn-secondary btn-sm" id="inlogboekKnop">Inlogboek tonen</button>
        <div id="inlogboek"></div>
      </div>` : ''}`;

  if (bericht) {
    const melding = el('uitMelding');
    melding.textContent = bericht.tekst;
    melding.classList.toggle('goed', bericht.goed);
  }

  koppelTeamKnoppen();
}

/** De teksten bij de soorten uit het inlogboek. */
const LOGSOORTEN = {
  inloggen:    { gelukt: 'Ingelogd',                     mislukt: 'Inloggen mislukt' },
  geblokkeerd: { gelukt: 'Geblokkeerd',                  mislukt: 'Geblokkeerd door de rem' },
  wachtwoord:  { gelukt: 'Wachtwoord gewijzigd',         mislukt: 'Wachtwoord wijzigen mislukt' },
  herstel:     { gelukt: 'Nieuw wachtwoord via herstellink', mislukt: 'Herstellink mislukt' },
  registreren: { gelukt: 'Account aangemaakt',           mislukt: 'Account aanmaken mislukt' },
  installatie: { gelukt: 'Eerste beheerder aangemaakt',  mislukt: 'Installatie mislukt' },
};

/**
 * Haalt het inlogboek op en zet het onder de knop; nog een klik klapt het weer
 * dicht. Alleen beheerders zien dit.
 */
async function toonInlogboek() {
  const vak = el('inlogboek');
  const knop = el('inlogboekKnop');

  if (vak.dataset.open) {
    vak.innerHTML = '';
    delete vak.dataset.open;
    knop.textContent = 'Inlogboek tonen';
    return;
  }

  vak.dataset.open = '1';
  knop.textContent = 'Inlogboek verbergen';
  vak.textContent = 'Bezig met ophalen…';

  try {
    const { regels } = await api('/inlogboek?aantal=100');

    if (!regels.length) {
      vak.innerHTML = '<p class="hint" style="margin-top:12px">Nog niets opgeschreven.</p>';
      return;
    }

    vak.innerHTML = `
      <table class="team-tabel" style="margin-top:14px">
        <thead><tr><th>Wanneer</th><th>Wat</th><th>Wie</th><th>Vanaf</th></tr></thead>
        <tbody>${regels.map(r => {
          const namen = LOGSOORTEN[r.soort] ?? { gelukt: r.soort, mislukt: r.soort };
          return `
          <tr>
            <td>${momentNL(r.moment)}</td>
            <td>${r.gelukt
              ? esc(namen.gelukt)
              : `<span style="color:var(--rood)">${esc(namen.mislukt)}</span>`}</td>
            <td>${esc(r.naam || r.email || 'onbekend')}</td>
            <td class="zacht">${esc(r.ip || '')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  } catch (fout) {
    vak.textContent = fout.message;
  }
}

function koppelTeamKnoppen() {
  el('inlogboekKnop')?.addEventListener('click', toonInlogboek);

  el('uitnodigKnop')?.addEventListener('click', async () => {
    const melding = el('uitMelding');
    melding.classList.remove('goed');
    try {
      const adres = el('uitEmail').value.trim();
      await api('/uitnodigingen', {
        method: 'POST',
        body: { email: adres, rol: el('uitRol').value },
      });

      el('uitEmail').value = '';

      // De melding gaat mee het opnieuw tekenen in, anders wist hij zichzelf.
      tekenTeam({
        goed: true,
        tekst: `Uitnodiging voor ${adres} aangemaakt. Stuur de link hieronder naar je collega.`,
      });
    } catch (fout) {
      melding.textContent = fout.message;
    }
  });

  el('inhoud').querySelectorAll('[data-kopieer]').forEach(knop => {
    knop.addEventListener('click', () => {
      navigator.clipboard.writeText(knop.dataset.kopieer);
      knop.textContent = 'Gekopieerd';
      setTimeout(() => { knop.textContent = 'Kopieer'; }, 1500);
    });
  });

  el('inhoud').querySelectorAll('[data-introk]').forEach(knop => {
    knop.addEventListener('click', async () => {
      await api('/uitnodigingen/' + knop.dataset.introk, { method: 'DELETE' });
      tekenTeam();
    });
  });

  el('inhoud').querySelectorAll('[data-rol]').forEach(knop => {
    knop.addEventListener('click', async () => {
      try {
        await api('/gebruikers/' + knop.dataset.rol, { method: 'PATCH', body: { rol: knop.dataset.nieuw } });
        tekenTeam();
      } catch (fout) { alert(fout.message); }
    });
  });

  el('inhoud').querySelectorAll('[data-proc-recht]').forEach(vinkje => {
    vinkje.addEventListener('change', async () => {
      try {
        await api('/gebruikers/' + vinkje.dataset.procRecht, {
          method: 'PATCH',
          body: { mag_werkprocessen: vinkje.checked },
        });
      } catch (fout) {
        vinkje.checked = !vinkje.checked;
        alert(fout.message);
      }
    });
  });

  el('inhoud').querySelectorAll('[data-herstel]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const melding = el('herstelMelding');
      try {
        const { token } = await api(`/gebruikers/${knop.dataset.herstel}/herstel`, { method: 'POST' });
        const link = `${location.origin}/inloggen.html?herstel=${token}`;

        melding.innerHTML = `Geef deze link persoonlijk door. De link is twee dagen geldig en werkt eenmalig:
          <div class="uitnodig-link"><code>${esc(link)}</code></div>`;
        melding.classList.add('goed');
        navigator.clipboard?.writeText(link);
      } catch (fout) {
        melding.textContent = fout.message;
        melding.classList.remove('goed');
      }
    });
  });

  el('inhoud').querySelectorAll('[data-actief]').forEach(knop => {
    knop.addEventListener('click', async () => {
      try {
        await api('/gebruikers/' + knop.dataset.actief, { method: 'PATCH', body: { actief: Number(knop.dataset.waarde) === 1 } });
        tekenTeam();
      } catch (fout) { alert(fout.message); }
    });
  });

  // De takenlijst van een vertrokken collega overnemen. Alleen bij iemand die
  // is uitgeschakeld; zolang iemand werkt, blijft zijn lijst van hem alleen.
  el('inhoud').querySelectorAll('[data-overnemen]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const wie = knop.dataset.wie;
      if (!confirm(
        `De takenlijst van ${wie} overnemen?\n\n`
        + 'De lijst wordt een gewoon project dat alleen jij ziet, met de naam '
        + `"Takenlijst van ${wie}". De taken komen op niemands naam, `
        + 'zodat je ze kunt verdelen. Dit is niet terug te draaien.')) return;

      try {
        const bord = await api(`/gebruikers/${knop.dataset.overnemen}/takenlijst-overnemen`,
          { method: 'POST' });
        staat.borden = await api('/borden');

        // Eerst opnieuw tekenen (de knop hoort weg te zijn), dan pas de melding
        // zetten — anders wist het opnieuw tekenen hem meteen weer.
        await tekenTeam();
        const melding = el('herstelMelding');
        melding.textContent = `"${bord.naam}" staat nu bij je projecten, met `
          + `${bord.aantal_taken} ${bord.aantal_taken === 1 ? 'taak' : 'taken'} zonder uitvoerder.`;
        melding.classList.add('goed');
      } catch (fout) { alert(fout.message); }
    });
  });

  // Een beheerder kan de naam van een collega herstellen, bijvoorbeeld na een
  // typefout bij het aanmaken van het account.
  el('inhoud').querySelectorAll('[data-naam]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const gebruiker = staat.gebruikers.find(g => g.id === Number(knop.dataset.naam));
      const nieuw = prompt(`Nieuwe naam voor ${gebruiker.naam}:`, gebruiker.naam);
      if (nieuw === null) return;

      const melding = el('herstelMelding');
      melding.classList.remove('goed');
      try {
        await api(`/gebruikers/${gebruiker.id}`, { method: 'PATCH', body: { naam: nieuw } });
        staat.gebruikers = await api('/gebruikers');
        if (gebruiker.id === staat.ik.id) {
          staat.ik.naam = nieuw.trim();
          el('wieBenIk').textContent = staat.ik.naam;
        }
        vulGebruikerKeuzes();

        // Opnieuw tekenen gooit de melding weg, dus die zetten we erna terug —
        // en tekenTeam is async, dus wachten tot hij klaar is.
        await tekenTeam();
        el('herstelMelding').textContent = `De naam is gewijzigd in ${nieuw.trim()}.`;
        el('herstelMelding').classList.add('goed');
      } catch (fout) {
        melding.textContent = fout.message;
      }
    });
  });
}

// ── Werkbalk ─────────────────────────────────────────────────────────────
el('nieuwTaakKnop').addEventListener('click', () => openTaakVenster());
el('zoek').addEventListener('input', () => { if (staat.weergave !== 'team') teken(); });
el('filterStatus').addEventListener('change', teken);
el('filterPrioriteit').addEventListener('change', teken);
el('filterUitvoerend').addEventListener('change', teken);
// Let op de pijl: geef je tekenTeam rechtstreeks mee, dan komt de klik zelf in
// `bericht` terecht en zet het scherm het woord "undefined" in de melding.
el('teamKnop').addEventListener('click', () => tekenTeam());

el('nieuwBordKnop').addEventListener('click', async () => {
  const naam = prompt('Naam van het nieuwe bord:');
  if (!naam || !naam.trim()) return;
  const bord = await api('/borden', { method: 'POST', body: { naam: naam.trim() } });
  staat.borden = await api('/borden');
  kiesBord(bord.id);
});

el('uitlogKnop').addEventListener('click', async () => {
  await api('/uitloggen', { method: 'POST' });
  location.href = '/inloggen.html';
});

el('exportKnop').addEventListener('click', () => {
  // Op het persoonlijke bord staan taken uit meerdere projecten door elkaar,
  // dus dan hoort het project er in de export bij.
  const kolommen = isPersoonlijk()
    ? ['Project', 'Opdracht', 'Uitvoerend', 'Prioriteit', 'Status', 'Deadline', 'Omschrijving']
    : ['Opdracht', 'Uitvoerend', 'Prioriteit', 'Status', 'Deadline', 'Omschrijving'];

  const veld = (waarde) => `"${String(waarde ?? '').replace(/"/g, '""')}"`;

  // Wat je op je scherm ziet, staat ook zo in het bestand: zelfde filters,
  // zelfde sortering.
  const regels = gesorteerd(gefilterdeTaken()).map(t => {
    const waarden = [t.opdracht, t.uitvoerend_naam, t.prioriteit, t.status, t.deadline, t.omschrijving];
    return (isPersoonlijk() ? [t.bord_naam, ...waarden] : waarden).map(veld).join(',');
  });

  const blob = new Blob(['﻿' + [kolommen.join(','), ...regels].join('\r\n')],
    { type: 'text/csv;charset=utf-8;' });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'transafe_taken.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});

start().catch(fout => {
  document.body.innerHTML = `<div class="inlog-scherm"><div class="inlog-kaart">
    <div class="inlog-logo"><span>Trans</span>afe</div>
    <div class="melding">${esc(fout.message)}</div></div></div>`;
});
