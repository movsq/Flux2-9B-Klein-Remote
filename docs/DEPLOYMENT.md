# VPS Deployment

[← Back to README](../README.md)

The relay server routes encrypted jobs between your phone and PC. The VPS never sees plaintext. These steps assume you've already completed the [Quick Start](../README.md#quick-start) on your local machine.

---

## One-time VPS setup

SSH into your VPS and run:

```bash
# Install Docker and Docker Compose
apt update && apt install -y docker.io docker-compose-v2

# Create the deployment directory
mkdir -p /root/flux2-9b-klein-remote

# Create the VPS .env
cat > /root/flux2-9b-klein-remote/.env << 'EOF'
PC_SECRET=your-strong-random-secret-here
JWT_SECRET=another-strong-random-secret-here
GOOGLE_CLIENT_ID=your-google-oauth-client-id
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
FLUX_KLEIN_HOST=your-hostname.example.com
ALLOWED_ORIGINS=https://your-hostname.example.com
EOF
```

---

## Automated deploy via GitHub Actions (recommended)

Push to `main` → GitHub Actions builds the Svelte frontend, uploads everything to your VPS, and restarts Docker.

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

Watch progress in your repo's **Actions** tab.

---

## Manual deploy (no GitHub Actions)

```powershell
# From project root
cd client; npm run build; cd ..
scp -r ./client/dist/* user@your-vps:/root/flux2-9b-klein-remote/client/dist/
scp ./server/package.json user@your-vps:/root/flux2-9b-klein-remote/server/
scp -r ./server/src user@your-vps:/root/flux2-9b-klein-remote/server/
scp ./docker-compose.yml ./Caddyfile user@your-vps:/root/flux2-9b-klein-remote/
ssh user@your-vps "cd /root/flux2-9b-klein-remote && docker compose up -d --build --force-recreate"
```

---

## Tailscale (optional — private networking)

1. Install Tailscale on VPS: `curl -fsSL https://tailscale.com/install.sh | sh && tailscale up --ssh`
2. Enable **MagicDNS** + **HTTPS Certificates** in the [Tailscale admin console](https://login.tailscale.com/admin/dns)
3. Set `FLUX_KLEIN_HOST=your-machine.tailXXXXX.ts.net` in your VPS `.env`
4. Uncomment `tls internal` in `Caddyfile`
5. Set `SKIP_TLS_VERIFY=true` in your local `.env` (so pc-client accepts the Tailscale cert)

---

## Cloudflare proxy (optional — orange cloud ☁)

If your DNS record points to the VPS through Cloudflare's proxy (the orange cloud in the Cloudflare dashboard), Caddy will only see Cloudflare's edge node IP, not the real visitor IP. This breaks IP-based rate-limiting and the audit log, and causes OAuth redirects to misbehave if Cloudflare strips the `X-Forwarded-Proto` header.

**When to do this:** your `FLUX_KLEIN_HOST` domain has the Cloudflare proxy enabled (orange cloud). Not needed for grey-cloud (DNS-only), Tailscale, or direct-IP deployments.

**Steps:**

1. Open `Caddyfile` and uncomment the global options block near the top:
   ```caddyfile
   {
       servers {
           trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/20 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22
       }
   }
   ```
   This tells Caddy to trust the IP ranges Cloudflare uses for its edge nodes, so it correctly extracts the real visitor IP from `CF-Connecting-IP` / `X-Forwarded-For`.

2. The `header_up X-Forwarded-Proto https` directive already present in `handle @backend_routes` ensures the Node.js relay always sees the correct protocol for OAuth redirect validation — no additional changes needed there.

3. Redeploy: `docker compose up -d --force-recreate`

> **Keep the IP list current.** Cloudflare occasionally expands its ranges. Check [cloudflare.com/ips](https://www.cloudflare.com/ips/) and update the `trusted_proxies` line if you add ranges in future.
