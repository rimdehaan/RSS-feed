// Het inlogscherm: inloggen, de eerste beheerder aanmaken, registreren via
// een uitnodiging, en een nieuw wachtwoord kiezen via een herstellink.
//
// Staat bewust in een eigen bestand en niet in de pagina zelf: de
// Content-Security-Policy verbiedt scripts die tussen de HTML staan.

const params = new URLSearchParams(location.search);
const uitnodigingToken = params.get('uitnodiging');
const herstelToken = params.get('herstel');

const el = (id) => document.getElementById(id);
const melding = el('melding');
let modus = 'inloggen';   // 'inloggen' | 'setup' | 'registreren'

/** Kies je een nieuw wachtwoord, dan moet je het twee keer typen. */
function vraagOmHerhaling() {
  el('wachtwoord').autocomplete = 'new-password';
  el('herhaalVeld').hidden = false;
}

function toon(tekst, goed = false) {
  melding.textContent = tekst;
  melding.classList.toggle('goed', goed);
}

async function verstuurNaar(adres, gegevens) {
  const antwoord = await fetch(adres, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(gegevens),
  });
  const data = await antwoord.json().catch(() => ({}));
  if (!antwoord.ok) throw new Error(data.fout || 'Er ging iets mis.');
  return data;
}

async function bepaalModus() {
  if (herstelToken) {
    try {
      const antwoord = await fetch('/api/herstel/' + encodeURIComponent(herstelToken));
      const data = await antwoord.json();
      if (!antwoord.ok) throw new Error(data.fout);

      modus = 'herstel';
      el('titel').textContent = 'Nieuw wachtwoord kiezen';
      el('email').value = data.email;
      el('email').readOnly = true;
      vraagOmHerhaling();
      el('verstuur').textContent = 'Wachtwoord instellen';
      el('uitleg').textContent =
        'Kies een nieuw wachtwoord van minstens 10 tekens. Je wordt daarna meteen ingelogd.';
    } catch (fout) {
      toon(fout.message);
      el('formulier').hidden = true;
    }
    return;
  }

  if (uitnodigingToken) {
    try {
      const antwoord = await fetch('/api/uitnodiging/' + encodeURIComponent(uitnodigingToken));
      const data = await antwoord.json();
      if (!antwoord.ok) throw new Error(data.fout);

      modus = 'registreren';
      el('titel').textContent = 'Account aanmaken';
      el('naamVeld').hidden = false;
      el('email').value = data.email;
      el('email').readOnly = true;
      vraagOmHerhaling();
      el('verstuur').textContent = 'Account aanmaken';
      el('uitleg').textContent = 'Kies een wachtwoord van minstens 10 tekens.';
    } catch (fout) {
      toon(fout.message);
      el('formulier').hidden = true;
    }
    return;
  }

  const { nodig } = await fetch('/api/setup-nodig').then(r => r.json());
  if (nodig) {
    modus = 'setup';
    el('titel').textContent = 'Eerste beheerder aanmaken';
    el('naamVeld').hidden = false;
    vraagOmHerhaling();
    el('verstuur').textContent = 'Aanmaken en starten';
    el('uitleg').textContent =
      'Dit scherm verschijnt alleen zolang er nog geen enkel account bestaat. ' +
      'Daarna nodig je collega’s uit vanuit het Team-scherm.';
  }
}

el('formulier').addEventListener('submit', async (gebeurtenis) => {
  gebeurtenis.preventDefault();
  toon('');
  el('verstuur').disabled = true;

  try {
    const naam = el('naam').value.trim();
    const email = el('email').value.trim();
    const wachtwoord = el('wachtwoord').value;

    // Je ziet niet wat je typt; twee keer hetzelfde intypen is de enige
    // manier om zeker te weten dat er geen typefout in zit.
    if (!el('herhaalVeld').hidden && wachtwoord !== el('herhaal').value) {
      toon('De twee wachtwoorden zijn niet gelijk. Typ ze allebei opnieuw.');
      el('herhaal').value = '';
      el('verstuur').disabled = false;
      return;
    }

    if (modus === 'setup') {
      await verstuurNaar('/api/setup', { naam, email, wachtwoord });
    } else if (modus === 'registreren') {
      await verstuurNaar('/api/registreren', { token: uitnodigingToken, naam, wachtwoord });
    } else if (modus === 'herstel') {
      await verstuurNaar('/api/herstel', { token: herstelToken, wachtwoord });
    } else {
      await verstuurNaar('/api/inloggen', { email, wachtwoord });
    }
    location.href = '/';
  } catch (fout) {
    toon(fout.message);
    el('verstuur').disabled = false;
  }
});

bepaalModus();
