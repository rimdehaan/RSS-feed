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

Ook een veelvoorkomend misverstand. `taken@transafe.info` als afzender werkt zonder
dat er ergens een postbus met die naam bestaat. Het is puur een naam op de envelop.

Het gevolg daarvan is wel: **antwoorden op die mail komen nergens aan.** Daarvoor is
de instelling `MAIL_ANTWOORD_NAAR` — zie stap 3.

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

Klik daarna op **Deploy** om het toe te passen. Zonder die klik blijft de oude
versie draaien en verandert er niets.

### Let op: zolang je domein niet geverifieerd is, mag je maar naar één adres mailen

Resend staat in testmodus alleen mail toe naar **het adres waarmee je je Resend-account
hebt aangemaakt**. Naar collega's mailen lukt dan nog niet; je krijgt in het
Team-scherm een melding als *"You can only send testing emails to your own email
address"*.

Dat is geen fout in de app. Het is Resend die voorkomt dat verse accounts spam
versturen.

**Probeer het dus eerst op jezelf:** nodig jezelf uit op precies het adres waarmee je
je bij Resend hebt aangemeld. Komt die mail aan, dan werkt de hele keten en hoef je
alleen stap 3 nog te doen. Kijk ook in je spamfolder.

Wil je collega's kunnen uitnodigen, dan is **stap 3 verplicht** — niet optioneel,
zoals je misschien zou denken.

## Stap 3 — Versturen vanaf je eigen domein

Nodig zodra je iemand anders dan jezelf wilt uitnodigen — zie de waarschuwing
hierboven. Bijkomend voordeel: de mail belandt niet in de spam en ziet er
professioneel uit.

**Kies het domein dat in jullie werkmailadressen zit.** Staat je collega bekend als
`naam@transafe.info`, dan verifieer je `transafe.info` — niet een ander domein dat
je toevallig ook bezit.

1. In Resend: **Domains** → **Add Domain** → vul je domein in.
2. Resend toont een handvol **DNS-regels** (meestal een `MX` en twee of drie `TXT`).
3. Die regels moeten worden toegevoegd bij de partij waar het domein geregistreerd
   staat — je hostingpartij of domeinleverancier.
4. Klik daarna in Resend op **Verify**. Dat kan tot een uur duren.

> Beheer je DNS niet zelf? Stuur Resend's lijst door naar degene die jullie domein
> beheert, met de vraag of hij die records wil toevoegen. Dat is een normale,
> alledaagse vraag; wie DNS beheert weet meteen wat ermee moet.

Wat die regels doen: ze zijn het bewijs dat jij toestemming geeft om mail namens dat
domein te versturen. Zonder dat bewijs vertrouwen ontvangende mailservers de mail
niet, en verdwijnt hij in de spam — of komt hij helemaal niet aan.

5. Zodra het domein geverifieerd is, zet je in Railway onder **Variables**:

| Naam | Waarde |
|---|---|
| `MAIL_AFZENDER` | `Transafe Taakbeheer <taken@transafe.info>` |
| `MAIL_ANTWOORD_NAAR` | een postbus die echt bestaat, bijvoorbeeld `info@transafe.info` |

Klik weer op **Deploy**.

Die tweede regelt iets wat je anders pas merkt als het te laat is: `taken@` bestaat
niet als postbus, dus zonder deze instelling verdwijnt het antwoord van een collega
in het niets. Met `MAIL_ANTWOORD_NAAR` komt een antwoord netjes aan op een adres dat
je leest.

---

## Handig om te weten

**Links in de mail wijzen automatisch naar je Railway-adres.** Klopt dat een keer
niet — bijvoorbeeld als je later een eigen domein op de app zet — dan kun je het
vastzetten met een variabele `APP_URL`, bijvoorbeeld
`https://taken.transafe.nl`.

**Mail die niet aankomt houdt niets tegen.** Gaat er iets mis bij Resend, dan wordt
de uitnodiging alsnog aangemaakt en krijg je de link op je scherm, met de reden
erbij. Je kunt dus nooit vastlopen doordat de mail hapert.

## Risicoafweging (ISO 27001 en AVG)

Mail laten versturen door een externe dienst is een bewuste keuze met gevolgen.
Hieronder wat je nodig hebt om die afweging te maken of voor te leggen.

### Welke gegevens verlaten het bedrijf

Alleen bij het uitnodigen en bij wachtwoordherstel, en alleen dit:

| Gegeven | Waarom |
|---|---|
| E-mailadres van de ontvanger | Om de mail te bezorgen |
| Naam van degene die uitnodigt | Staat in de tekst van de mail |
| De uitnodigings- of herstellink | Is de inhoud van de mail |

Taken, omschrijvingen, opmerkingen en klantgegevens gaan **nooit** mee. Die blijven
op je eigen server staan.

Wel relevant: e-mailadressen en namen van medewerkers zijn persoonsgegevens. Je
mailleverancier wordt daarmee een **verwerker**, en hoort dus in je
verwerkersregister met een verwerkersovereenkomst.

### Wat de DNS-regels betekenen

Ze geven de mailleverancier toestemming om mail te versturen die aantoonbaar van
jouw domein komt. Twee risico's horen daarbij:

1. **Fout bij het invoeren.** Er mag maar één SPF-regel (`v=spf1`) per naam bestaan.
   Voegt iemand er een tweede bij in plaats van de bestaande aan te vullen, dan
   faalt SPF voor *al* je bedrijfsmail. Dit is in de praktijk het grootste risico,
   en het is menselijk, niet technisch.
2. **Misbruik bij de leverancier.** Wordt de leverancier of je account daar
   gekraakt, dan kan iemand overtuigende phishing versturen die als jouw domein
   door de controle komt.

### Zet het op een subdomein

Beide risico's worden veel kleiner als je niet `transafe.info` verifieert maar
bijvoorbeeld **`taken.transafe.info`**:

- De records staan náást je bestaande mailinstellingen. Je raakt SPF, DKIM en DMARC
  van je bedrijfsmail niet aan, dus je kunt de gewone mail niet slopen.
- Misbruik beperkt zich tot `@taken.transafe.info`. Dat is een adres dat niemand
  kent, waardoor phishing er meteen vreemd uitziet in plaats van geloofwaardig.
- Terugdraaien is één actie: verwijder de records van het subdomein. Je hoofddomein
  is dan nooit geraakt geweest.

Je afzender wordt dan `taken@taken.transafe.info`, of netter met een weergavenaam:
`Transafe Taakbeheer <taken@taken.transafe.info>`.

### De herstellink is het gevoeligst

Een uitnodiging levert hooguit een account met de rol *lid*. Een **herstellink**
geeft toegang tot een bestaand account. Loopt die via een externe partij, dan is dat
een route naar accountovername als die partij gecompromitteerd raakt.

Beperkingen die er al zijn: herstellinks zijn twee dagen geldig, werken één keer,
en kunnen alleen door een beheerder worden aangemaakt. Wil je ze helemaal niet
mailen, geef ze dan persoonlijk door — laat `RESEND_API_KEY` leeg en je krijgt ze
op je scherm.

### Helemaal geen mail is een volwaardige keuze

Voor een team van tien mensen nodig je een paar keer per jaar iemand uit. Het
kopiëren van een link kost dan dertig seconden per jaar aan ongemak, en bespaart je
een verwerker in je register, een DNS-wijziging en een leverancier om te beoordelen.

## Als er iets misgaat

| Wat je ziet in het Team-scherm | Wat het betekent |
|---|---|
| `Er is geen mailsleutel ingesteld` | `RESEND_API_KEY` staat niet in Railway, of je hebt na het toevoegen niet op Deploy geklikt |
| `Domein is niet geverifieerd` | De DNS-regels uit stap 3 staan er nog niet, of `MAIL_AFZENDER` gebruikt een domein dat je nog niet hebt geverifieerd |
| `You can only send testing emails to your own email address` | Je domein is nog niet geverifieerd. Nodig eerst jezelf uit op je Resend-adres, en doe daarna stap 3 |
| `Mailserver gaf status 401` | De sleutel klopt niet. Maak een nieuwe in Resend |
| `Mailserver gaf status 429` | Te veel mail in korte tijd. Even wachten |
| Mail komt aan in spam | Je verstuurt nog vanaf het testadres. Doe stap 3 |
