# Deploying DocuStruct (closed beta)

This guide gets you from a fresh `theproapps.com` setup to a working
`https://docustruct.theproapps.com/` that your testers can reach over HTTPS,
gated by HTTP basic auth, in ~30 minutes for ~$6/month.

## Architecture in production

```
   Browser (tester)
         │  HTTPS
         ▼
   ┌──────────────┐   HTTP basic auth gate
   │    nginx     │   TLS (Let's Encrypt, free)
   │   port 443   │
   └─────┬────────┘
         │  proxy_pass http://127.0.0.1:4000
         ▼
   ┌──────────────┐
   │  Node 20     │   Express + SQLite
   │   port 4000  │   Serves both /api/* AND the built React client
   └─────┬────────┘
         │ disk
         ▼
   /opt/docustruct/server/data/
        ├─ docustruct.sqlite
        └─ uploads/*.pdf
```

Same Node process serves the API and the static React build, so we only need
**one** upstream behind nginx — simple, fast, easy to monitor.

## What you need before you start

- A domain. You have `theproapps.com`. We'll deploy at the subdomain
  `docustruct.theproapps.com` so your main site is unaffected.
- A VPS. Recommended: **DigitalOcean basic droplet $6/mo** or
  **Hetzner CX11 ~€4/mo**. Pick **Ubuntu 22.04 LTS or 24.04 LTS**, 1 GB RAM
  is plenty for a handful of testers.
- A way to reach the server (SSH key uploaded at provider, or root password).
- The DocuStruct repo pushed to a git host (GitHub, GitLab, Bitbucket — any
  works). If you'd rather avoid git, you can `scp` the folder up instead.

## 1. Provision the VPS

Spin up the droplet, note its public IPv4 (e.g. `203.0.113.42`).

SSH in:
```
ssh root@203.0.113.42
```

## 2. Point the subdomain at the server

In your domain registrar's DNS settings for `theproapps.com`, add:

| Type | Host       | Value             | TTL  |
|------|------------|-------------------|------|
| A    | docustruct | `203.0.113.42`    | 300  |

Wait 1–2 minutes, then on your laptop confirm:
```
ping docustruct.theproapps.com
```
Should resolve to your VPS IP.

## 3. Run the setup script

The repo ships a one-shot setup script at `deploy/setup.sh`. On the server:

```bash
# Clone the repo somewhere temporary, OR upload it via scp.
git clone https://github.com/<you>/docustruct /tmp/docustruct
cd /tmp/docustruct
sudo bash deploy/setup.sh https://github.com/<you>/docustruct
```

This script:
- installs Node 20, nginx, certbot deps, build tools
- creates a `docustruct` system user
- clones the repo to `/opt/docustruct`
- installs server + client deps and builds the client
- generates a random `DOCUSTRUCT_ENC_KEY` in `/opt/docustruct/.env`
- installs the systemd service and starts it
- installs the nginx site (HTTP for now — TLS comes next)

Verify the service is up:
```bash
systemctl status docustruct
curl http://127.0.0.1:4000/api/health
```
Expect `{"ok":true,"service":"docustruct",...}`.

## 4. Add HTTP basic auth (the closed-beta gate)

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-docustruct alice    # creates the file
sudo htpasswd    /etc/nginx/.htpasswd-docustruct bob      # adds another user
sudo htpasswd    /etc/nginx/.htpasswd-docustruct charlie  # ...
sudo systemctl reload nginx
```

Each tester gets one of those username/password pairs. They'll see a browser
auth prompt the first time. The `/api/health` endpoint stays open for uptime
monitoring.

When you want to revoke a user:
```bash
sudo htpasswd -D /etc/nginx/.htpasswd-docustruct alice
sudo systemctl reload nginx
```

## 5. Provision HTTPS via Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d docustruct.theproapps.com
```

Answer the prompts (your email, accept the ToS). Certbot edits the nginx
site to add the cert paths and rewrites the port-80 block to redirect to
HTTPS. Renewal is fully automated via systemd timer; you don't need to
touch anything for ~3 months.

Open `https://docustruct.theproapps.com/` in a browser. You should see the
basic-auth prompt; after logging in, the DocuStruct dashboard loads.

## 6. Open it up to your testers

Send them:
- The URL: `https://docustruct.theproapps.com/`
- Their personal username + password
- A short doc on what to test (Templates → Training → Import → Data Grid)

That's it. You're live.

## Day-2 operations

```bash
# Logs (live tail)
sudo journalctl -u docustruct -f

# Restart the app (safe, picks up code changes after a git pull)
sudo systemctl restart docustruct

# Pull new code and rebuild
cd /opt/docustruct
sudo -u docustruct git pull
sudo -u docustruct bash -lc "cd server && npm install --omit=dev"
sudo -u docustruct bash -lc "cd client && npm install && npm run build"
sudo systemctl restart docustruct

# Check disk usage (SQLite + uploaded PDFs)
sudo du -sh /opt/docustruct/server/data/*

# Backup the SQLite + uploads (do this on a cron)
tar czf /tmp/docustruct-$(date +%F).tar.gz \
    /opt/docustruct/server/data/docustruct.sqlite \
    /opt/docustruct/server/data/uploads
```

## Common issues

- **502 Bad Gateway** — Node process is down. `systemctl status docustruct`
  + `journalctl -u docustruct -n 100` shows the error. Most likely cause:
  missing `DOCUSTRUCT_ENC_KEY` in `.env` or a port conflict.
- **413 Request Entity Too Large** when uploading PDFs — bump
  `client_max_body_size` in `deploy/nginx.conf` (default we ship is 30M)
  and `sudo nginx -s reload`.
- **Mixed content / CORS** issues — shouldn't happen since server + client
  are same-origin in production. If you see CORS errors, you've probably
  hit the API at a different host than the page.

## When you're ready for real users

This setup is fine for a closed beta of a few people you know. Before
opening to the public, plan for:

- **Real auth** — replace HTTP basic auth with sessions / JWT and proper
  user accounts. Tracked as Track 3 in `ROADMAP.md`.
- **Multi-tenancy** — `organization_id` on every domain table. The data
  model already pretends multi-tenancy exists; flipping it on is mechanical.
- **Postgres** — SQLite is wonderful up to one concurrent writer. When you
  start onboarding tenants in parallel, switch to Postgres.
- **Object storage** — uploads currently live on the local disk. Move to
  S3-compatible storage when traffic grows.
- **Backups + monitoring** — at minimum, a nightly tarball off-server and
  an uptime check hitting `/api/health`.

These are explicitly the next phases on the roadmap; nothing in the current
data model has to change to support them.
