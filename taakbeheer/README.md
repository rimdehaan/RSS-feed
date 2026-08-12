# Transafe Taakbeheer

Takenbeheer voor een klein team, in de geest van monday.com. Meerdere mensen met
een eigen account werken samen aan dezelfde borden: tabelweergave, kanban met
slepen, opmerkingen per taak en een historie die bijhoudt wie wat wanneer wijzigde.

Dit is de servervariant van je oorspronkelijke `Taakbeheer.html`. De opmaak en de
statussen zijn hetzelfde gebleven; wat veranderde is dat de gegevens niet meer in
één browser staan maar op een server waar iedereen bij kan.

---

## Draaien op je eigen computer

```bash
cd taakbeheer
npm install      # eenmalig
node server.js   # http://localhost:3000
npm test         # loopt de hele achterkant na (start zelf een server)
```

De eerste keer stuurt de app je naar een scherm om de **eerste beheerder** aan te
maken. Dat scherm verdwijnt zodra er één account bestaat. Daarna nodig je
collega's uit via **Team**.

De data komt in `data/taakbeheer.db` te staan. Dat ene bestand is je hele
administratie — zie *Back-ups* verderop.

---

## Wat er in zit

| Onderdeel | Wat het doet |
|---|---|
| Accounts | Inloggen met e-mail en wachtwoord. Wachtwoorden worden versleuteld opgeslagen (scrypt), nooit leesbaar |
| Uitnodigen | Alleen een beheerder voegt mensen toe. Je krijgt een link die je zelf doorstuurt |
| Rollen | *Beheerder* mag uitnodigen en accounts beheren, *lid* werkt gewoon mee |
| Wachtwoord kwijt | Een beheerder maakt een eenmalige herstellink, twee dagen geldig |
| Mail | Uitnodigingen en herstellinks worden gemaild zodra je dat aanzet — zie [MAIL.md](MAIL.md). Zonder instelling krijg je de link op je scherm om zelf door te sturen |
| Borden | Meerdere borden naast elkaar, bijvoorbeeld per project of per klant |
| Tabelweergave | Zoals je prototype: opdracht, uitvoerend, status, deadline, omschrijving |
| Kanban | De zes statussen als kolommen, kaarten ertussen slepen |
| Opmerkingen | Een gesprek per taak, met naam en tijdstip |
| Historie | Automatisch: wie veranderde welk veld, van wat naar wat |
| CSV-export | Exporteert wat er op dat moment gefilterd op je scherm staat |

De zes statussen zijn ongewijzigd: Not Started, Working on it, Validating, Done,
On Hold, Cancelled.

---

## Hosting: mijn advies

Je vroeg mij te kiezen. Dit is wat ik voor jouw situatie zou doen — een klein
team, een echt bedrijf, en een eigenaar die net begint met programmeren.

### Neem Railway (of Render)

Beide zijn "managed platforms": je koppelt je GitHub-repo, en bij elke push
draait de nieuwe versie vanzelf. Reken op **€5 tot €15 per maand**. Waarom dit
en niet een eigen VPS: op een eigen server ben jij verantwoordelijk voor
beveiligingsupdates, back-ups en HTTPS-certificaten. Dat is terugkerend werk dat
je nu niet kunt overzien, en het is precies het soort werk waar het misgaat als
je het een half jaar laat liggen.

### Drie dingen die je goed moet zetten

1. **Een persistent volume.** Zonder dit is je database wég bij elke nieuwe
   versie die je uitrolt. Koppel een volume aan `/data` en zet de omgevingsvariabele
   `DATABASE_PAD=/data/taakbeheer.db`. Dit is de belangrijkste stap van alles.
2. **`NODE_ENV=production`.** Hiermee worden inlogcookies alleen nog over https
   verstuurd.
3. **Een Europese regio.** Railway heeft `europe-west4` (Amsterdam). Voor een
   Nederlands bedrijf met persoonsgegevens van medewerkers scheelt dat gedoe
   onder de AVG, en het is sneller.

Startcommando is `node server.js`; de poort komt uit de omgevingsvariabele `PORT`,
die het platform zelf invult.

### Uitrollen gaat via GitHub Actions

In `.github/workflows/taakbeheer.yml` staat een workflow die bij elke push eerst de
tests draait en pas daarna uitrolt. Zakt een test, dan komt er niets online.

**Klik-voor-klik uitleg staat in [HOSTING.md](HOSTING.md).**

### Back-ups

De hele administratie is één bestand: `taakbeheer.db`. Maak daar regelmatig een
kopie van — download hem maandelijks, of laat het platform een snapshot van het
volume maken. Een back-up die je nooit hebt teruggezet is geen back-up: probeer
één keer of je van een kopie kunt starten.

---

## Wat er (nog) niet in zit

Bewust weggelaten, zodat het overzichtelijk blijft:

- **Iedereen ziet alle borden.** Er is nog geen instelling per bord voor wie
  erbij mag. Voor een team van 2 tot 10 mensen is dat meestal prima; zodra er
  klanten of externen bij komen is dit het eerste wat je nodig hebt.
- **Geen live bijwerken.** Zie je een wijziging van een collega niet, dan is
  verversen genoeg. Automatisch bijwerken kan later.
- **Geen bijlagen, geen tijdlijn, geen automatiseringen.**

---

## Hoe het in elkaar zit

```
taakbeheer/
├── server.js            de server: koppelt alles aan elkaar
├── src/
│   ├── db.js            de database en alle tabellen
│   ├── auth.js          wachtwoorden versleutelen, sessies bijhouden
│   └── api.js           alle adressen waar de browser mee praat
└── public/
    ├── inloggen.html    inloggen, registreren, wachtwoord herstellen
    ├── index.html       de app zelf
    ├── app.js           alles wat er in de browser gebeurt
    └── stijl.css        de opmaak
```

Twee pakketten van buiten, verder niets:

- **express** — neemt het saaie werk van een webserver uit handen
- **better-sqlite3** — de database, één bestand op schijf

### Omgevingsvariabelen

| Naam | Waarvoor | Standaard |
|---|---|---|
| `PORT` | Poort waarop de server luistert | `3000` |
| `DATABASE_PAD` | Waar het databasebestand staat | `./data/taakbeheer.db` |
| `NODE_ENV` | Zet op `production` zodra je live staat | leeg |
| `RESEND_API_KEY` | Sleutel om mail te versturen. Leeg = geen mail, wel links | leeg |
| `MAIL_AFZENDER` | Van wie de mail komt | testadres van Resend |
| `MAIL_ANTWOORD_NAAR` | Waar antwoorden heen gaan. Leeg = antwoorden komen nergens aan | leeg |
| `APP_URL` | Adres in maillinks. Leeg = het adres waarop je binnenkwam | leeg |

---

## Als het misgaat

| Melding | Wat te doen |
|---|---|
| `EADDRINUSE` | De app draait al. Sluit dat venster, of start met `PORT=3001 node server.js` |
| Je komt niet meer binnen | Vraag een andere beheerder om een herstellink. Is er geen andere beheerder, dan is de database het enige aanknopingspunt |
| Alles is leeg na een nieuwe versie online | Dan staat het volume niet goed — zie *Hosting*, punt 1 |
| `Cannot find module` | `npm install` vergeten |
