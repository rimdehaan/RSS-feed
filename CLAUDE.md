# CLAUDE.md

## Projecten in deze repo

Er staan twee losse projecten in. Ze delen bewust geen code.

### 1. RSS-lezer (hoofdmap)

Een simpele RSS-lezer om mee te leren vibe-coden.

- **Geen dependencies.** Alleen ingebouwde Node-modules en gewoon HTML/CSS/JS in
  de browser. `node server.js` moet blijven werken zonder `npm install`.
- `server.js` — HTTP-server, feed ophalen, XML-parser
- `public/index.html` — de hele interface

### 2. Taakbeheer (`taakbeheer/`)

Takenbeheer voor meerdere gebruikers, in de geest van monday.com. Voortgekomen
uit een prototype van de eigenaar dat alles in `localStorage` bewaarde.

- **Hier mogen wél pakketten in**, maar zuinig: nu alleen `express` en
  `better-sqlite3`. Voeg er niets bij zonder te overleggen.
- **Geen mail vanuit de app.** Dit heeft er ingezeten en is er bewust weer uit
  gehaald: Transafe is ISO 27001-gecertificeerd, en een externe maildienst kost
  een verwerker in het register plus DNS-wijzigingen die de bestaande
  bedrijfsmail kunnen raken. Uitnodigingen en herstellinks gaan als link over het
  scherm. Niet terugbouwen zonder overleg; de afweging staat in
  `taakbeheer/README.md`.
- `server.js` — koppelt alles aan elkaar
- `src/db.js` — database en tabellen · `src/auth.js` — wachtwoorden en sessies ·
  `src/api.js` — alle API-routes
- **Twee omgevingen, één codebase.** Dezelfde code draait zakelijk én als
  privé-versie thuis; ze verschillen alleen in naam, logo en een handvol woorden.
  Die woorden staan allemaal in `src/omgeving.js` — nergens anders in de app hoort
  "als het thuis is, dan…" te staan. Schrijf je een tekst die thuis niet klopt
  (collega, team, uit dienst), zet hem dan daar neer en vraag hem op via
  `staat.woorden` in de browser of `woorden` op de server.
- `public/` — inloggen, de app, opmaak
- `public/stappen.js` — knipt geplakte tekst in stappen. Staat in `public/` omdat
  de browser hem nodig heeft voor de voorvertoning, maar de server importeert
  hetzelfde bestand bij het opslaan. Eén regelset, geen twee die uit elkaar lopen.
- Zie `taakbeheer/README.md` voor draaien, hosting en wat er bewust nog niet in zit.

## Algemene uitgangspunten

- **Klein houden.** Liever leesbare code dan slimme code.
- **Nederlands** in alles: namen van variabelen en functies, commentaar, teksten
  in de interface, commitberichten en de uitleg aan de eigenaar. Zonder
  uitzondering — de statussen en prioriteiten stonden vroeger in het Engels,
  maar zijn dat sinds de tekstronde niet meer.
- **Huisstijl Transafe** in Taakbeheer: donkerblauw `#002944`, blauwgrijs
  `#5B869F`, grijs `#B3B3B3`. De zes statussen en hun kleuren liggen vast (Niet
  gestart, Mee bezig, Controleren, Afgerond, Geparkeerd, Vervallen), net als de
  vier prioriteiten (Kritiek, Hoog, Middel, Laag) en die van hen.
- **De naam van een status is ook een sleutel.** Hij staat letterlijk bij elke
  taak in de database, bepaalt de kleurklasse in de opmaak (`s-mee-bezig`) en
  wordt in `app.js` gebruikt om te bepalen of een taak af is. Hernoemen is dus
  nooit alleen tekst: het vraagt een verhuizing in `db.js`, aanpassing van
  `KLEUREN`/`PRIO_KLEUREN`/`AFGEROND` en van de klassen in `stijl.css`.

## Draaien en testen

```bash
node server.js                     # RSS-lezer op http://localhost:3000
cd taakbeheer && node server.js    # Taakbeheer op http://localhost:3000
```

Externe feeds zijn niet altijd bereikbaar vanuit een sandbox. Test de RSS-parser
dan tegen een lokale XML-fixture op een eigen poort.

Voor Taakbeheer: draai server en test in **één** shell-commando — een server die
in een eerdere aanroep op de achtergrond is gestart, is later niet meer via het
netwerk bereikbaar. Gebruik geen `pkill -f` met een patroon dat ook in je eigen
commandoregel voorkomt; dan sluit de shell zichzelf af.

## Werken met de eigenaar

Leg wijzigingen kort uit in gewone taal: wat er is veranderd en wat er nu anders
werkt in de app. Geen jargon zonder uitleg.
