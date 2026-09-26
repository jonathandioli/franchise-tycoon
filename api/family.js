// Family details (the parent email) for Fact Franchise, kept beside the player saves:
//   families/<hash of code>.json  -> { code, email, createdAt, updatedAt }
//   emails/<hash of email>.json   -> { email, codes: [...] }   (so a lost code can be looked up by email)
//   GET  /api/family?code=comets-452  -> { exists, email: "j•••@gmail.com" | null }
//   POST /api/family?code=comets-452  -> body { email }; sets or changes the family's email
import { put } from '@vercel/blob';
import { ACCESS, blobToken, hasBlobCredentials, notConfigured, validCode, familyHash, emailHash, readJson } from './_blob.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const mask = email => { const [user, domain] = email.split('@'); return `${user[0]}•••@${domain}`; };

async function writeJson(pathname, data, token) {
  await put(pathname, JSON.stringify(data), {
    access: ACCESS, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, token,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.query.code || '').trim().toLowerCase();
  if (!validCode(code)) return res.status(400).json({ error: 'Family codes look like comets-452.' });
  if (!hasBlobCredentials()) return notConfigured(res);
  const token = blobToken();
  const familyPath = `families/${familyHash(code)}.json`;

  try {
    if (req.method === 'GET') {
      const fam = await readJson(familyPath, token);
      return res.status(200).json({ exists: Boolean(fam), email: fam && fam.email ? mask(fam.email) : null });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: 'That email doesn’t look right. Check it and try again.' });

      const now = new Date().toISOString();
      const fam = (await readJson(familyPath, token)) || { code, createdAt: now };
      const previous = fam.email;
      await writeJson(familyPath, { ...fam, code, email, updatedAt: now }, token);

      const emailPath = `emails/${emailHash(email)}.json`;
      const byEmail = (await readJson(emailPath, token)) || { email, codes: [] };
      if (!byEmail.codes.includes(code)) byEmail.codes.push(code);
      await writeJson(emailPath, byEmail, token);

      // Changing the email: drop this code from the old address's list.
      if (previous && previous !== email) {
        const oldPath = `emails/${emailHash(previous)}.json`;
        const old = await readJson(oldPath, token);
        if (old) await writeJson(oldPath, { ...old, codes: old.codes.filter(c => c !== code) }, token);
      }
      return res.status(200).json({ ok: true, email: mask(email) });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST.' });
  } catch (err) {
    console.error('family error', err);
    return res.status(500).json({ error: 'Could not save the email. Try again in a moment.' });
  }
}
