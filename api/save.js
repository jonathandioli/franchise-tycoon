// Cloud save for Franchise Tycoon.
// One JSON file per family code in a private Vercel Blob store:
//   GET  /api/save?code=smith-7421  -> { save: {...} | null }
//   PUT  /api/save?code=smith-7421  -> body is the save; overwrites
// The code is hashed into the pathname so it never appears in the store.
import { put, get } from '@vercel/blob';
import { createHash } from 'node:crypto';

const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
const MAX_BYTES = 512 * 1024;

function pathFor(code) {
  const h = createHash('sha256').update('franchise-tycoon:' + code).digest('hex').slice(0, 40);
  return `saves/${h}.json`;
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
  const pathname = pathFor(code);

  try {
    if (req.method === 'GET') {
      const r = await get(pathname, { access: ACCESS, useCache: false });
      if (!r || r.statusCode !== 200) return res.status(200).json({ save: null });
      const text = await new Response(r.stream).text();
      return res.status(200).json({ save: JSON.parse(text) });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || body.v !== 1 || !Array.isArray(body.franchises)) {
        return res.status(400).json({ error: 'That does not look like a Franchise Tycoon save.' });
      }
      const json = JSON.stringify(body);
      if (json.length > MAX_BYTES) return res.status(413).json({ error: 'Save is too large.' });
      await put(pathname, json, {
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
