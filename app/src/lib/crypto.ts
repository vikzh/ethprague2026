"use client";

/**
 * Tiny AES-GCM wrapper around the browser's Web Crypto API. Used for encrypting
 * 1:1 DM bodies with a key derived from ECDH between the two members' chat eph
 * keys (see `dm.ts`).
 */

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt `plaintext` with `rawKey`. Returns a single Uint8Array = iv (12) || ciphertext+tag. */
export async function aesGcmEncrypt(
  rawKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext as BufferSource),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

/** Decrypt a payload of shape iv (12) || ciphertext+tag. Throws on auth failure. */
export async function aesGcmDecrypt(
  rawKey: Uint8Array,
  payload: Uint8Array,
): Promise<Uint8Array> {
  if (payload.length < 13) throw new Error("payload too short");
  const iv = payload.slice(0, 12);
  const ct = payload.slice(12);
  const key = await importAesKey(rawKey);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct as BufferSource),
  );
}
