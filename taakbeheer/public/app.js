// Transafe Taakbeheer — alles wat er in de browser gebeurt.

// ── Gedeelde toestand ────────────────────────────────────────────────────
const staat = {
  ik: null,
  statussen: [],
  gebruikers: [],
  borden: [],
  bordId: null,
  taken: [],
  mailAan: false,
  weergave: 'tabel',   // 'tabel' | 'kanban' | 'team'
  bewerktId: null,
  detailId: null,
};

const KLEUREN = {
  'Not Started':   '#B3B3B3',
  'Working on it': '#F2C94C',
  'Validating':    '#9B51E0',
  'Done':          '#27AE60',
  'On Hold':       '#F2994A',
  'Cancelled':     '#EB5757',
};

const el = (id) => document.getElementById(id);
const statusKlasse = (status) => 's-' + status.toLowerCase().replace(/\s+/g, '-');

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

function isVerlopen(taak) {
  if (!taak.deadline || taak.status === 'Done' || taak.status === 'Cancelled') return false;
  return taak.deadline < new Date().toISOString().slice(0, 10);
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
  const { gebruiker, statussen, mail } = await api('/ik');
  if (!gebruiker) { location.href = '/inloggen.html'; return; }

  staat.ik = gebruiker;
  staat.statussen = statussen;
  staat.mailAan = mail;
  el('wieBenIk').textContent = gebruiker.naam;

  vulStatusKeuzes();
  staat.gebruikers = await api('/gebruikers');
  vulGebruikerKeuzes();

  staat.borden = await api('/borden');
  if (staat.borden.length === 0) {
    await api('/borden', { method: 'POST', body: { naam: 'Takenbord' } });
    staat.borden = await api('/borden');
  }

  tekenZijbalk();
  await kiesBord(staat.borden[0].id);
}

function vulStatusKeuzes() {
  const opties = staat.statussen.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  el('vStatus').innerHTML = opties;
  el('filterStatus').innerHTML = '<option value="">Alle statussen</option>' + opties;
}

function vulGebruikerKeuzes() {
  const actief = staat.gebruikers.filter(g => g.actief);
  const opties = actief.map(g => `<option value="${g.id}">${esc(g.naam)}</option>`).join('');
  el('vUitvoerend').innerHTML = '<option value="">— niemand —</option>' + opties;
  el('filterUitvoerend').innerHTML = '<option value="">Iedereen</option>' + opties;
}

function tekenZijbalk() {
  el('bordenLijst').innerHTML = staat.borden.map(bord => `
    <a data-bord="${bord.id}" class="${bord.id === staat.bordId && staat.weergave !== 'team' ? 'actief' : ''}">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span>${esc(bord.naam)}</span>
      <span class="telling">${bord.aantal_taken}</span>
    </a>`).join('');

  el('bordenLijst').querySelectorAll('[data-bord]').forEach(link => {
    link.addEventListener('click', () => kiesBord(Number(link.dataset.bord)));
  });

  el('teamKnop').classList.toggle('actief', staat.weergave === 'team');
}

async function kiesBord(id) {
  staat.bordId = id;
  if (staat.weergave === 'team') staat.weergave = 'tabel';
  staat.taken = await api(`/borden/${id}/taken`);

  const bord = staat.borden.find(b => b.id === id);
  el('paginaTitel').textContent = bord ? bord.naam : 'Takenbord';
  el('werkbalk').hidden = false;

  tekenZijbalk();
  teken();
}

async function herlaadTaken() {
  staat.taken = await api(`/borden/${staat.bordId}/taken`);
  staat.borden = await api('/borden');
  tekenZijbalk();
  teken();
}

// ── Filteren ─────────────────────────────────────────────────────────────
function gefilterdeTaken() {
  const zoek = el('zoek').value.trim().toLowerCase();
  const status = el('filterStatus').value;
  const uitvoerend = el('filterUitvoerend').value;

  return staat.taken.filter(taak => {
    if (status && taak.status !== status) return false;
    if (uitvoerend && String(taak.uitvoerend_id) !== uitvoerend) return false;
    if (!zoek) return true;
    return (taak.opdracht + ' ' + (taak.uitvoerend_naam || '') + ' ' + taak.omschrijving)
      .toLowerCase().includes(zoek);
  });
}

// ── Tekenen ──────────────────────────────────────────────────────────────
function teken() {
  if (staat.weergave === 'team') return tekenTeam();
  if (staat.weergave === 'kanban') return tekenKanban();
  tekenTabel();
}

function tekenTabel() {
  const taken = gefilterdeTaken();

  el('inhoud').innerHTML = `
    <div class="tabel-omhulsel">
      <table>
        <thead><tr>
          <th>Opdracht</th><th>Uitvoerend</th><th>Status</th>
          <th>Deadline</th><th>Details</th><th>Acties</th>
        </tr></thead>
        <tbody>${taken.length === 0
          ? '<tr class="leeg"><td colspan="6">Geen taken gevonden.</td></tr>'
          : taken.map(rijHtml).join('')}</tbody>
      </table>
    </div>`;

  el('inhoud').querySelectorAll('.status-select').forEach(keuze => {
    keuze.addEventListener('change', async () => {
      await api(`/taken/${keuze.dataset.taak}`, { method: 'PATCH', body: { status: keuze.value } });
      herlaadTaken();
    });
  });
  koppelTaakKnoppen(el('inhoud'));
}

function rijHtml(taak) {
  const opties = staat.statussen
    .map(s => `<option value="${esc(s)}" ${s === taak.status ? 'selected' : ''}>${esc(s)}</option>`).join('');

  const deadline = taak.deadline
    ? `<span class="${isVerlopen(taak) ? 'verlopen' : ''}" style="${isVerlopen(taak) ? 'color:#EB5757;font-weight:600' : ''}">${datumNL(taak.deadline)}</span>`
    : '<span class="zacht">—</span>';

  return `
    <tr>
      <td><strong>${esc(taak.opdracht)}</strong></td>
      <td>${taak.uitvoerend_naam ? esc(taak.uitvoerend_naam) : '<span class="zacht">—</span>'}</td>
      <td>
        <select class="status-select ${statusKlasse(taak.status)}" data-taak="${taak.id}"
                style="background:${KLEUREN[taak.status]}">${opties}</select>
      </td>
      <td>${deadline}</td>
      <td><button class="knop-link" data-detail="${taak.id}">Bekijk${taak.aantal_opmerkingen ? ` (${taak.aantal_opmerkingen})` : ''}</button></td>
      <td><div class="acties">
        <button class="btn btn-secondary btn-sm" data-bewerk="${taak.id}">Bewerken</button>
        <button class="btn btn-danger btn-sm" data-verwijder="${taak.id}">Verwijder</button>
      </div></td>
    </tr>`;
}

function tekenKanban() {
  const taken = gefilterdeTaken();

  el('inhoud').innerHTML = `<div class="kanban">${staat.statussen.map(status => {
    const inKolom = taken.filter(t => t.status === status);
    return `
      <div class="kolom" data-status="${esc(status)}">
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

  koppelSlepen();
  koppelTaakKnoppen(el('inhoud'));
}

function kaartHtml(taak) {
  return `
    <div class="kaart" draggable="true" data-taak="${taak.id}" data-detail="${taak.id}">
      <div class="kaart-titel">${esc(taak.opdracht)}</div>
      <div class="kaart-voet">
        ${taak.uitvoerend_naam
          ? `<span class="bolletje" title="${esc(taak.uitvoerend_naam)}">${esc(initialen(taak.uitvoerend_naam))}</span>`
          : ''}
        ${taak.deadline ? `<span class="${isVerlopen(taak) ? 'verlopen' : ''}">${datumNL(taak.deadline)}</span>` : ''}
        ${taak.aantal_opmerkingen ? `<span title="opmerkingen">💬 ${taak.aantal_opmerkingen}</span>` : ''}
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
      e.preventDefault();
      if (!gesleept) return;
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
      if (!kaart) return;

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
function openTaakVenster(id = null) {
  staat.bewerktId = id;
  el('taakMelding').textContent = '';
  el('taakVensterTitel').textContent = id ? 'Taak bewerken' : 'Nieuw item';

  const taak = id ? staat.taken.find(t => t.id === id) : null;
  el('vOpdracht').value     = taak?.opdracht ?? '';
  el('vUitvoerend').value   = taak?.uitvoerend_id ?? '';
  el('vStatus').value       = taak?.status ?? 'Not Started';
  el('vDeadline').value     = taak?.deadline ?? '';
  el('vOmschrijving').value = taak?.omschrijving ?? '';

  openVenster('taakVenster');
  el('vOpdracht').focus();
}

el('taakOpslaan').addEventListener('click', async () => {
  const gegevens = {
    opdracht: el('vOpdracht').value.trim(),
    uitvoerend_id: el('vUitvoerend').value || null,
    status: el('vStatus').value,
    deadline: el('vDeadline').value || null,
    omschrijving: el('vOmschrijving').value.trim(),
  };

  if (!gegevens.opdracht) {
    el('taakMelding').textContent = 'Geef de opdracht een naam.';
    return;
  }

  try {
    if (staat.bewerktId) {
      await api(`/taken/${staat.bewerktId}`, { method: 'PATCH', body: gegevens });
    } else {
      await api(`/borden/${staat.bordId}/taken`, { method: 'POST', body: gegevens });
    }
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
    <div><span class="naam">Deadline</span><span class="waarde">${taak.deadline ? datumNL(taak.deadline) : '—'}</span></div>`;

  tekenOpmerkingen(taak.opmerkingen);

  el('historieLijst').innerHTML = taak.historie.length === 0
    ? '<li class="zacht">Nog geen wijzigingen.</li>'
    : taak.historie.map(regel => {
        const wie = esc(regel.gebruiker_naam || 'Iemand');
        if (regel.veld === 'aangemaakt') {
          return `<li><b>${wie}</b> maakte deze taak aan — ${momentNL(regel.aangemaakt_op)}</li>`;
        }
        return `<li><b>${wie}</b> wijzigde <b>${esc(regel.veld)}</b>
          van “${esc(regel.oude_waarde || 'leeg')}” naar “${esc(regel.nieuwe_waarde || 'leeg')}”
          — ${momentNL(regel.aangemaakt_op)}</li>`;
      }).join('');

  el('nieuweOpmerking').value = '';
  openVenster('detailVenster');
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
        ${staat.mailAan ? '' : `<p style="margin-top:10px;font-size:.8rem;color:var(--grijs)">
          Mail staat uit. Uitnodigingen worden niet verstuurd; je krijgt de link hieronder om zelf door te sturen.
        </p>`}

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
        <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Status</th>${beheerder ? '<th></th>' : ''}</tr></thead>
        <tbody>${staat.gebruikers.map(g => `
          <tr>
            <td><strong>${esc(g.naam)}</strong>${g.id === staat.ik.id ? ' <span class="zacht">(jij)</span>' : ''}</td>
            <td>${esc(g.email)}</td>
            <td>${g.rol === 'beheerder' ? 'Beheerder' : 'Lid'}</td>
            <td>${g.actief ? 'Actief' : '<span class="zacht">Uitgeschakeld</span>'}</td>
            ${beheerder ? `<td><div class="acties">
              <button class="btn btn-secondary btn-sm" data-rol="${g.id}" data-nieuw="${g.rol === 'beheerder' ? 'lid' : 'beheerder'}">
                Maak ${g.rol === 'beheerder' ? 'lid' : 'beheerder'}
              </button>
              <button class="btn btn-secondary btn-sm" data-herstel="${g.id}">Wachtwoord herstellen</button>
              <button class="btn ${g.actief ? 'btn-danger' : 'btn-secondary'} btn-sm" data-actief="${g.id}" data-waarde="${g.actief ? 0 : 1}">
                ${g.actief ? 'Uitschakelen' : 'Inschakelen'}
              </button>
            </div></td>` : ''}
          </tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="kaartje">
      <h3>Mijn wachtwoord wijzigen</h3>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="veld" style="flex:1;min-width:180px">
          <label for="wwHuidig">Huidig wachtwoord</label>
          <input type="password" id="wwHuidig" autocomplete="current-password" />
        </div>
        <div class="veld" style="flex:1;min-width:180px">
          <label for="wwNieuw">Nieuw wachtwoord</label>
          <input type="password" id="wwNieuw" autocomplete="new-password" />
        </div>
        <button class="btn btn-primary" id="wwKnop">Wijzigen</button>
      </div>
      <div class="melding" id="wwMelding" style="margin-top:12px"></div>
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
      const uitnodiging = await api('/uitnodigingen', {
        method: 'POST',
        body: { email: adres, rol: el('uitRol').value },
      });

      el('uitEmail').value = '';

      // De melding gaat mee het opnieuw tekenen in, anders wist hij zichzelf.
      tekenTeam({
        goed: uitnodiging.gemaild,
        tekst: uitnodiging.gemaild
          ? `Uitnodiging gemaild naar ${adres}.`
          : `Uitnodiging gemaakt, maar er is geen mail verstuurd. Stuur de link hieronder zelf door. ` +
            `Reden: ${uitnodiging.mailfout ?? 'onbekend'}`,
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

  el('inhoud').querySelectorAll('[data-herstel]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const melding = el('herstelMelding');
      try {
        const antwoord = await api(`/gebruikers/${knop.dataset.herstel}/herstel`, { method: 'POST' });
        const link = `${location.origin}/inloggen.html?herstel=${antwoord.token}`;

        melding.innerHTML = antwoord.gemaild
          ? 'De herstellink is gemaild. Hij is twee dagen geldig en werkt één keer.'
          : `Geef deze link persoonlijk door — hij is twee dagen geldig en werkt één keer:
             <div class="uitnodig-link"><code>${esc(link)}</code></div>`;
        melding.classList.add('goed');
        if (!antwoord.gemaild) navigator.clipboard?.writeText(link);
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

  el('wwKnop')?.addEventListener('click', async () => {
    const melding = el('wwMelding');
    melding.classList.remove('goed');
    try {
      await api('/wachtwoord', {
        method: 'POST',
        body: { huidig: el('wwHuidig').value, nieuw: el('wwNieuw').value },
      });
      melding.textContent = 'Je wachtwoord is gewijzigd.';
      melding.classList.add('goed');
      el('wwHuidig').value = el('wwNieuw').value = '';
    } catch (fout) {
      melding.textContent = fout.message;
    }
  });
}

// ── Werkbalk ─────────────────────────────────────────────────────────────
el('nieuwTaakKnop').addEventListener('click', () => openTaakVenster());
el('zoek').addEventListener('input', () => { if (staat.weergave !== 'team') teken(); });
el('filterStatus').addEventListener('change', teken);
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
  const kolommen = ['Opdracht', 'Uitvoerend', 'Status', 'Deadline', 'Omschrijving'];
  const veld = (waarde) => `"${String(waarde ?? '').replace(/"/g, '""')}"`;

  const regels = gefilterdeTaken().map(t =>
    [t.opdracht, t.uitvoerend_naam, t.status, t.deadline, t.omschrijving].map(veld).join(','));

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
