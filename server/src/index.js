import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import {
  initAuth,
  verifyGoogleToken,
  signJwt,
  verifyJwt,
  verifyPcSecret,
  requireActive,
  requireAdmin,
} from './auth.js';
import {
  findUserByGoogleSub,
  createUser,
  getUserById,
  validateInviteCode,
  decrementCodeUses,
  createInviteCode,
  getCodesByCreator,
  deleteInviteCode,
} from './db.js';
import {
  createJob,
  completeJob,
  getJob,
  updateJobStatus,
  pruneOldJobs,
} from './jobs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── PC relay state ────────────────────────────────────────────────────────────
let pcSocket = null;
let pcPublicKeyB64 = null;

function sendJson(ws, obj) {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

/** POST /auth/google — exchange a Google ID token (+ optional invite code) for a JWT */
app.post('/auth/google', async (req, res) => {
  const { idToken, inviteCode } = req.body ?? {};
  if (typeof idToken !== 'string') {
    return res.status(400).json({ error: 'idToken required' });
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const existing = findUserByGoogleSub(googleUser.sub);

  // ── Existing user ─────────────────────────────────────────────────────────
  if (existing) {
    if (existing.status === 'suspended') {
      return res.status(403).json({ error: 'suspended' });
    }
    if (existing.status === 'pending') {
      return res.status(200).json({ status: 'pending_approval', isNew: false });
    }
    // active
    const token = signJwt({
      userId: existing.id,
      googleSub: existing.google_sub,
      status: existing.status,
      isAdmin: !!existing.is_admin,
    });
    return res.json({
      token,
      user: { name: existing.name, email: existing.email, status: existing.status, isAdmin: !!existing.is_admin },
    });
  }

  // ── New user with invite code ─────────────────────────────────────────────
  if (inviteCode) {
    const code = validateInviteCode(inviteCode, 'registration');
    if (!code) {
      return res.status(400).json({ error: 'Invalid or expired invite code' });
    }
    const user = createUser({
      googleSub: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
      status: 'active',
    });
    decrementCodeUses(code.id);
    const token = signJwt({
      userId: user.id,
      googleSub: user.google_sub,
      status: user.status,
      isAdmin: !!user.is_admin,
    });
    return res.json({
      token,
      user: { name: user.name, email: user.email, status: user.status, isAdmin: !!user.is_admin },
    });
  }

  // ── New user without invite code → pending ────────────────────────────────
  createUser({
    googleSub: googleUser.sub,
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture,
    status: 'pending',
  });
  return res.status(200).json({ status: 'pending_approval', isNew: true });
});

/** GET /auth/me — return current user info from DB */
app.get('/auth/me', (req, res) => {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const user = getUserById(payload.userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({
    name: user.name,
    email: user.email,
    status: user.status,
    isAdmin: !!user.is_admin,
  });
});

/**
 * GET /pc-pubkey — serve the PC's cached public key so the phone can encrypt.
 * Requires an active session.
 */
app.get('/pc-pubkey', requireActive, (req, res) => {
  if (!pcPublicKeyB64) {
    return res.status(503).json({ error: 'PC not connected' });
  }
  res.json({ publicKey: pcPublicKeyB64 });
});

/** GET /health — simple liveness check */
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Invite code management (admin only) ───────────────────────────────────────

/** POST /codes — generate a new invite code */
app.post('/codes', requireAdmin, (req, res) => {
  const { type = 'registration', usesRemaining = 1, expiresInHours = null } = req.body ?? {};
  if (!['registration', 'job_access'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  // Generate KLEIN-XXXX-XXXX format
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  const bytes = randomBytes(8);
  let code = 'KLEIN-';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }

  const expiresAt = expiresInHours ? Date.now() + expiresInHours * 3600_000 : null;

  createInviteCode({
    code,
    type,
    createdBy: req.user.userId,
    usesRemaining: usesRemaining ?? null,
    expiresAt,
  });

  res.json({ code, type, usesRemaining, expiresAt });
});

/** GET /codes — list codes created by this admin */
app.get('/codes', requireAdmin, (req, res) => {
  const codes = getCodesByCreator(req.user.userId);
  res.json(codes.map(c => ({
    id: c.id,
    code: c.code,
    type: c.type,
    usesRemaining: c.uses_remaining,
    expiresAt: c.expires_at,
    createdAt: c.created_at,
  })));
});

/** DELETE /codes/:id — revoke a code */
app.delete('/codes/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = deleteInviteCode(id, req.user.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Serve the built Svelte client in production (local dev only — Caddy serves it on VPS).
  const clientDist = process.env.CLIENT_DIST_PATH || join(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = createServer(app);

// ── WebSocket servers (noServer mode, we route upgrades manually) ─────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/ws/pc') {
    wss.handleUpgrade(req, socket, head, (ws) => handlePcSocket(ws));
    return;
  }

  if (url.pathname === '/ws/phone') {
    const token = url.searchParams.get('token');
    const payload = verifyJwt(token);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const user = getUserById(payload.userId);
    if (!user || user.status !== 'active') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handlePhoneSocket(ws));
    return;
  }

  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

// ── PC socket handler ─────────────────────────────────────────────────────────
async function handlePcSocket(ws) {
  console.log('[pc] Connecting — waiting for auth handshake...');

  const authTimeout = setTimeout(() => {
    console.warn('[pc] Auth timed out.');
    ws.close(4001, 'Auth timeout');
  }, 10_000);

  ws.once('message', async (raw) => {
    clearTimeout(authTimeout);
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close(4002, 'Invalid auth message');
      return;
    }

    if (msg.type !== 'auth' || typeof msg.secret !== 'string') {
      ws.close(4002, 'Expected auth message');
      return;
    }

    const ok = verifyPcSecret(msg.secret);
    if (!ok) {
      console.warn('[pc] Wrong secret.');
      ws.close(4003, 'Invalid secret');
      return;
    }

    console.log('[pc] Authenticated.');
    sendJson(ws, { type: 'auth_ok' });

    if (pcSocket && pcSocket.readyState === 1) {
      console.log('[pc] Replacing previous PC socket.');
      pcSocket.close(1000, 'Replaced by new connection');
    }
    pcSocket = ws;

    ws.on('message', handlePcMessage);
    ws.on('close', () => {
      console.log('[pc] Disconnected.');
      if (pcSocket === ws) pcSocket = null;
    });
  });
}

function handlePcMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    console.warn('[pc] Invalid JSON, ignoring.');
    return;
  }

  if (msg.type === 'pubkey') {
    pcPublicKeyB64 = msg.publicKey;
    console.log('[pc] Public key cached.');
    return;
  }

  if (msg.type === 'progress') {
    const job = getJob(msg.jobId);
    if (job?.phoneWs?.readyState === 1) {
      sendJson(job.phoneWs, {
        type: 'progress',
        jobId: msg.jobId,
        value: msg.value,
        max: msg.max,
        node: msg.node ?? null,
      });
    }
    return;
  }

  if (msg.type === 'result') {
    const job = getJob(msg.jobId);
    if (!job) {
      console.warn(`[pc] Result for unknown job ${msg.jobId}`);
      return;
    }
    if (job.status === 'cancelled') {
      console.log(`[pc] Ignoring result for cancelled job ${msg.jobId}`);
      return;
    }
    completeJob(msg.jobId, msg.payload);
    if (job.phoneWs?.readyState === 1) {
      sendJson(job.phoneWs, { type: 'result', jobId: msg.jobId, payload: msg.payload });
    }
    console.log(`[pc] Job ${msg.jobId} completed.`);
    return;
  }

  if (msg.type === 'error') {
    const job = getJob(msg.jobId);
    if (job?.phoneWs?.readyState === 1) {
      sendJson(job.phoneWs, { type: 'error', jobId: msg.jobId, message: msg.message });
    }
    console.warn(`[pc] Error for job ${msg.jobId}: ${msg.message}`);
    return;
  }

  console.warn(`[pc] Unhandled message type: ${msg.type}`);
}

// ── Phone socket handler ──────────────────────────────────────────────────────
function handlePhoneSocket(ws) {
  console.log('[phone] Connected.');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendJson(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (msg.type === 'submit') {
      handleJobSubmit(ws, msg);
    } else if (msg.type === 'cancel') {
      if (msg.jobId) {
        updateJobStatus(msg.jobId, 'cancelled');
      }
      if (pcSocket && pcSocket.readyState === 1) {
        sendJson(pcSocket, { type: 'cancel', jobId: msg.jobId });
      }
    } else {
      sendJson(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => console.log('[phone] Disconnected.'));
}

function handleJobSubmit(phoneWs, msg) {
  if (!pcSocket || pcSocket.readyState !== 1) {
    sendJson(phoneWs, { type: 'no_pc' });
    return;
  }

  if (typeof msg.payload !== 'string') {
    sendJson(phoneWs, { type: 'error', message: 'Missing payload' });
    return;
  }

  const jobId = uuidv4();
  createJob(jobId, phoneWs);
  sendJson(phoneWs, { type: 'queued', jobId });
  sendJson(pcSocket, { type: 'job', jobId, payload: msg.payload });
  updateJobStatus(jobId, 'processing');
  console.log(`[relay] Job ${jobId} dispatched.`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
initAuth();

// Prune stale jobs every 10 minutes
setInterval(() => pruneOldJobs(30 * 60 * 1000), 10 * 60 * 1000);

const PORT = parseInt(process.env.PORT ?? '3000', 10);
server.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});
