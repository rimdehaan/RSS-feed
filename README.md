# RSS-feed — jouw startpunt om te vibe-coden

Dit is een werkende mini-app: je typt een RSS-adres in en je ziet de laatste
berichten in je browser. Klein genoeg om te snappen, echt genoeg om op door te bouwen.

---

## Deel 1 — Wat je één keer moet installeren

Je hebt drie dingen nodig op je eigen computer. Meer niet.

### 1. Node.js

Dit is het programma dat jouw code kan uitvoeren.

- Ga naar <https://nodejs.org> en download de **LTS**-versie.
- Installeren = volgende, volgende, klaar.
- Controleren of het gelukt is: open Terminal (Mac) of PowerShell (Windows) en typ:

  ```bash
  node --version
  ```

  Zie je zoiets als `v22.x.x`? Dan ben je klaar.

### 2. Git

Dit bewaart de geschiedenis van je project en praat met GitHub.

- Mac: typ `git --version` in Terminal, dan biedt je Mac aan om het te installeren.
- Windows: <https://git-scm.com/download/win>
- Eén keer je naam instellen:

  ```bash
  git config --global user.name "Rim de Haan"
  git config --global user.email "rim.transafe@gmail.com"
  ```

### 3. Een editor + Claude Code

- Installeer **VS Code**: <https://code.visualstudio.com>
- Installeer **Claude Code** (de tool waarmee je vibe-codet):

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

  Daarna start je 'm in de map van je project met:

  ```bash
  claude
  ```

> Je gebruikt Claude Code nu al via de web-versie. Dat werkt prima. Lokaal
> installeren is handig zodra je de app in je eigen browser wilt zien draaien.

---

## Deel 2 — Dit project op je computer krijgen

Open Terminal / PowerShell en plak dit, regel voor regel:

```bash
git clone https://github.com/rimdehaan/RSS-feed.git
cd RSS-feed
node server.js
```

Open dan <http://localhost:3000> in je browser. Je ziet nieuwsberichten.

Stoppen doe je met `Ctrl + C` in het terminalvenster.

Er is bewust **geen `npm install`** nodig: dit project gebruikt alleen dingen
die al in Node zitten. Eén ding minder dat stuk kan gaan.

---

## Deel 3 — Zo werkt vibe-coden echt

Vibe-coden is geen magie en ook geen "de AI doet alles". Het is een lus van
vier stappen die je steeds herhaalt:

```
1. Zeggen wat je wilt   ->  2. Claude schrijft de code
        ^                            |
        |                            v
4. Vertellen wat er mis is  <-  3. Jij kijkt of het klopt
```

Stap 3 is jouw echte werk. Je hoeft de code niet te kunnen schrijven, maar je
moet wel **kijken of het resultaat klopt**. Draait de app? Ziet het eruit zoals
je wilde? Zo niet: terug naar stap 4.

### Goede opdrachten geven

Het verschil zit 'm in concreet zijn.

| Werkt matig | Werkt goed |
|---|---|
| "Maak het mooier" | "Zet de datum boven de titel en maak 'm grijs en kleiner" |
| "Voeg zoeken toe" | "Voeg een zoekbalk toe die de lijst filtert op woorden in de titel" |
| "Het doet het niet" | "Ik krijg 'Ophalen mislukt: status 404' bij feed-URL X" |

Drie vuistregels:

1. **Vraag één ding tegelijk.** Klein en af is beter dan groot en half.
2. **Plak foutmeldingen letterlijk.** Kopieer wat er op je scherm staat.
3. **Zeg het gewoon als je iets niet snapt.** "Leg uit wat dit bestand doet" is
   een prima opdracht.

### Ideeën voor je volgende stap

Kopieer er gerust eentje letterlijk naar Claude:

- "Laat me meerdere feeds tegelijk toevoegen en bewaar ze, zodat ze er na het
  herladen van de pagina nog steeds zijn."
- "Sorteer alle berichten van alle feeds op datum, nieuwste bovenaan."
- "Voeg een knop toe om een bericht als gelezen te markeren."
- "Maak een donkere modus met een schakelaar."
- "Toon het plaatje bij een bericht als de feed er een heeft."

---

## Deel 4 — Je werk bewaren

Na elke wijziging die werkt:

```bash
git add .
git commit -m "korte omschrijving van wat je veranderde"
git push
```

Je kunt dit ook gewoon aan Claude vragen: *"commit en push dit voor me."*

Ben je iets stukgemaakt en wil je terug naar de laatste werkende versie?

```bash
git restore .
```

Dat is je vangnet. Daarom commit je vaak.

---

## Wat er in dit project zit

| Bestand | Wat het doet |
|---|---|
| `server.js` | Haalt de feed op, zet de XML om naar iets bruikbaars, serveert de pagina |
| `public/index.html` | Alles wat je ziet: opmaak en de knoppen |
| `package.json` | Naam en startcommando van het project |
| `CLAUDE.md` | Context voor Claude, zodat het project niet steeds opnieuw uitgelegd hoeft |

---

## Als het misgaat

| Melding | Wat te doen |
|---|---|
| `command not found: node` | Node.js is niet (goed) geïnstalleerd — zie Deel 1 |
| `EADDRINUSE` / poort bezet | De app draait al ergens. Sluit dat venster, of start met `PORT=3001 node server.js` |
| `Ophalen mislukt: status 403` | Die website blokkeert het ophalen. Probeer een andere feed-URL |
| Lege pagina | Kijk in het terminalvenster of daar een rode foutmelding staat, en plak die bij Claude |
