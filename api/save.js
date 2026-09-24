// Cloud save for Franchise Tycoon.
// Each player is one JSON file in a private Vercel Blob store, grouped by family code:
//   saves/<hash of family code>/<player id>.json
//   GET  /api/save?code=smith-7421              -> { players: [ {id, name, color, updated, deleted?, save}, ... ] }
//   PUT  /api/save?code=smith-7421&player=<id>  -> body is that one player; overwrites only their file
// One file per player means two kids playing on two devices never overwrite each other.
// The family code is hashed into the path so it never appears in the store.
import { put, get, list } from '@vercel/blob';
import { createHash } from 'node:crypto';

const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
const MAX_BYTES = 512 * 1024;

function familyPrefix(code) {
  const h = createHash('sha256').update('franchise-tycoon:' + code).digest('hex').slice(0, 40);
  return `saves/${h}/`;
}

async function readJson(pathname) {
  const r = await get(pathname, { access: ACCESS, useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.query.code || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(code)) {
    return res.status(400).json({ error: 'Family code must be 4–40 letters, numbers or dashes.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Cloud save is not set up: connect a Blob store to this Vercel project.' });
  }
  const prefix = familyPrefix(code);

  try {
    if (req.method === 'GET') {
      const pathnames = [];
      let cursor;
      do {
        const page = await list({ prefix, cursor, limit: 100 });
        page.blobs.forEach(b => pathnames.push(b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const players = (await Promise.all(pathnames.map(p => readJson(p).catch(() => null)))).filter(Boolean);
      return res.status(200).json({ players });
    }

    if (req.method === 'PUT') {
      const player = String(req.query.player || '');
      if (!/^[a-z0-9]{4,24}$/.test(player)) return res.status(400).json({ error: 'Missing or invalid player id.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const valid = body && typeof body === 'object' && body.id === player && typeof body.name === 'string'
        && body.name.length <= 24 && (body.deleted === true || (body.save && Array.isArray(body.save.franchises)));
      if (!valid) return res.status(400).json({ error: 'That does not look like a Franchise Tycoon player.' });
      const json = JSON.stringify(body);
      if (json.length > MAX_BYTES) return res.status(413).json({ error: 'Save is too large.' });
      await put(prefix + player + '.json', json, {
        access: ACCESS,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true, updated: body.updated || null });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Use GET or PUT.' });
  } catch (err) {
    console.error('save error', err);
    return res.status(500).json({ error: 'Cloud save failed. Progress is still saved on this device.' });
  }
}
