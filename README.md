# Flux2-9B-Klein-Remote

E2E-encrypted remote ComfyUI relay for **Flux 2 Klein 9B GGUF** — the first Flux 2 model
that runs well on consumer GPUs. Send jobs from your phone → VPS relay → your PC running
ComfyUI. The relay server only ever sees opaque encrypted blobs; no prompts, images, or
results are visible to it.

```
[Phone browser] ──── WSS encrypted ────▶ [VPS relay] ──── WSS encrypted ────▶ [PC + ComfyUI]
```

---

## Prerequisites

| Component | Requirement |
|-----------|-------------|
| **PC** | NVIDIA GPU with ≥ 12 GB VRAM, [ComfyUI](https://github.com/comfyanonymous/ComfyUI) installed |
| **VPS** | Any Linux VPS with Docker + Docker Compose (or a Tailscale-connected machine) |
| **Phone** | Any modern browser (no app install needed) |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/Flux2-9B-Klein-Remote.git
cd Flux2-9B-Klein-Remote
```

### 2. Copy and edit the config

```bash
cp .env.example .env
# Edit .env — at minimum set PIN to a strong random string
```

The single root `.env` is the source of truth for all three components: server,
client (Vite reads it for the dev proxy), and pc-client (auto-loaded via python-dotenv).

### 3. Generate the PC keypair (first time only)

```bash
cd pc-client
pip install -r requirements.txt
python keygen.py
```

This creates `private_key.pem` and `public_key.pem` inside `pc-client/`.
**Back up `private_key.pem`** — losing it means the phone can no longer decrypt job results.

### 4. Install ComfyUI models and custom nodes

The pc-client submits workflows directly to ComfyUI's API — you don't need to
load anything into ComfyUI's UI. But you **do** need the required models and
custom node packs installed.

See [ComfyUI-Workflow/README.md](ComfyUI-Workflow/README.md) for:

- Required model files and where to download them
- Required custom node packs (installable via ComfyUI Manager)

> **Optional:** Load `ComfyUI-Workflow/Flux2_Klein_9B_GGUF_ONLINE.json` into
> ComfyUI's visual editor (drag and drop onto the canvas) to inspect or tweak
> the node graph. This is for reference only — the pc-client uses the separate
> API-format template at `pc-client/workflow_template.json`.

> **Port note:** the pc-client connects to ComfyUI at the URL set by `COMFYUI_URL` in your
> `.env` (default `http://127.0.0.1:8188`). Make sure this port matches the one configured
> in ComfyUI under **Settings → Server-Config → Port**.

### 5. Start everything

```bash
# Terminal 1 — relay server
cd server && npm install && npm run dev

# Terminal 2 — Svelte client  (Vite proxies /auth, /ws/*, /pc-pubkey to localhost:3000)
cd client && npm install && npm run dev

# Terminal 3 — PC Python bridge
cd pc-client && python main.py
```

Open the URL Vite prints (e.g. `http://localhost:5173`) in your browser, enter your PIN,
and start generating.

---

## How It Works

### Workflow architecture

The ComfyUI workflow exists in two formats:

| File | Format | Purpose |
|------|--------|---------|
| `ComfyUI-Workflow/Flux2_Klein_9B_GGUF_ONLINE.json` | ComfyUI graph format | Visual reference for the ComfyUI editor (nodes, links, positions, UI metadata) |
| `pc-client/workflow_template.json` | ComfyUI API format | Template submitted to ComfyUI's `/prompt` endpoint at runtime |

At runtime, the pc-client:
1. Loads `workflow_template.json` once at startup
2. Deep-copies it per job, injecting the job parameters (prompt, seed, steps, sampler)
3. Uploads images to ComfyUI via `POST /upload/image` and patches their filenames into the `LoadImage` nodes
4. Prunes unused nodes based on image count (0, 1, or 2 images)
5. POSTs the assembled workflow to ComfyUI's `/prompt` API
6. Monitors progress via ComfyUI's WebSocket, then downloads the output image from `/history`

See [ComfyUI-Workflow/README.md](ComfyUI-Workflow/README.md) for the full node map and
customisation instructions.

---

## VPS Relay Setup

The relay server routes encrypted jobs between your phone and PC. The VPS never sees
plaintext.

### One-time VPS setup

SSH into your VPS and run:

```bash
# Install Docker and Docker Compose
apt update && apt install -y docker.io docker-compose-v2

# Create the deployment directory
mkdir -p /root/flux2-9b-klein-remote

# Create the VPS .env
cat > /root/flux2-9b-klein-remote/.env << 'EOF'
PIN=your-strong-random-pin-here
FLUX_KLEIN_HOST=your-hostname.example.com
EOF
```

### Automated deploy via GitHub Actions (recommended)

Push to `main` → GitHub Actions builds the Svelte frontend, uploads everything to your
VPS, and restarts Docker.

**Add these 4 secrets to your repo** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `VPS_HOST` | SSH-reachable address of your VPS (IP or hostname) |
| `VPS_USER` | SSH username (e.g. `root`) |
| `SSH_PRIVATE_KEY` | Private SSH key authorised to log in to the VPS |
| `VPS_PATH` | Deployment directory on the VPS (e.g. `/root/flux2-9b-klein-remote`) |

Then push:

```bash
git push origin main
```

GitHub Actions will build the Svelte frontend, SCP all files to the VPS, and restart Docker.
Watch progress in your repo's **Actions** tab.

### Manual deploy (no GitHub Actions)

```powershell
# From project root
cd client; npm run build; cd ..
scp -r ./client/dist/* user@your-vps:/root/flux2-9b-klein-remote/client/dist/
scp ./server/package.json user@your-vps:/root/flux2-9b-klein-remote/server/
scp -r ./server/src user@your-vps:/root/flux2-9b-klein-remote/server/
scp ./docker-compose.yml ./Caddyfile user@your-vps:/root/flux2-9b-klein-remote/
ssh user@your-vps "cd /root/flux2-9b-klein-remote && docker compose up -d --build --force-recreate"
```

### Tailscale (optional — private networking)

1. Install Tailscale on VPS: `curl -fsSL https://tailscale.com/install.sh | sh && tailscale up --ssh`
2. Enable **MagicDNS** + **HTTPS Certificates** in the [Tailscale admin console](https://login.tailscale.com/admin/dns)
3. Set `FLUX_KLEIN_HOST=your-machine.tailXXXXX.ts.net` in your VPS `.env`
4. Uncomment `tls internal` in `Caddyfile`
5. Set `SKIP_TLS_VERIFY=true` in your local `.env` (so pc-client accepts the Tailscale cert)

---

## Environment Variables

All configuration lives in the single root `.env`. Copy `.env.example` to `.env` to get started.

| Variable | Default | Description |
|----------|---------|-------------|
| `PIN` | *(required)* | Shared secret used to authenticate the phone and PC to the relay |
| `DEPLOY_MODE` | `local` | `local` (connect to localhost) or `remote` (connect to `FLUX_KLEIN_HOST`) |
| `FLUX_KLEIN_HOST` | — | Hostname of the VPS serving the app (e.g. `flux2-klein.example.com`) |
| `PORT` | `3000` | Port the Node.js relay listens on |
| `SESSION_TTL_MS` | `86400000` | Phone session lifetime in ms (default: 24 h) |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | URL of the local ComfyUI instance — port must match **Settings → Server-Config → Port** in ComfyUI |
| `SKIP_TLS_VERIFY` | `false` | Skip TLS verification (use only for Tailscale / self-signed certs) |
| `PRIVATE_KEY_PATH` | `private_key.pem` | Path to the PC's private key (relative to `pc-client/`) |
| `PUBLIC_KEY_PATH` | `public_key.pem` | Path to the PC's public key |
| `RECONNECT_DELAY` | `5` | Seconds between reconnect attempts (pc-client) |
| `VPS_USER` | `root` | SSH username for manual deployments |
| `VPS_SSH_HOST` | — | SSH address of the VPS for manual deployments |
| `VPS_PATH` | `/root/flux2-9b-klein-remote` | Deployment path for manual deployments |

---

## Security / Crypto

The relay is a **blind relay** — it cannot read job payloads or results.

| Layer | Algorithm |
|-------|-----------|
| Key exchange | ECDH P-256 |
| Key derivation | HKDF-SHA-256 (`info = "flux2-klein-v1"`) |
| Symmetric encryption | AES-256-GCM |

**Per-job forward secrecy:** The phone generates a fresh ephemeral keypair for every job.
Even if a past session key were compromised, old jobs remain protected.

---

## WebSocket Protocol

All messages are JSON. The `payload` field is a base64 binary blob the server never
decrypts.

| Direction | Message |
|-----------|---------|
| PC → Server | `{ type: "auth", pin: "..." }` — first message |
| Server → PC | `{ type: "auth_ok" }` |
| PC → Server | `{ type: "pubkey", publicKey: "<b64 SPKI>" }` — once after auth |
| Phone → Server | `{ type: "submit", payload: "<b64>" }` |
| Server → Phone | `{ type: "queued", jobId: "..." }` |
| Server → Phone | `{ type: "no_pc" }` — PC not connected |
| Server → PC | `{ type: "job", jobId: "...", payload: "<b64>" }` |
| PC → Server | `{ type: "progress", jobId: "...", value: N, max: M }` |
| Server → Phone | `{ type: "progress", jobId: "...", value: N, max: M }` |
| PC → Server | `{ type: "result", jobId: "...", payload: "<b64>" }` |
| Server → Phone | `{ type: "result", jobId: "...", payload: "<b64>" }` |
| PC → Server | `{ type: "error", jobId: "...", message: "..." }` |
| Server → Phone | `{ type: "error", jobId: "...", message: "..." }` |
| Phone → Server | `{ type: "cancel", jobId: "..." }` |
| Server → PC | `{ type: "cancel", jobId: "..." }` |

---

## Repo Structure

```
Flux2-9B-Klein-Remote/
├── .env.example                 ← copy to .env and fill in values
├── .github/
│   └── workflows/
│       └── deploy.yml           ← GitHub Actions: auto-deploy on push to main
├── ComfyUI-Workflow/
│   ├── Flux2_Klein_9B_GGUF_ONLINE.json   ← visual workflow (for ComfyUI editor)
│   └── README.md                ← required models, custom nodes, node map
├── Caddyfile                    ← reverse proxy / TLS config
├── docker-compose.yml           ← VPS orchestration (server + Caddy)
├── client/                      ← Svelte frontend (phone-facing)
├── server/                      ← Node.js/Express relay + WebSocket broker
└── pc-client/
    ├── main.py                  ← WebSocket client — connects to relay
    ├── comfyui.py               ← builds workflow, submits to ComfyUI API
    ├── workflow_template.json   ← API-format workflow template (submitted to ComfyUI)
    ├── crypto_utils.py          ← ECDH / AES-GCM decrypt/encrypt
    ├── keygen.py                ← generates keypair (run once)
    ├── config.py                ← reads .env, exports settings
    └── requirements.txt
```

---

## License

MIT — see [LICENSE](LICENSE).
