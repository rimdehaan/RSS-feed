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
| Mijn taken | Je persoonlijke bord: alles wat aan jou is toegewezen, uit alle projecten, gegroepeerd per project en daarbinnen per status. Alleen jij ziet het |
| Projecten | Meerdere borden naast elkaar, bijvoorbeeld per project of per klant |
| Wie ziet wat | Per project in te stellen: iedereen, of alleen gekozen mensen |
| Tabelweergave | Zoals je prototype: opdracht, uitvoerend, status, deadline, omschrijving |
| Prioriteit | Critical, High, Medium of Low — of geen. Klik en kies, net als bij status. Ook te filteren |
| Deadline-alarm | Taken lichten rood op zodra de deadline dichtbij is en er nog niet aan gewerkt wordt |
| Kanban | De zes statussen als kolommen, kaarten ertussen slepen |
| Werkprocessen | Bibliotheek met vaste werkwijzen. Je maakt er een door een procedure te plakken; de app knipt hem in stappen |
| Overdragen | Een taak naar een ander project verplaatsen via **Bewerken → Project**. Opmerkingen, historie en bijlagen gaan mee |
| Bijlagen | Bestanden bij een taak, zodat de uitvoerder alles bij de hand heeft. Staan op je eigen server, niet bij een externe dienst |
| Opmerkingen | Een gesprek per taak, met naam en tijdstip |
| Historie | Automatisch: wie veranderde welk veld, van wat naar wat |
| CSV-export | Exporteert wat er op dat moment gefilterd op je scherm staat |

De zes statussen zijn ongewijzigd: Not Started, Working on it, Validating, Done,
On Hold, Cancelled.

### Wanneer een taak rood oplicht

Een taak springt eruit — rode regel of rode kaart, met een ⚠ ervoor — zodra
**de deadline morgen of eerder is en er nog niet aan gewerkt wordt**.

Wat telt als "er wordt aan gewerkt": alleen de status **Working on it**. Klaar
(*Done*) en vervallen (*Cancelled*) vragen geen aandacht meer. Alle andere
statussen wel, dus ook *On Hold* en *Validating*: die zijn niet af, en de
deadline komt eraan.

Twee keuzes die afwijken van een letterlijke lezing van "de deadline is morgen":

- **Ook vandaag en te laat lichten op.** Een taak die vandaag af moet en nog niet
  is opgepakt is dringender dan een van morgen, niet minder.
- **Af en vervallen lichten niet op.** Anders zou elke afgeronde taak met een
  deadline van morgen rood worden.

De vergelijking gebruikt de datum van de kijker, niet die van de server. Om
middernacht in Nederland verspringt het dus ook echt.

Prioriteiten zijn Critical, High, Medium en Low. **Geen prioriteit is ook een
geldige keuze** en blijft bewust onopvallend grijs: anders zou elke taak een
oordeel moeten krijgen dat niemand heeft gegeven. Status en prioriteit staan los
van elkaar — een taak kan Done zijn en toch High hebben gehad.

### Hoe borden en zichtbaarheid werken

**Mijn taken** is geen echt bord: het is een overzicht dat wordt samengesteld uit
alle projecten waar werk op jouw naam staat. Je kunt er dus geen taak in aanmaken,
alleen bijwerken. Het bord van een ander is nergens op te vragen.

**Projecten** zijn de gewone borden. Standaard ziet iedereen ze. Bij
**Instellingen** beperk je dat tot gekozen mensen.

Drie regels voorkomen dat een bord onbereikbaar wordt of dat iemand werk krijgt
dat hij niet kan openen:

1. **Beheerders zien elk bord.** Anders zou een bord verdwijnen zodra de laatste
   deelnemer het bedrijf verlaat, en kan niemand dat meer rechtzetten.
2. **Wie een taak op een bord heeft, houdt toegang.** Bij het afschermen worden
   die mensen automatisch op de lijst gezet.
3. **Je kunt alleen toewijzen aan wie het bord mag zien.** De keuzelijst toont de
   rest niet, en de server weigert het ook als je het toch probeert.

Instellingen wijzigen mag een beheerder, en degene die het bord heeft aangemaakt.

### Een taak overdragen aan een ander project

Open **Bewerken** en kies bij **Project** een ander project. De taak verhuist
compleet: opmerkingen, historie en bijlagen hangen aan de taak zelf en gaan mee.
In de historie komt te staan wie hem wanneer verplaatste, en van waar naar waar.

Kies je een project waar de uitvoerder geen toegang toe heeft, dan verdwijnt die
persoon uit de keuzelijst en valt de keuze terug op "niemand" — regel 3 hierboven
geldt ook bij verhuizen. Wil je dat hij de taak houdt, geef hem dan eerst toegang
tot dat project.

### Werkprocessen

Een bibliotheek met vaste werkwijzen, bedrijfsbreed. Je maakt er een door een
bestaande procedure in het tekstvak te plakken.

**Het format is: één stap per regel.** De app haalt er zelf af wat Word en mail
eromheen zetten: nummering (`1.`, `1)`, `Stap 1:`), opsommingstekens (`-`, `*`,
`•`) en lege regels. Deze drie leveren dus hetzelfde op:

```
1. Controleer de flesdruk      - Controleer de flesdruk      Controleer de flesdruk
2. Noteer het serienummer      - Noteer het serienummer      Noteer het serienummer
```

Wat niet werkt is lopende tekst: *"Controleer eerst de druk, noteer daarna het
nummer"* wordt één stap, want het is één regel.

Daarom is er een **voorvertoning**: je ziet meteen welke stappen eruit komen en
kunt ze aanpassen, verwijderen, verplaatsen of aanvullen vóór het opslaan. De
herkenning hoeft niet perfect te zijn — wat in de voorvertoning staat, is wat
wordt opgeslagen.

Twee dingen om te weten:

- **Nummers als `10-15 stuks` en temperaturen als `-15 graden` blijven heel.**
  Een cijfer of streepje wordt alleen als opsomming gezien als er een leesteken
  of spatie op volgt.
- **Versies gaan alleen omhoog bij een echte wijziging in de stappen.** De naam
  of toelichting aanpassen verandert de versie niet. Er is bewust geen apart
  versiearchief: zodra een taak een werkproces krijgt (stap 2), krijgt die taak
  een eigen kopie van de stappen, en die kopie is het bewijs van welke versie er
  gevolgd is.

Grenzen: 200 stappen per werkproces, 500 tekens per stap.

### Wie mag werkprocessen beheren

Iedereen die is ingelogd ziet de bibliotheek. Beheren — aanmaken, wijzigen,
verwijderen — mag een beheerder, en ieder lid bij wie op het Teamscherm het
vinkje **mag beheren** aanstaat.

Die aparte instelling bestaat omdat degene die werkinstructies onderhoudt vaak
de kwaliteits- of KAM-coördinator is, en dat is meestal niet degene die de
applicatie beheert. Zo kan die persoon procedures onderhouden zonder toegang tot
accounts en uitnodigingen.

Het is bewust één los recht en geen rechtensysteem. Dat komt pas in beeld bij
het derde losse recht of zodra er combinaties nodig zijn; dan weet je uit de
praktijk welke rechten er werkelijk toe doen.

### Waar bijlagen staan

Naast de database, in `bijlagen/` op dezelfde schijf. Bewust geen externe
opslagdienst: dat zou weer een verwerker in je register betekenen, net als bij
mail. Je bestanden blijven op je eigen server.

**Voor je back-up betekent dit: kopieer de hele `/data`-map, niet alleen het
databasebestand.** Anders heb je straks wel je taken terug, maar geen bijlagen.

Drie dingen die de opslag veilig houden:

- Op schijf krijgt elk bestand een willekeurige naam. De naam die jij kiest staat
  alleen in de database, dus een bestandsnaam als `../../server.js` kan nergens
  buiten de bijlagenmap schrijven.
- Downloaden gaat altijd als download, nooit als pagina. Een geüpload html- of
  svg-bestand zou anders als onderdeel van deze site kunnen draaien en bij de
  sessie van de kijker kunnen komen.
- Bijlagen volgen de zichtbaarheid van hun bord. Kun je het bord niet zien, dan
  kun je de bestanden niet opvragen, toevoegen of verwijderen.

Standaard maximaal 10 MB per bestand en 20 bestanden per taak. Verwijder je een
taak of een bord, dan gaan de bestanden ook echt van schijf.

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

- **Geen mail vanuit de app.** Zie hieronder — dit is een besluit, geen omissie.
- **Geen live bijwerken.** Zie je een wijziging van een collega niet, dan is
  verversen genoeg. Automatisch bijwerken kan later.
- **Geen bijlagen, geen tijdlijn, geen automatiseringen.**

### Waarom er geen mail in zit

Dit heeft er kort in gezeten en is er bewust weer uit gehaald. Voeg het niet
terug zonder overleg met de eigenaar.

De reden: Transafe is ISO 27001-gecertificeerd. Mail versturen namens het eigen
domein vraagt DNS-wijzigingen bij een externe partij, en dat brengt drie dingen
mee die niet opwegen tegen het gemak:

1. **Een verwerker erbij.** E-mailadressen en namen van medewerkers zijn
   persoonsgegevens, dus de mailleverancier hoort in het verwerkersregister met
   een verwerkersovereenkomst.
2. **Risico voor de bestaande bedrijfsmail.** Er mag maar één SPF-regel per naam
   bestaan. Wordt er een tweede toegevoegd in plaats van de bestaande aangevuld,
   dan faalt SPF voor álle mail van het bedrijf.
3. **Een route naar accountovername.** Herstellinks geven toegang tot een
   bestaand account. Die door een externe partij laten lopen is een risico dat je
   voor het gemak van een paar uitnodigingen per jaar niet hoeft te nemen.

Daar staat weinig winst tegenover: een team van tien mensen nodigt een paar keer
per jaar iemand uit. Een link kopiëren en persoonlijk doorsturen kost seconden.

Komt dit terug op de agenda — bijvoorbeeld bij automatische deadlineherinneringen,
waar het wél echt iets oplevert — weeg dan deze drie punten opnieuw. Verifieer in
dat geval een **subdomein** (`taken.transafe.info`) en nooit het hoofddomein: dan
blijft de bestaande bedrijfsmail onaangeroerd en is terugdraaien één handeling.

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
| `MAX_BIJLAGE_MB` | Grootste bestand dat je mag uploaden | `10` |

---

## Als het misgaat

| Melding | Wat te doen |
|---|---|
| `EADDRINUSE` | De app draait al. Sluit dat venster, of start met `PORT=3001 node server.js` |
| Je komt niet meer binnen | Vraag een andere beheerder om een herstellink. Is er geen andere beheerder, dan is de database het enige aanknopingspunt |
| Alles is leeg na een nieuwe versie online | Dan staat het volume niet goed — zie *Hosting*, punt 1 |
| `Cannot find module` | `npm install` vergeten |
