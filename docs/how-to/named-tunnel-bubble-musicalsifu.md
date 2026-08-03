# Named tunnel Bubble — fixed URL on musicalsifu.com

Give Bubble / Resident Spy a **stable** HTTPS base URL:

`https://bubble.musicalsifu.com`

instead of a new `*.trycloudflare.com` hostname on every `cloudflared` restart.

## Why not DynDNS?

Phone data / CGNAT usually cannot accept inbound connections. You need an
**outbound** Cloudflare Tunnel with a hostname you control. DynDNS pointing
at a changing mobile IP does not help Bubble.

## Architecture

```
Bubble APK  →  https://bubble.musicalsifu.com  →  Cloudflare edge
                 →  named tunnel (this Mac)  →  127.0.0.1:8765 (bridge)
www / apex  →  Vercel (unchanged once DNS records are copied)
```

## One-time DNS migration (operator)

`musicalsifu.com` must be a **Cloudflare** zone (Free is enough). GoDaddy
nameservers (`domaincontrol.com`) cannot host the tunnel route.

### Captured before migration (2026-08-02)

Recreate these (or Vercel’s current recommended equivalents) in Cloudflare DNS
**before** or immediately after switching NS, so the marketing site keeps
working:

| Name | Type | Target / value (as observed) |
|------|------|------------------------------|
| `@` (apex) | A | `216.198.79.193` |
| `@` (apex) | A | `216.198.79.1` |
| `@` (apex) | AAAA | `64.29.17.1` |
| `www` | CNAME | `0967ae138fd81f45.vercel-dns-017.com.` |

Prefer Vercel’s dashboard → Domains → DNS instructions if they differ when
you migrate. Proxy status (orange cloud) for Vercel records: follow Vercel’s
Cloudflare guide (often DNS-only / grey cloud for apex compatibility).

### Steps

1. Cloudflare dashboard → **Add site** → `musicalsifu.com` → Free plan.
2. Note the two Cloudflare nameservers Cloudflare shows.
3. GoDaddy → domain → **Nameservers** → replace `ns15`/`ns16.domaincontrol.com`
   with Cloudflare’s NS.
4. Cloudflare DNS → recreate the Vercel records above.
5. Wait until:

```bash
dig +short NS musicalsifu.com
# must mention cloudflare.com
```

## One-time tunnel create

Check DNS readiness anytime:

```bash
bash swarmforge/scripts/check_bubble_named_tunnel_dns.sh
```

On the swarm Mac (browser login required once), **after** NS are on Cloudflare:

```bash
bash swarmforge/scripts/setup_bubble_named_tunnel.sh /path/to/swarmforgevc
```

If you want to create the tunnel + local config **before** the NS cutover
(route DNS later):

```bash
bash swarmforge/scripts/setup_bubble_named_tunnel.sh /path/to/swarmforgevc --allow-pending-dns
# after dig NS shows cloudflare:
bash swarmforge/scripts/setup_bubble_named_tunnel.sh /path/to/swarmforgevc
```

That script:

1. Refuses to proceed until NS are Cloudflare-backed (unless `--allow-pending-dns`)
2. Runs `cloudflared tunnel login` if `~/.cloudflared/cert.pem` is missing
3. Creates tunnel `swarmforge-bubble` (or `$SWARMFORGE_NAMED_TUNNEL`)
4. Routes DNS `bubble.musicalsifu.com` → the tunnel (skipped while DNS pending)
5. Writes `~/.cloudflared/config.yml` (ingress → `http://127.0.0.1:8765`)
6. Writes `.swarmforge/operator/named-tunnel.env` (gitignored)

Do **not** commit `~/.cloudflared/*.json`, `cert.pem`, or `named-tunnel.env`.

Example env shape (also in
[`swarmforge/config/named-tunnel.env.example`](../../swarmforge/config/named-tunnel.env.example)):

```bash
SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble
SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.musicalsifu.com
SWARMFORGE_CLOUDFLARED_CONFIG=/Users/YOU/.cloudflared/config.yml
```

## Launch (ongoing)

[`launch_resident_spy_tunnel.sh`](../../swarmforge/scripts/launch_resident_spy_tunnel.sh)
reads `named-tunnel.env` when present and runs:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run swarmforge-bubble
```

It persists a **fixed** URL in `.swarmforge/operator/resident-spy-tunnel.json`
and still notifies the Resident Spy Telegram topic when URL/token change.

Without `SWARMFORGE_NAMED_TUNNEL` / `named-tunnel.env`, behaviour stays the
legacy quick tunnel (`*.trycloudflare.com`).

Switching from an already-running quick tunnel:

```bash
# stop ancillary (or kill the pid in .swarmforge/operator/resident-spy-cloudflared.pid)
bash swarmforge/scripts/launch_resident_spy_tunnel.sh "$(pwd)"
# → https://bubble.musicalsifu.com
```

Mini App link:

```bash
echo "https://bubble.musicalsifu.com/resident-spy?token=$(cat .swarmforge/operator/bridge-token)"
```

## Verify

```bash
dig +short CNAME bubble.musicalsifu.com
# → <tunnel-uuid>.cfargotunnel.com

curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://bubble.musicalsifu.com/" 
# bridge may 401 without token — connection success matters

# Restart cloudflared / reboot Mac → same hostname
```

## Keep the Mac awake (tunnels overnight)

Two different layers — do not confuse them:

| Goal | What works | What does not |
|------|------------|---------------|
| Screen open, avoid idle / auto-sleep | `caffeinate -dims` (started by the tunnel launcher) | `caffeinate -u` alone (UserIsActive lasts ~5s without `-t`) |
| Lid closed (clamshell) | `sudo pmset -c disablesleep 1` (AC power, manual) | `caffeinate` — lid close still sleeps |

### Idle / display (automatic with the tunnel)

[`launch_resident_spy_tunnel.sh`](../../swarmforge/scripts/launch_resident_spy_tunnel.sh)
starts a detached `caffeinate -dims` (same `nohup` + pidfile pattern as
`cloudflared`) so idle/auto-sleep with the **lid open** does not kill the
tunnel. Pidfile: `.swarmforge/operator/resident-spy-caffeinate.pid`. Stopped by
`stop_ancillary_services.sh`.

```bash
# after launch:
pmset -g assertions | rg 'PreventUserIdleSystemSleep|caffeinate'
# expect PreventUserIdleSystemSleep 1 owned by caffeinate

# opt out (e.g. tests): SWARMFORGE_SKIP_CAFFEINATE=1
```

Do not use bare `caffeinate -dims` in a foreground shell — Ctrl-C or closing
that terminal drops the assertion silently. The launcher’s pidfile path is the
supported one.

### Lid closed (manual pmset — not automated)

Needs root and is intentionally **not** wired into the tunnel daemon:

```bash
sudo pmset -c disablesleep 1
# restore when finished babysitting:
# sudo pmset -c disablesleep 0
```

Without this, closing the lid sleeps the Mac even with `caffeinate` running,
and `cloudflared` / the bridge go dark with it.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `setup_…` exit 2, NS not Cloudflare | Finish GoDaddy → Cloudflare NS cutover |
| `cert.pem` missing | `cloudflared tunnel login` |
| Named mode dies immediately | `~/.cloudflared/config.yml`, credentials JSON, `tunnel list` |
| Site down after NS change | Vercel records missing/wrong in Cloudflare DNS |
| Bubble still on trycloudflare URL | `named-tunnel.env` missing; kill old quick-tunnel pid and relaunch |
| Tunnel dies with lid closed | `caffeinate` is not enough — run `sudo pmset -c disablesleep 1` |
| Idle sleep kills tunnel (lid open) | pidfile missing / `SWARMFORGE_SKIP_CAFFEINATE=1`; relaunch tunnel |
