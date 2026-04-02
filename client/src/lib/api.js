/**
 * api.js — HTTP helpers for auth and public key retrieval.
 */

/**
 * Exchange a Google ID token (+ optional invite code) for a JWT session.
 * Returns { token, user } on success, or { status: 'pending_approval' } for pending accounts.
 * Throws on error.
 */
export async function loginWithGoogle(idToken, inviteCode = null) {
  const body = { idToken };
  if (inviteCode) body.inviteCode = inviteCode;

  const res = await fetch('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (res.status === 401) throw new Error('Invalid Google token');
  if (res.status === 403) throw new Error(data.error || 'Forbidden');
  if (res.status === 400) throw new Error(data.error || 'Bad request');
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);

  return data;
}

/**
 * Get the current user's info from the server.
 */
export async function getMe(token) {
  const res = await fetch('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetch the PC's cached public key from the server.
 * Returns the base64-encoded SPKI string.
 */
export async function getPCPublicKey(token) {
  const res = await fetch('/pc-pubkey', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 503) throw new Error('PC is not connected');
  if (!res.ok) throw new Error(`Failed to get public key: ${res.status}`);
  const { publicKey } = await res.json();
  return publicKey;
}

// ── Invite code management (admin) ──────────────────────────────────────────

export async function generateCode(token, { type = 'registration', usesRemaining = 1, expiresInHours = null } = {}) {
  const res = await fetch('/codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, usesRemaining, expiresInHours }),
  });
  if (!res.ok) throw new Error(`Failed to generate code: ${res.status}`);
  return res.json();
}

export async function listCodes(token) {
  const res = await fetch('/codes', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to list codes: ${res.status}`);
  return res.json();
}

export async function deleteCode(token, id) {
  const res = await fetch(`/codes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to delete code: ${res.status}`);
  return res.json();
}
