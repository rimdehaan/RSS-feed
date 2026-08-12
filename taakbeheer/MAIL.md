# Mail aanzetten

Zonder instellingen mailt de app niets: je krijgt de uitnodigingslink op je scherm
en stuurt hem zelf door. Dat blijft gewoon werken. Met de stappen hieronder gaat het
automatisch.

Reken op tien minuten.

---

## Eerst: Railway verstuurt geen mail

Een veelgemaakte aanname, dus even expliciet.

Railway is een **hostingplatform**: het draait je app. Mail versturen zit daar niet
in, en je maakt er ook geen e-mailadres aan. Railway blokkeert bovendien de poorten
waarmee je zelf een mailserver zou draaien — dat doen vrijwel alle hosters, om te
voorkomen dat hun servers spam gaan versturen.

Je hebt dus een aparte dienst nodig die alleen mail doet. Wij gebruiken **Resend**:
gratis tot 3000 mails per maand, wat voor uitnodigingen ruimschoots genoeg is.

## En: het afzenderadres hoeft geen echte mailbox te zijn

Ook een veelvoorkomend misverstand. `taken@transafe.nl` als afzender werkt zonder
dat er ergens een postbus met die naam bestaat. Het is puur een naam op de envelop.

Het gevolg daarvan is wel: **antwoorden op die mail komen nergens aan.** Wil je dat
mensen kunnen antwoorden, gebruik dan een adres dat wél bestaat, bijvoorbeeld
`info@transafe.nl`.

---

## Stap 1 — Resend-account

1. Ga naar <https://resend.com> en maak een account.
2. Ga naar **API Keys** → **Create API Key**.
3. Kopieer de sleutel meteen; hij begint met `re_` en je ziet hem één keer.

## Stap 2 — De sleutel in Railway zetten

Klik op je service → tabblad **Variables** → **New Variable**:

| Naam | Waarde |
|---|---|
| `RESEND_API_KEY` | de sleutel uit stap 1 |

Klik daarna op **Deploy** om het toe te passen. Dat is genoeg om te beginnen: de app
verstuurt nu vanaf `onboarding@resend.dev`, een testadres van Resend.

**Probeer het meteen:** nodig jezelf uit op een privéadres. Kijk ook in je
spamfolder — dat testadres komt daar vaak in terecht. Dat is precies de reden voor
de volgende stap.

## Stap 3 — Versturen vanaf transafe.nl

Voor mail die niet in de spam belandt en er professioneel uitziet.

1. In Resend: **Domains** → **Add Domain** → vul `transafe.nl` in.
2. Resend toont een handvol **DNS-regels** (types `TXT`, `MX`, en meestal `CNAME`).
3. Die regels moeten worden toegevoegd bij de partij waar `transafe.nl` geregistreerd
   staat — je hostingpartij of domeinleverancier.
4. Klik daarna in Resend op **Verify**. Dat kan tot een uur duren.

> Doe je dit niet zelf? Stuur de regels door naar degene die jullie domein beheert.
> Dit is een normale vraag; wie DNS beheert weet meteen wat hij ermee moet.

Wat die regels doen: ze zijn het bewijs dat jij toestemming geeft om mail namens
`transafe.nl` te versturen. Zonder dat bewijs vertrouwen ontvangende mailservers de
mail niet, en verdwijnt hij in de spam.

5. Zodra het domein geverifieerd is, voeg je in Railway een tweede variabele toe:

| Naam | Waarde |
|---|---|
| `MAIL_AFZENDER` | `Transafe Taakbeheer <taken@transafe.nl>` |

Klik weer op **Deploy**.

---

## Handig om te weten

**Links in de mail wijzen automatisch naar je Railway-adres.** Klopt dat een keer
niet — bijvoorbeeld als je later een eigen domein op de app zet — dan kun je het
vastzetten met een variabele `APP_URL`, bijvoorbeeld
`https://taken.transafe.nl`.

**Mail die niet aankomt houdt niets tegen.** Gaat er iets mis bij Resend, dan wordt
de uitnodiging alsnog aangemaakt en krijg je de link op je scherm, met de reden
erbij. Je kunt dus nooit vastlopen doordat de mail hapert.

## Als er iets misgaat

| Wat je ziet in het Team-scherm | Wat het betekent |
|---|---|
| `Er is geen mailsleutel ingesteld` | `RESEND_API_KEY` staat niet in Railway, of je hebt na het toevoegen niet op Deploy geklikt |
| `Domein is niet geverifieerd` | De DNS-regels uit stap 3 staan er nog niet, of `MAIL_AFZENDER` gebruikt een domein dat je nog niet hebt geverifieerd |
| `Mailserver gaf status 401` | De sleutel klopt niet. Maak een nieuwe in Resend |
| `Mailserver gaf status 429` | Te veel mail in korte tijd. Even wachten |
| Mail komt aan in spam | Je verstuurt nog vanaf het testadres. Doe stap 3 |
