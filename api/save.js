// Cloud save for Fact Franchise.
// Each player is one JSON file in a private Vercel Blob store, grouped by family code:
//   saves/<hash of family code>/<player id>.json
//   GET  /api/save?code=smith-7421              -> { players: [ {id, name, color, updated, deleted?, save}, ... ] }
//   PUT  /api/save?code=smith-7421&player=<id>  -> body is that one player; overwrites only their file
// One file per player means two kids playing on two devices never overwrite each other.
// The family code is hashed into the path so it never appears in the store.
import { put, list } from '@vercel/blob';
import { ACCESS, blobToken, hasBlobCredentials, notConfigured, validCode, familyHash, readJson } from './_blob.js';

const MAX_BYTES = 512 * 1024;
const familyPrefix = code => `saves/${familyHash(code)}/`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.query.code || '').trim().toLowerCase();
  if (!validCode(code)) return res.status(400).json({ error: 'Family code must be 4–40 letters, numbers or dashes.' });
  if (!hasBlobCredentials()) return notConfigured(res);
  const token = blobToken();   // undefined -> SDK uses OIDC with BLOB_STORE_ID
  const prefix = familyPrefix(code);

  try {
    if (req.method === 'GET') {
      const pathnames = [];
      let cursor;
      do {
        const page = await list({ prefix, cursor, limit: 100, token });
        page.blobs.forEach(b => pathnames.push(b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const players = (await Promise.all(pathnames.map(p => readJson(p, token).catch(() => null)))).filter(Boolean);
      return res.status(200).json({ players });
    }

    if (req.method === 'PUT') {
      const player = String(req.query.player || '');
      if (!/^[a-z0-9]{4,24}$/.test(player)) return res.status(400).json({ error: 'Missing or invalid player id.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const valid = body && typeof body === 'object' && body.id === player && typeof body.name === 'string'
        && body.name.length <= 24 && (body.deleted === true || (body.save && Array.isArray(body.save.franchises)));
      if (!valid) return res.status(400).json({ error: 'That does not look like a Fact Franchise player.' });
      const json = JSON.stringify(body);
      if (json.length > MAX_BYTES) return res.status(413).json({ error: 'Save is too large.' });
      await put(prefix + player + '.json', json, {
        access: ACCESS,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
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
