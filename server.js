// Simpele RSS-lezer. Draait op kale Node.js, dus geen npm install nodig.
// Starten:  node server.js   ->  open http://localhost:3000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// --- RSS/Atom uitlezen ---------------------------------------------------
// Bewust een kleine, simpele parser: genoeg voor normale feeds.

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decode(match[1]) : '';
}

function stripHtml(text) {
  return decode(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
}

function parseFeed(xml) {
  const title = tag(xml.replace(/<item[\s\S]*/i, '').replace(/<entry[\s\S]*/i, ''), 'title') || 'Feed';
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];

  const items = blocks.map((block) => {
    // Atom zet de link in een attribuut, RSS in de tekst van <link>.
    const atomLink = block.match(/<link[^>]*href="([^"]+)"/i);
    return {
      title: tag(block, 'title') || '(geen titel)',
      link: atomLink ? decode(atomLink[1]) : tag(block, 'link'),
      date: tag(block, 'pubDate') || tag(block, 'updated') || tag(block, 'published'),
      summary: stripHtml(tag(block, 'description') || tag(block, 'summary') || '').slice(0, 300),
    };
  });

  return { title, items };
}

// --- Webserver -----------------------------------------------------------

async function handleFeed(url, res) {
  const feedUrl = url.searchParams.get('url');

  if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Geef een geldige feed-URL mee (http of https).' }));
    return;
  }

  try {
    const response = await fetch(feedUrl, { headers: { 'user-agent': 'rss-feed-starter' } });
    if (!response.ok) throw new Error(`Server gaf status ${response.status}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(parseFeed(await response.text())));
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Ophalen mislukt: ${error.message}` }));
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/feed') {
    await handleFeed(url, res);
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = await readFile(join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Niet gevonden');
});

server.listen(PORT, () => {
  console.log(`RSS-lezer draait op http://localhost:${PORT}`);
});
