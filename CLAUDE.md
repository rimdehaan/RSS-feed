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
- `server.js` — koppelt alles aan elkaar
- `src/db.js` — database en tabellen · `src/auth.js` — wachtwoorden en sessies ·
  `src/api.js` — alle API-routes
- `public/` — inloggen, de app, opmaak
- Zie `taakbeheer/README.md` voor draaien, hosting en wat er bewust nog niet in zit.

## Algemene uitgangspunten

- **Klein houden.** Liever leesbare code dan slimme code.
- **Nederlands** in commentaar, teksten in de interface en in de uitleg.
- **Huisstijl Transafe** in Taakbeheer: donkerblauw `#002944`, blauwgrijs
  `#5B869F`, grijs `#B3B3B3`. De zes statussen en hun kleuren liggen vast.

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
