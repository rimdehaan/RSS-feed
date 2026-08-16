// Een ZIP-bestand samenstellen.
//
// Bewust zonder extra pakket: een ZIP is een reeks blokken met vaste velden, en
// het samendrukken zit al in Node (zlib). Dit is het meest technische stukje van
// de app; de opbouw hieronder volgt de officiële indeling van een ZIP-bestand.

import { deflateRawSync } from 'node:zlib';

// ── Controlegetal (CRC-32) ───────────────────────────────────────────────
// Elke ZIP-regel draagt een controlegetal over zijn inhoud, zodat een
// uitpakprogramma kan zien of het bestand onderweg beschadigd is.

const TABEL = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let waarde = i;
  for (let bit = 0; bit < 8; bit++) {
    waarde = waarde & 1 ? 0xedb88320 ^ (waarde >>> 1) : waarde >>> 1;
  }
  TABEL[i] = waarde >>> 0;
}

function crc32(buffer) {
  let waarde = 0xffffffff;
  for (const byte of buffer) waarde = TABEL[(waarde ^ byte) & 0xff] ^ (waarde >>> 8);
  return (waarde ^ 0xffffffff) >>> 0;
}

/** Datum en tijd in de indeling die ZIP gebruikt (twee keer 16 bits). */
function dosTijd(datum) {
  const tijd = (datum.getHours() << 11) | (datum.getMinutes() << 5) | (datum.getSeconds() >> 1);
  const dag = ((datum.getFullYear() - 1980) << 9) | ((datum.getMonth() + 1) << 5) | datum.getDate();
  return { tijd, dag };
}

/** Zorgt dat elke naam in het archief maar één keer voorkomt. */
function uniekeNamen(bestanden) {
  const gezien = new Map();

  return bestanden.map(({ naam, inhoud }) => {
    const basis = naam.replace(/[\\/]/g, '-') || 'bestand';
    if (!gezien.has(basis)) {
      gezien.set(basis, 1);
      return { naam: basis, inhoud };
    }

    const nummer = gezien.get(basis) + 1;
    gezien.set(basis, nummer);

    const punt = basis.lastIndexOf('.');
    const nieuw = punt > 0
      ? `${basis.slice(0, punt)} (${nummer})${basis.slice(punt)}`
      : `${basis} (${nummer})`;

    return { naam: nieuw, inhoud };
  });
}

/**
 * Maakt een ZIP van een lijst { naam, inhoud }. Geeft één Buffer terug.
 * Alles gaat door het geheugen, dus bedoeld voor de bijlagen van één taak.
 */
export function maakZip(bestanden, datum = new Date()) {
  const { tijd, dag } = dosTijd(datum);
  const regels = [];
  const inhoudsopgave = [];
  let positie = 0;

  for (const { naam, inhoud } of uniekeNamen(bestanden)) {
    const naamBytes = Buffer.from(naam, 'utf8');
    const samengedrukt = deflateRawSync(inhoud);
    const controle = crc32(inhoud);

    // Kop vóór het bestand zelf.
    const kop = Buffer.alloc(30);
    kop.writeUInt32LE(0x04034b50, 0);   // herkenningsteken
    kop.writeUInt16LE(20, 4);           // benodigde versie
    kop.writeUInt16LE(0x0800, 6);       // vlag: naam staat in UTF-8
    kop.writeUInt16LE(8, 8);            // methode 8 = samengedrukt
    kop.writeUInt16LE(tijd, 10);
    kop.writeUInt16LE(dag, 12);
    kop.writeUInt32LE(controle, 14);
    kop.writeUInt32LE(samengedrukt.length, 18);
    kop.writeUInt32LE(inhoud.length, 22);
    kop.writeUInt16LE(naamBytes.length, 26);
    kop.writeUInt16LE(0, 28);           // geen extra velden

    regels.push(kop, naamBytes, samengedrukt);

    // Dezelfde gegevens komen achteraan nog een keer, in de inhoudsopgave.
    const regel = Buffer.alloc(46);
    regel.writeUInt32LE(0x02014b50, 0);
    regel.writeUInt16LE(20, 4);         // gemaakt door versie
    regel.writeUInt16LE(20, 6);         // benodigde versie
    regel.writeUInt16LE(0x0800, 8);
    regel.writeUInt16LE(8, 10);
    regel.writeUInt16LE(tijd, 12);
    regel.writeUInt16LE(dag, 14);
    regel.writeUInt32LE(controle, 16);
    regel.writeUInt32LE(samengedrukt.length, 20);
    regel.writeUInt32LE(inhoud.length, 24);
    regel.writeUInt16LE(naamBytes.length, 28);
    regel.writeUInt16LE(0, 30);         // extra
    regel.writeUInt16LE(0, 32);         // opmerking
    regel.writeUInt16LE(0, 34);         // schijfnummer
    regel.writeUInt16LE(0, 36);         // interne kenmerken
    regel.writeUInt32LE(0, 38);         // externe kenmerken
    regel.writeUInt32LE(positie, 42);   // waar de kop hierboven begint

    inhoudsopgave.push(regel, naamBytes);
    positie += kop.length + naamBytes.length + samengedrukt.length;
  }

  const opgave = Buffer.concat(inhoudsopgave);

  // Afsluiter: waar de inhoudsopgave staat en hoeveel regels erin zitten.
  const slot = Buffer.alloc(22);
  slot.writeUInt32LE(0x06054b50, 0);
  slot.writeUInt16LE(0, 4);
  slot.writeUInt16LE(0, 6);
  slot.writeUInt16LE(bestanden.length, 8);
  slot.writeUInt16LE(bestanden.length, 10);
  slot.writeUInt32LE(opgave.length, 12);
  slot.writeUInt32LE(positie, 16);
  slot.writeUInt16LE(0, 20);            // geen opmerking

  return Buffer.concat([...regels, opgave, slot]);
}
