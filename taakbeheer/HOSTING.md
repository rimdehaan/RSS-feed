# Taakbeheer online zetten met Railway

Stap voor stap. Reken op een half uur de eerste keer. Aan het eind heb je een link
die je naar je collega's kunt sturen, en rolt elke wijziging zichzelf uit zodra de
tests slagen.

Kosten: het Hobby-abonnement kost **$5 per maand**, met tegoed dat voor een app als
deze ruim genoeg is.

---

## Deel 1 — De server klaarzetten

### Stap 1: Account

1. Ga naar <https://railway.com> en klik **Login** → **Login with GitHub**.
2. Railway vraagt om een abonnement voordat je kunt uitrollen. Kies **Hobby**.

### Stap 2: Een leeg project met een lege service

1. Klik **New Project**.
2. Kies onderaan **Empty Project** — dus *niet* "GitHub Repository".

Dat lijkt tegen-intuïtief, maar het is met opzet: de code wordt straks aangeleverd
door GitHub Actions, nadat de tests zijn geslaagd. Kies je hier "GitHub Repository",
dan rolt Railway óók zelf uit en krijg je elke wijziging dubbel — ook als de tests
zakken.

Railway kent twee niveaus. Het **project** is de map eromheen; de **service** is de
app die echt draait. Je hebt er dus allebei één nodig.

3. Je krijgt een leeg vlak te zien. Klik daar op **Create** (of het plusje) en kies
   **Empty Service**.
4. Klik op de service → **Settings** → **Service Name**, en noem hem
   **`taakbeheer`**. Die naam moet kloppen met de workflow.

### Stap 3: Regio op Amsterdam

**Settings** → **Deploy** → **Region**: kies **europe-west4 (Amsterdam)**.

Je draait persoonsgegevens van je medewerkers; die horen in Europa te blijven. Het
is bovendien sneller. Doe dit vóór je in gebruik neemt.

### Stap 4: De opslag — dit is de belangrijkste stap

Zonder deze stap is **al je data weg bij elke nieuwe versie**. Railway geeft elke
uitrol een schone machine; alleen een volume overleeft dat.

1. Klik met de rechtermuisknop op het lege vlak naast je service.
2. Kies **Volume** en koppel hem aan je service.
3. Zet **Mount path** op: `/data`

### Stap 5: Instellingen meegeven

Tabblad **Variables** → **New Variable**. Voeg deze twee toe:

| Naam | Waarde |
|---|---|
| `DATABASE_PAD` | `/data/taakbeheer.db` |
| `NODE_ENV` | `production` |

De eerste zegt: bewaar de database op het volume uit stap 4. De tweede zorgt dat
inlogcookies alleen nog over https gaan.

`PORT` hoef je **niet** in te vullen — die zet Railway zelf.

### Stap 6: Je link aanzetten

**Settings** → **Networking** → **Generate Domain**.

Je krijgt iets als `taakbeheer-production-a1b2.up.railway.app`. Dat is je link.

---

## Deel 2 — GitHub laten uitrollen

### Stap 7: Een token maken in Railway

1. Ga naar je **project**settings (niet die van de service) → tabblad **Tokens**.
2. Maak een token, gekoppeld aan de omgeving **production**.
3. Kopieer hem meteen — je krijgt hem maar één keer te zien.

Dit is een projecttoken: het geeft toegang tot dít project, niet tot je hele
Railway-account. Dat is precies genoeg.

### Stap 8: Het token in GitHub zetten

1. Ga naar je repo op GitHub → **Settings** (van de repo, niet van je account).
2. In de zijbalk: **Secrets and variables** → **Actions**.
3. Klik **New repository secret**.
4. Naam: **`RAILWAY_TOKEN`** — precies zo geschreven. Waarde: het token uit stap 7.

Een secret is eenrichtingsverkeer: GitHub kan hem gebruiken, maar niemand kan hem
meer uitlezen — jij ook niet. Kwijt? Maak dan een nieuwe in Railway.

> Heb je je service in Railway anders genoemd dan `taakbeheer`? Voeg dan op
> hetzelfde scherm onder **Variables** een variabele `RAILWAY_SERVICE` toe met die
> naam erin.

### Stap 9: Uitrollen

1. Ga op GitHub naar het tabblad **Actions**.
2. Kies links de workflow **Taakbeheer**.
3. Klik **Run workflow**, kies je branch, en bevestig.

Je ziet nu twee blokken: eerst **Tests**, dan **Uitrollen naar Railway**. Zakken de
tests, dan gebeurt er niets — dat is het hele punt.

Daarna gaat het vanzelf: elke push naar `main` die de tests haalt, rolt uit. Werk je
op een andere branch, dan draaien alleen de tests; uitrollen doe je dan met de knop
**Run workflow**.

### Stap 10: In gebruik nemen

1. Open je link uit stap 6. Je komt op **Eerste beheerder aanmaken**.
2. Vul je naam, e-mailadres en een wachtwoord van minstens 10 tekens in.
3. Ga naar **Team** en nodig je collega's uit. Kopieer de link en stuur hem door.

Dat setup-scherm verdwijnt zodra dit eerste account bestaat.

**Maak meteen een tweede beheerder.** Raak jij je wachtwoord kwijt en ben je de
enige beheerder, dan is er geen weg terug.

---

## Controleer of het echt goed staat

Doe deze test één keer, nu het nog niet uitmaakt:

1. Maak een taak aan.
2. Ga in Railway naar je service en klik **Redeploy**.
3. Wacht tot hij klaar is en ververs je app.

**Staat je taak er nog?** Dan is het volume goed gekoppeld. Moet je opnieuw een
beheerder aanmaken, dan klopt stap 4 of 5 niet: kijk of het mount path exact `/data`
is en `DATABASE_PAD` exact `/data/taakbeheer.db`.

## Back-ups

Je hele administratie is dat ene bestand op het volume. Railway kan snapshots van
volumes maken — zet dat aan, of haal het bestand er af en toe zelf af.

Een back-up die je nooit hebt teruggezet is geen back-up. Probeer één keer of je van
een kopie kunt starten.

---

## Als er iets misgaat

Bij een rood kruisje op GitHub: klik erop, dan op het gezakte blok. De regel die je
zoekt staat meestal onderaan.

| Wat je ziet | Wat het betekent |
|---|---|
| Tests zakken, geen uitrol | Werkt zoals bedoeld. Lees welke controle faalde en plak die bij Claude |
| `Geen RAILWAY_TOKEN ingesteld` | Stap 8 nog niet gedaan, of de naam is niet exact `RAILWAY_TOKEN` |
| `Service not found` | De servicenaam in Railway wijkt af — zie de opmerking bij stap 8 |
| `Project token not found` | Het token is ingetrokken of hoort bij een ander project. Maak een nieuwe (stap 7) |
| Uitrol slaagt, app doet niets | Kijk in Railway onder **Deploy Logs**. Daar staat wat de server zelf zegt |
| Alles leeg na een nieuwe versie | Volume of `DATABASE_PAD` klopt niet (stap 4 en 5) |
| Bouwen mislukt op `better-sqlite3` | Meestal tijdelijk. Draai de workflow opnieuw |

Plak een foutmelding gerust letterlijk bij Claude — dat is de snelste route naar een
oplossing.

---

## Had je al "GitHub Repository" gekozen?

Dan rolt Railway zelf ook uit, en krijg je elke wijziging dubbel — zonder dat de
tests iets tegenhouden. Ga naar **Settings** → **Source** en ontkoppel de repo.
De GitHub Actions-route neemt het over.
