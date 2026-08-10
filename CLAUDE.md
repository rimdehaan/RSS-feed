# CLAUDE.md

## Project

Een simpele RSS-lezer. De eigenaar is beginnend met programmeren en gebruikt dit
project om te leren vibe-coden.

## Uitgangspunten

- **Geen dependencies.** Alleen ingebouwde Node-modules en gewoon HTML/CSS/JS in
  de browser. Voeg geen npm-pakketten of build-stap toe tenzij er expliciet om
  gevraagd wordt — `node server.js` moet blijven werken zonder `npm install`.
- **Klein houden.** Liever leesbare code dan slimme code.
- **Nederlands** in commentaar, teksten in de interface en in de uitleg.

## Structuur

- `server.js` — HTTP-server, feed ophalen, XML-parser
- `public/index.html` — de hele interface (opmaak en JS zitten in dit bestand)

## Draaien en testen

```bash
node server.js   # http://localhost:3000
```

Externe feeds zijn niet altijd bereikbaar vanuit een sandbox. Test de parser dan
tegen een lokale XML-fixture op een eigen poort in plaats van tegen een echte feed.

## Werken met de eigenaar

Leg wijzigingen kort uit in gewone taal: wat er is veranderd en wat er nu anders
werkt in de app. Geen jargon zonder uitleg.
