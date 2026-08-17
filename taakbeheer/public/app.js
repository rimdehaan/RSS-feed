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
  weergave: 'tabel',   // 'tabel' | 'kanban' | 'team' | 'werkprocessen'
  bewerktId: null,
  detailId: null,
  deadlineFilter: null,  // null | 'te-laat' | 'komt-eraan'
  toegestaneUitvoerders: null,   // null = iedereen mag; anders een Set met ids
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
  if (taak.deadline === vandaag()) return 'De deadline is vandaag en er wordt nog niet aan gewerkt.';
  return 'De deadline is morgen en er wordt nog niet aan gewerkt.';
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

// Kies je een ander project, dan verandert ook wie de taak mag uitvoeren.
el('vProject').addEventListener('change', async () => {
  try {
    vulUitvoerendKeuze(await toegestaneVoorBord(Number(el('vProject').value)));
  } catch (fout) {
    el('taakMelding').textContent = fout.message;
  }
});

const isPersoonlijk = () => staat.bordId === null;

/** Je eigen takenlijst; die staat als enige bord met prive_van in de lijst. */
const mijnTakenlijst = () => staat.borden.find(b => b.prive_van) ?? null;
const isMijnTakenlijst = () => staat.bordId !== null && staat.bordId === mijnTakenlijst()?.id;

function tekenZijbalk() {
  const opMijnBord = isPersoonlijk() && staat.weergave !== 'team';
  const lijst = mijnTakenlijst();

  el('persoonlijkLijst').innerHTML = `
    <a data-mijn class="${opMijnBord ? 'actief' : ''}">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span>Mijn taken</span>
    </a>
    ${lijst ? `
      <a data-bord="${lijst.id}" class="${lijst.id === staat.bordId && staat.weergave !== 'team' ? 'actief' : ''}">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>
        <span>${esc(lijst.naam)}</span>
        <span class="telling">${lijst.aantal_taken}</span>
      </a>` : ''}`;

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
        <a data-bord="${bord.id}" class="${bord.id === staat.bordId && staat.weergave !== 'team' ? 'actief' : ''}">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <span>${esc(bord.naam)}</span>
          ${bord.zichtbaar_voor_iedereen ? '' : '<span class="telling" title="Alleen zichtbaar voor gekozen mensen">🔒</span>'}
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
  if (staat.weergave === 'team' || staat.weergave === 'werkprocessen') staat.weergave = 'tabel';

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
  werkbalkBijwerken();
  tekenZijbalk();
  teken();
}

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

  // Eén regel uitleg boven je eigen lijst, zodat niemand hoeft te raden wie er
  // meekijkt — en wat er gebeurt als je uit dienst gaat.
  el('lijstUitleg').hidden = !isMijnTakenlijst();
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

/**
 * De twee tellers boven het overzicht. Ze tellen binnen de basis, dus zonder
 * hun eigen filter; anders zou het getal op nul springen zodra je erop klikt.
 */
function tekenDeadlineKnoppen() {
  const basis = basisTaken();
  const aantal = (n) => (n === 1 ? 'taak' : 'taken');

  tekenTeller('teLaatKnop', 'te-laat', basis.filter(isTeLaat).length,
    (n) => `⚠ ${n} ${aantal(n)} te laat`, 'de te late taken');

  tekenTeller('komtEraanKnop', 'komt-eraan', basis.filter(komtEraan).length,
    (n) => `⏱ ${n} ${aantal(n)} ${n === 1 ? 'komt' : 'komen'} eraan`,
    'de taken waarvan de deadline eraan komt');
}

function tekenTeller(id, soort, gevonden, tekst, waarover) {
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
  knop.title = aan ? 'Klik om weer alle taken te tonen' : `Klik om alleen ${waarover} te tonen`;
}

// ── Tekenen ──────────────────────────────────────────────────────────────
function teken() {
  if (staat.weergave === 'werkprocessen') return tekenWerkprocessen();
  if (staat.weergave === 'team') return tekenTeam();
  tekenDeadlineKnoppen();
  if (isPersoonlijk()) return tekenMijnTaken();
  if (staat.weergave === 'kanban') return tekenKanban();
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
        ? 'Er staan geen taken op jouw naam. Zodra iemand je een taak toewijst in een project, verschijnt hij hier.'
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
      ${staat.weergave === 'kanban' ? kolommenHtml(project.taken) : tabelHtml(project.taken)}
    </div>`).join('');

  el('inhoud').querySelectorAll('[data-open-bord]').forEach(link => {
    link.addEventListener('click', () => kiesBord(Number(link.dataset.openBord)));
  });

  if (staat.weergave === 'kanban') koppelSlepen();
  koppelStatusKeuzes(el('inhoud'));
  koppelTaakKnoppen(el('inhoud'));
}

// De breedtes zelf staan in stijl.css, zodat elke tabel ze deelt.
const KOLOMMEN = ['Opdracht', 'Uitvoerend', 'Prioriteit', 'Status', 'Deadline',
                  'Bijlagen', 'Stappen', 'Details', 'Acties'];

function tabelHtml(taken) {
  return `
    <div class="tabel-omhulsel">
      <table>
        <colgroup>${KOLOMMEN.map(k => `<col class="k-${k.toLowerCase()}">`).join('')}</colgroup>
        <thead><tr>${KOLOMMEN.map(k => `<th>${k}</th>`).join('')}</tr></thead>
        <tbody>${taken.length === 0
          ? `<tr class="leeg"><td colspan="${KOLOMMEN.length}">Geen taken gevonden.</td></tr>`
          : taken.map(rijHtml).join('')}</tbody>
      </table>
    </div>`;
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

function tekenTabel() {
  el('inhoud').innerHTML = tabelHtml(gefilterdeTaken());
  koppelStatusKeuzes(el('inhoud'));
  koppelTaakKnoppen(el('inhoud'));
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

function kolommenHtml(taken) {
  return `<div class="kanban">${staat.statussen.map(status => {
    const inKolom = taken.filter(t => t.status === status);
    return `
      <div class="kolom" data-status="${esc(status)}" data-bord="${taken[0]?.bord_id ?? staat.bordId}">
        <div class="kolom-kop">
          <span class="kolom-stip" style="background:${KLEUREN[status]}"></span>
          ${esc(status)}
          <span class="telling">${inKolom.length}</span>
        </div>
        <div class="kolom-lijst" data-lijst="${esc(status)}">
          ${inKolom.map(kaartHtml).join('')}
        </div>
      </div>`;
  }).join('')}</div>`;
}

function tekenKanban() {
  el('inhoud').innerHTML = kolommenHtml(gefilterdeTaken());
  koppelSlepen();
  koppelTaakKnoppen(el('inhoud'));
}

function kaartHtml(taak) {
  const teLaat = isTeLaat(taak);
  const eraan = komtEraan(taak);
  return `
    <div class="kaart ${teLaat ? 'te-laat' : (eraan ? 'komt-eraan' : '')}" draggable="true" data-taak="${taak.id}"
         data-detail="${taak.id}" data-bord="${taak.bord_id}"
         ${teLaat || eraan ? `title="${esc(waaromAandacht(taak))}"` : ''}>
      ${taak.prioriteit
        ? `<span class="prio-vlag ${prioKlasse(taak.prioriteit)}">${esc(prioTekst(taak.prioriteit))}</span>`
        : ''}
      <div class="kaart-titel">${
        teLaat ? '<span class="teken-te-laat" aria-hidden="true">⚠</span> '
               : (eraan ? '<span class="teken-eraan" aria-hidden="true">⏱</span> ' : '')}${esc(taak.opdracht)}</div>
      ${teLaat ? `<div class="te-laat-tekst">${esc(teLaatTekst(taak))}</div>` : ''}
      <div class="kaart-voet">
        ${taak.uitvoerend_naam && !isPersoonlijk()
          ? `<span class="bolletje" title="${esc(taak.uitvoerend_naam)}">${esc(initialen(taak.uitvoerend_naam))}</span>`
          : ''}
        ${taak.deadline
          ? `<span class="${teLaat ? 'datum-te-laat' : (eraan ? 'datum-eraan' : '')}">${datumNL(taak.deadline)}</span>`
          : ''}
        ${taak.aantal_opmerkingen ? `<span title="opmerkingen">💬 ${taak.aantal_opmerkingen}</span>` : ''}
        ${taak.aantal_bijlagen ? `<span title="bijlagen">${PAPERCLIP} ${taak.aantal_bijlagen}</span>` : ''}
        ${taak.aantal_stappen ? `<span title="stappen uit werkprocessen" class="${taak.aantal_afgevinkt === taak.aantal_stappen ? 'klaar' : ''}">☑ ${taak.aantal_afgevinkt}/${taak.aantal_stappen}</span>` : ''}
      </div>
    </div>`;
}

// ── Slepen op het kanbanbord ─────────────────────────────────────────────
function koppelSlepen() {
  let gesleept = null;

  el('inhoud').querySelectorAll('.kaart').forEach(kaart => {
    kaart.addEventListener('dragstart', (e) => {
      gesleept = kaart;
      kaart.classList.add('sleept');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', kaart.dataset.taak);
    });
    kaart.addEventListener('dragend', () => {
      kaart.classList.remove('sleept');
      gesleept = null;
    });
  });

  el('inhoud').querySelectorAll('.kolom').forEach(kolom => {
    const lijst = kolom.querySelector('.kolom-lijst');

    kolom.addEventListener('dragover', (e) => {
      if (!gesleept) return;
      // Op het persoonlijke bord staan meerdere projecten onder elkaar. Een taak
      // naar een ander project slepen zou hem verhuizen, en dat is niet wat een
      // statuskolom hoort te doen.
      if (gesleept.dataset.bord !== kolom.dataset.bord) return;

      e.preventDefault();
      kolom.classList.add('sleep-over');

      // Zoek de kaart waar de muis boven zit en zet de gesleepte kaart ervoor.
      const anderen = [...lijst.querySelectorAll('.kaart:not(.sleept)')];
      const hierna = anderen.find(kaart => {
        const vak = kaart.getBoundingClientRect();
        return e.clientY < vak.top + vak.height / 2;
      });
      lijst.insertBefore(gesleept, hierna ?? null);
    });

    kolom.addEventListener('dragleave', (e) => {
      if (!kolom.contains(e.relatedTarget)) kolom.classList.remove('sleep-over');
    });

    kolom.addEventListener('drop', async (e) => {
      e.preventDefault();
      kolom.classList.remove('sleep-over');
      const kaart = gesleept;
      if (!kaart || kaart.dataset.bord !== kolom.dataset.bord) return;

      try {
        await api(`/taken/${kaart.dataset.taak}/verplaats`, {
          method: 'POST',
          body: {
            status: kolom.dataset.status,
            vorige_id: kaart.previousElementSibling?.dataset.taak ?? null,
            volgende_id: kaart.nextElementSibling?.dataset.taak ?? null,
          },
        });
      } catch (fout) {
        alert(fout.message);
      }
      herlaadTaken();
    });
  });
}

// ── Knoppen in tabel en kanban ───────────────────────────────────────────
function koppelTaakKnoppen(wortel) {
  wortel.querySelectorAll('[data-bewerk]').forEach(knop => {
    knop.addEventListener('click', (e) => { e.stopPropagation(); openTaakVenster(Number(knop.dataset.bewerk)); });
  });

  wortel.querySelectorAll('[data-verwijder]').forEach(knop => {
    knop.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Deze taak verwijderen? Opmerkingen en historie gaan mee.')) return;
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
    uitvoerend_id: el('vUitvoerend').value || null,
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
  el('vProcesHint').textContent = leeg ? 'Maak er eerst een via Werkprocessen in de zijbalk.' : '';

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
  if (!confirm('Deze taak verwijderen? Opmerkingen en historie gaan mee.')) return;
  await api('/taken/' + staat.detailId, { method: 'DELETE' });
  sluitVenster('detailVenster');
  herlaadTaken();
});

// ── Werkprocessen: de bibliotheek ────────────────────────────────────────

async function tekenWerkprocessen() {
  staat.weergave = 'werkprocessen';
  el('paginaTitel').textContent = 'Werkprocessen';
  el('werkbalk').hidden = true;
  tekenZijbalk();

  const { mag_beheren, werkprocessen } = await api('/werkprocessen');
  staat.magWerkprocessen = mag_beheren;

  el('inhoud').innerHTML = `
    <div style="max-width:900px">
      <p class="hint" style="margin:0 0 16px">
        Vaste werkwijzen die je straks aan een taak kunt hangen. Je maakt ze door een
        bestaande procedure te plakken; de app knipt hem in stappen die je nog kunt bijwerken.
        ${mag_beheren ? '' : '<br><strong>Je mag ze wel bekijken, maar niet wijzigen.</strong> Vraag een beheerder om dat recht.'}
      </p>

      ${mag_beheren ? '<button class="btn btn-primary" id="nieuwProcesKnop" style="margin-bottom:16px">Nieuw werkproces</button>' : ''}

      ${werkprocessen.length === 0
        ? '<div class="mijn-leeg">Er zijn nog geen werkprocessen. Maak er een door je eerste procedure te plakken.</div>'
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

  el('bHint').textContent = 'Mensen die hier al een taak hebben staan houden altijd toegang, ' +
    'en beheerders zien elk bord. Zo kan een bord nooit onbereikbaar worden.';

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
  try {
    await api('/wachtwoord', {
      method: 'POST',
      body: { huidig: el('aHuidig').value, nieuw: el('aNieuw').value },
    });
    el('aHuidig').value = '';
    el('aNieuw').value = '';
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
          De app verstuurt zelf geen mail. Je krijgt hieronder een link die je persoonlijk doorstuurt.
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
      <table>
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
            </div></td>` : ''}
          </tr>`).join('')}</tbody>
      </table>
      ${beheerder ? `<p class="hint" style="margin-top:12px">
        Is iemand zijn wachtwoord kwijt? Klik op <strong>Wachtwoord herstellen</strong>.
        Je krijgt dan een link die je persoonlijk doorgeeft; je collega kiest daarmee
        zelf een nieuw wachtwoord. Zo weet jij zijn wachtwoord niet.
      </p>` : ''}
    </div>`;

  if (bericht) {
    const melding = el('uitMelding');
    melding.textContent = bericht.tekst;
    melding.classList.toggle('goed', bericht.goed);
  }

  koppelTeamKnoppen();
}

function koppelTeamKnoppen() {
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

        melding.innerHTML = `Geef deze link persoonlijk door — hij is twee dagen geldig en werkt één keer:
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
el('teamKnop').addEventListener('click', tekenTeam);

document.querySelectorAll('[data-weergave]').forEach(knop => {
  knop.addEventListener('click', () => {
    document.querySelectorAll('[data-weergave]').forEach(k => k.classList.toggle('actief', k === knop));
    staat.weergave = knop.dataset.weergave;
    teken();
  });
});

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

  const regels = gefilterdeTaken().map(t => {
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
