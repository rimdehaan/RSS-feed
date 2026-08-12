# Taakbeheer online zetten met Railway

Stap voor stap, met de schermen zoals je ze tegenkomt. Reken op een kwartier.
Aan het eind heb je een link die je naar je collega's kunt sturen.

Kosten: het Hobby-abonnement kost **$5 per maand**. Daar hoort tegoed bij dat voor
een app als deze ruim genoeg is.

---

## Stap 1 — Account maken

1. Ga naar <https://railway.com> en klik **Login**.
2. Kies **Login with GitHub**. Dan hoef je later niets extra's te koppelen.
3. Railway vraagt om een abonnement voordat je kunt uitrollen. Kies **Hobby**.

## Stap 2 — Project aanmaken vanaf GitHub

1. Klik **New Project**.
2. Kies **Deploy from GitHub repo**.
3. Staat je repo er niet bij? Klik **Configure GitHub App** en geef Railway
   toegang tot `rimdehaan/RSS-feed`.
4. Kies **RSS-feed**.

Railway begint meteen te bouwen. **Dat gaat de eerste keer mis** — dat hoort zo.
Railway kijkt nu nog naar de hoofdmap, waar de RSS-lezer staat. Dat repareren we
in de volgende stap.

## Stap 3 — Wijs de juiste map en branch aan

Klik op het blokje van je service, dan op het tabblad **Settings**.

Onder **Source**:

| Veld | Waarde |
|---|---|
| Branch | `claude/vibe-coden-getting-started-vdn6gh` |
| Root Directory | `taakbeheer` |

De rest van de instellingen (startcommando, herstart bij fouten) leest Railway uit
`railway.json`, dat al in de map staat. Daar hoef je niets aan te doen.

## Stap 4 — Regio op Amsterdam

Nog steeds in **Settings**, onder **Deploy** → **Region**: kies
**europe-west4 (Amsterdam)**.

Doe dit vóór je echt in gebruik neemt. Je draait gegevens van je medewerkers;
die horen in Europa te blijven, en het scheelt ook nog eens snelheid.

## Stap 5 — De opslag (de belangrijkste stap)

Zonder deze stap is **al je data weg bij elke nieuwe versie** die je uitrolt.
Railway geeft elke uitrol een schone machine; alleen een volume overleeft dat.

1. Klik met de rechtermuisknop op het lege vlak naast je service.
2. Kies **Volume**, en koppel hem aan je service.
3. Zet **Mount path** op: `/data`

## Stap 6 — Instellingen meegeven

Tabblad **Variables** → **New Variable**. Voeg deze twee toe:

| Naam | Waarde |
|---|---|
| `DATABASE_PAD` | `/data/taakbeheer.db` |
| `NODE_ENV` | `production` |

De eerste zegt: bewaar de database op het volume uit stap 5. De tweede zorgt dat
inlogcookies alleen nog over https gaan.

`PORT` hoef je **niet** in te vullen — die zet Railway zelf.

## Stap 7 — Je link aanzetten

Tabblad **Settings** → **Networking** → **Generate Domain**.

Je krijgt iets als `taakbeheer-production-a1b2.up.railway.app`. Dat is je link.

## Stap 8 — In gebruik nemen

1. Open de link. Je komt op het scherm **Eerste beheerder aanmaken**.
2. Vul je naam, e-mailadres en een wachtwoord van minstens 10 tekens in.
3. Je bent binnen. Ga naar **Team** en nodig je collega's uit.
4. Kopieer de uitnodigingslink en stuur die per mail of Teams door.

Dat setup-scherm verdwijnt zodra dit eerste account bestaat. Niemand anders kan
het dus nog gebruiken.

---

## Controleer of het echt goed staat

Doe deze test één keer, nu het nog niet uitmaakt:

1. Maak een taak aan.
2. Ga in Railway naar je service en klik **Redeploy**.
3. Wacht tot hij klaar is en ververs je app.

**Staat je taak er nog?** Dan is het volume goed gekoppeld. Is hij weg en moet je
opnieuw een beheerder aanmaken, dan klopt stap 5 of stap 6 niet — kijk of het
mount path exact `/data` is en of `DATABASE_PAD` exact `/data/taakbeheer.db` is.

## Back-ups

Je hele administratie is dat ene bestand op het volume. Maak er regelmatig een
kopie van. Railway kan snapshots van volumes maken; zet dat aan, of haal het
bestand er af en toe zelf af.

Een back-up die je nooit hebt teruggezet is geen back-up. Probeer één keer of je
van een kopie kunt starten.

---

## Als er iets misgaat

Klik op je service en dan op **Deploy Logs**. Daar staat wat er gebeurde.

| Wat je ziet | Wat het betekent |
|---|---|
| `Cannot find module 'express'` | Root Directory staat niet op `taakbeheer` (stap 3) |
| Alles leeg na een nieuwe versie | Volume of `DATABASE_PAD` klopt niet (stap 5 en 6) |
| Bouwen mislukt op `better-sqlite3` | Meestal tijdelijk. Klik **Redeploy** |
| Je komt niet meer binnen als beheerder | Zonder tweede beheerder is er geen weg terug. Maak daarom meteen een tweede beheerdersaccount aan |
| Health check faalt | De app start niet. Kijk in de logs naar de regel vlak voor de fout |

Plak een foutmelding gerust letterlijk bij Claude — dat is de snelste route naar
een oplossing.

## Later, als dit naar de hoofdbranch gaat

Zodra dit werk in `main` staat, zet je in **Settings → Source → Branch** de
branch op `main`. Daarna rolt elke push naar `main` vanzelf uit.
