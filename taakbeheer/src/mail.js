// Mail versturen via Resend (https://resend.com).
//
// Is er geen sleutel ingesteld, dan verstuurt de app niets en krijg je de link
// gewoon op je scherm om zelf door te sturen. De app werkt dus met én zonder mail.
//
// Instellen met deze omgevingsvariabelen:
//   RESEND_API_KEY       de sleutel uit je Resend-account (begint met re_)
//   MAIL_AFZENDER        van wie de mail komt, bijvoorbeeld "Transafe <taken@transafe.info>"
//   MAIL_ANTWOORD_NAAR   waar antwoorden heen gaan, bijvoorbeeld "info@transafe.info"
//
// Dat laatste is handig omdat het afzenderadres geen bestaande postbus hoeft te
// zijn. Zonder deze instelling verdwijnt een antwoord van een collega in het niets.

const AFZENDER = process.env.MAIL_AFZENDER || 'Taakbeheer <onboarding@resend.dev>';
const ANTWOORD_NAAR = process.env.MAIL_ANTWOORD_NAAR;
const ADRES = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

export function mailIsIngesteld() {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Verstuurt één mail. Geeft { verstuurd: true } of { verstuurd: false, fout }.
 * Werpt nooit een fout omhoog: mail die niet aankomt mag het uitnodigen zelf
 * niet laten mislukken — je hebt de link dan nog steeds.
 */
async function stuur({ naar, onderwerp, tekst, html }) {
  if (!mailIsIngesteld()) return { verstuurd: false, fout: 'Er is geen mailsleutel ingesteld.' };

  try {
    const antwoord = await fetch(ADRES, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: AFZENDER,
        to: [naar],
        subject: onderwerp,
        text: tekst,
        html,
        ...(ANTWOORD_NAAR ? { reply_to: ANTWOORD_NAAR } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!antwoord.ok) {
      const details = await antwoord.json().catch(() => ({}));
      return { verstuurd: false, fout: details.message || `Mailserver gaf status ${antwoord.status}.` };
    }
    return { verstuurd: true };
  } catch (fout) {
    return { verstuurd: false, fout: `Mail versturen mislukte: ${fout.message}` };
  }
}

// ── Opmaak ───────────────────────────────────────────────────────────────
// Bewust simpel: mailprogramma's zijn kieskeurig, dus geen slimme opmaak.

function omhulsel(kop, regels, knopTekst, link) {
  return `<!doctype html>
<html lang="nl"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:'Segoe UI',Arial,sans-serif">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;border-collapse:separate">
    <tr><td style="padding:26px 30px 20px;border-bottom:1px solid #e8eaed">
      <span style="font-size:19px;font-weight:700;color:#002944">Trans</span><span style="font-size:19px;font-weight:700;color:#5B869F">afe</span>
    </td></tr>
    <tr><td style="padding:26px 30px">
      <h1 style="margin:0 0 14px;font-size:17px;color:#002944">${kop}</h1>
      ${regels.map(r => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#333">${r}</p>`).join('')}
      <p style="margin:22px 0">
        <a href="${link}" style="display:inline-block;background:#002944;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">${knopTekst}</a>
      </p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#888">
        Werkt de knop niet? Kopieer deze link naar je browser:<br>
        <span style="color:#5B869F;word-break:break-all">${link}</span>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

export function stuurUitnodiging({ naar, uitgenodigdDoor, link }) {
  return stuur({
    naar,
    onderwerp: 'Je bent uitgenodigd voor Transafe Taakbeheer',
    tekst: `${uitgenodigdDoor} nodigt je uit voor Transafe Taakbeheer.\n\n` +
      `Maak je account aan via deze link:\n${link}\n\n` +
      `De link is twee weken geldig en werkt één keer.`,
    html: omhulsel(
      'Je bent uitgenodigd',
      [
        `<strong>${uitgenodigdDoor}</strong> nodigt je uit om mee te werken in Transafe Taakbeheer.`,
        'Maak hieronder je account aan. Je kiest zelf je wachtwoord.',
      ],
      'Account aanmaken',
      link
    ),
  });
}

export function stuurHerstel({ naar, naam, link }) {
  return stuur({
    naar,
    onderwerp: 'Nieuw wachtwoord instellen voor Transafe Taakbeheer',
    tekst: `Hoi ${naam},\n\n` +
      `Er is een herstellink voor je aangevraagd. Stel hier een nieuw wachtwoord in:\n${link}\n\n` +
      `De link is twee dagen geldig en werkt één keer. ` +
      `Heb je dit niet gevraagd, meld het dan bij je beheerder.`,
    html: omhulsel(
      'Nieuw wachtwoord instellen',
      [
        `Hoi ${naam}, er is een herstellink voor je aangevraagd.`,
        'De link is twee dagen geldig en werkt één keer. Heb je dit niet gevraagd, meld het dan bij je beheerder.',
      ],
      'Nieuw wachtwoord kiezen',
      link
    ),
  });
}
