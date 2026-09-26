// Shared Blob helpers for the API routes (files starting with _ are not routes on Vercel).
import { get } from '@vercel/blob';
import { createHash } from 'node:crypto';

export const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

// Blob credentials, in the order the SDK accepts them:
//  - a read-write token (BLOB_READ_WRITE_TOKEN, or <PREFIX>_READ_WRITE_TOKEN with a custom prefix), or
//  - newer stores: BLOB_STORE_ID + Vercel's OIDC token, which the SDK picks up itself when no token is passed.
export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const name = Object.keys(process.env).find(k => k.endsWith('_READ_WRITE_TOKEN'));
  return name ? process.env[name] : undefined;
}
export const hasBlobCredentials = () => Boolean(blobToken() || process.env.BLOB_STORE_ID);

export function notConfigured(res) {
  // Names only (never values), so a misconnected store is easy to spot.
  const seen = Object.keys(process.env).filter(k => /BLOB|READ_WRITE|STORE/i.test(k));
  return res.status(503).json({
    error: 'Cloud save is not set up: connect a Blob store to this Vercel project (Production environment), then redeploy.',
    env: process.env.VERCEL_ENV || null,
    storageVarsSeen: seen,
  });
}

export const validCode = code => /^[a-z0-9-]{4,40}$/.test(code);

// Keep the original salt: changing it would orphan every existing family's saves.
export function familyHash(code) {
  return createHash('sha256').update('franchise-tycoon:' + code).digest('hex').slice(0, 40);
}
export function emailHash(email) {
  return createHash('sha256').update('franchise-tycoon-email:' + email).digest('hex').slice(0, 40);
}

export async function readJson(pathname, token) {
  const r = await get(pathname, { access: ACCESS, useCache: false, token });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}
