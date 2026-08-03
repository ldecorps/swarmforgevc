#!/usr/bin/env bash
# One-shot operator setup: Cloudflare named tunnel for Bubble / Resident Spy
# (hostname → 127.0.0.1:BRIDGE_PORT). No operator-specific hostname/zone
# default ships in this tracked script (BL-787) — set
# SWARMFORGE_NAMED_TUNNEL_HOSTNAME and SWARMFORGE_NAMED_TUNNEL_ZONE (see
# swarmforge/config/named-tunnel.env.example and
# docs/how-to/named-tunnel-bubble-musicalsifu.md), or the script fails loud.
#
# Prerequisites (see docs/how-to/named-tunnel-bubble-musicalsifu.md):
#   1. Your zone added to Cloudflare Free; registrar NS switched to Cloudflare
#   2. Existing apex/www DNS records recreated in Cloudflare DNS
#   3. Interactive browser available for `cloudflared tunnel login`
#
# Usage: setup_bubble_named_tunnel.sh [project-root] [--allow-pending-dns]
set -euo pipefail

ROOT="."
ALLOW_PENDING_DNS=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat <<EOF
Usage: setup_bubble_named_tunnel.sh [project-root] [--allow-pending-dns]

Creates Cloudflare named tunnel '\${SWARMFORGE_NAMED_TUNNEL:-swarmforge-bubble}',
routes DNS \$SWARMFORGE_NAMED_TUNNEL_HOSTNAME → that tunnel (unless DNS not yet
on Cloudflare), writes ~/.cloudflared/config.yml and
.swarmforge/operator/named-tunnel.env.

Requires (no defaults — see swarmforge/config/named-tunnel.env.example):
  SWARMFORGE_NAMED_TUNNEL_HOSTNAME  e.g. bubble.yourdomain.com
  SWARMFORGE_NAMED_TUNNEL_ZONE      e.g. yourdomain.com

  --allow-pending-dns   create tunnel + local config before NS cutover;
                        re-run without the flag once dig NS shows cloudflare
EOF
      exit 0
      ;;
    --allow-pending-dns) ALLOW_PENDING_DNS=1 ;;
    *) ROOT="$arg" ;;
  esac
done

ROOT="$(cd "$ROOT" && pwd)"
OP="$ROOT/.swarmforge/operator"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
PORT="${BRIDGE_PORT:-8765}"
TUNNEL_NAME="${SWARMFORGE_NAMED_TUNNEL:-swarmforge-bubble}"
HOSTNAME="${SWARMFORGE_NAMED_TUNNEL_HOSTNAME:-}"
ZONE_ROOT="${SWARMFORGE_NAMED_TUNNEL_ZONE:-}"
CF_DIR="${CLOUDFLARED_DIR:-$HOME/.cloudflared}"
CONFIG_YML="${SWARMFORGE_CLOUDFLARED_CONFIG:-$CF_DIR/config.yml}"
ENV_OUT="$OP/named-tunnel.env"

die() { echo "setup_bubble_named_tunnel: $*" >&2; exit 1; }
info() { echo "setup_bubble_named_tunnel: $*" >&2; }

# BL-787: no operator-specific hostname/zone default ships here — fail loud
# naming the env vars (and the .example file) instead of guessing a domain.
[[ -n "$HOSTNAME" ]] || die "no hostname configured — set SWARMFORGE_NAMED_TUNNEL_HOSTNAME (see swarmforge/config/named-tunnel.env.example)"
[[ -n "$ZONE_ROOT" ]] || die "no zone configured — set SWARMFORGE_NAMED_TUNNEL_ZONE (see swarmforge/config/named-tunnel.env.example)"

[[ -x "$CF" ]] || die "cloudflared not found at $CF (install via launch_resident_spy_tunnel.sh once)"

# ── 1. Zone must be on Cloudflare (unless --allow-pending-dns) ─────────────
info "checking NS for $ZONE_ROOT ..."
NS="$(dig +short NS "$ZONE_ROOT" 2>/dev/null | tr '\n' ' ')"
DNS_READY=0
if printf '%s' "$NS" | grep -qi cloudflare; then
  DNS_READY=1
  info "NS look Cloudflare-backed: $NS"
else
  info "DNS for $ZONE_ROOT is NOT on Cloudflare yet. Current NS: $NS"
  if [[ "$ALLOW_PENDING_DNS" -ne 1 ]]; then
    cat >&2 <<EOF
setup_bubble_named_tunnel: refusing until NS are Cloudflare-backed.

  Do this first (once):
  1. Cloudflare dashboard → Add site → $ZONE_ROOT (Free plan)
  2. Copy the two Cloudflare nameservers shown
  3. GoDaddy → DNS → Nameservers → replace domaincontrol.com NS with Cloudflare's
  4. In Cloudflare DNS, recreate Vercel records (see docs/how-to/named-tunnel-bubble-musicalsifu.md)
  5. Wait until: dig +short NS $ZONE_ROOT | grep -i cloudflare
  6. Re-run this script

  Or, to create the tunnel + local config before DNS cutover:
    bash swarmforge/scripts/setup_bubble_named_tunnel.sh $ROOT --allow-pending-dns
  then re-run WITHOUT that flag once NS are on Cloudflare (to route DNS).
EOF
    exit 2
  fi
  info "continuing with --allow-pending-dns (will skip tunnel route dns)"
fi

# ── 2. Origin cert (browser login) ──────────────────────────────────────────
mkdir -p "$CF_DIR" "$OP"
if [[ ! -f "$CF_DIR/cert.pem" ]]; then
  info "no $CF_DIR/cert.pem — launching cloudflared tunnel login (browser) ..."
  "$CF" tunnel login || die "tunnel login failed"
  [[ -f "$CF_DIR/cert.pem" ]] || die "login finished but cert.pem still missing"
fi
info "origin cert present"

# ── 3. Create tunnel if missing ─────────────────────────────────────────────
TUNNEL_UUID=""
if LIST_JSON="$("$CF" tunnel list --output json 2>/dev/null)"; then
  TUNNEL_UUID="$(python3 -c "
import json,sys
name=sys.argv[1]
rows=json.loads(sys.argv[2] or '[]')
for r in rows:
  if r.get('name')==name:
    print(r.get('id') or r.get('uuid') or '')
    break
" "$TUNNEL_NAME" "$LIST_JSON" 2>/dev/null || true)"
fi
if [[ -z "$TUNNEL_UUID" ]]; then
  info "creating tunnel $TUNNEL_NAME ..."
  CREATE_OUT="$("$CF" tunnel create "$TUNNEL_NAME" 2>&1)" || die "tunnel create failed: $CREATE_OUT"
  echo "$CREATE_OUT" >&2
  TUNNEL_UUID="$(printf '%s\n' "$CREATE_OUT" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
fi
[[ -n "$TUNNEL_UUID" ]] || die "could not resolve tunnel UUID for $TUNNEL_NAME (try: cloudflared tunnel list)"
CRED_JSON="$CF_DIR/${TUNNEL_UUID}.json"
[[ -f "$CRED_JSON" ]] || die "credentials file missing: $CRED_JSON"
info "tunnel $TUNNEL_NAME id=$TUNNEL_UUID"

# ── 4. Route DNS (idempotent; requires Cloudflare zone) ─────────────────────
if [[ "$DNS_READY" -eq 1 ]]; then
  info "routing DNS $HOSTNAME → tunnel $TUNNEL_NAME ..."
  if ! "$CF" tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$HOSTNAME" 2>&1; then
    # Older cloudflared: flag may differ; try without overwrite
    "$CF" tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>&1 || \
      die "tunnel route dns failed — create a CNAME $HOSTNAME → ${TUNNEL_UUID}.cfargotunnel.com in Cloudflare DNS manually"
  fi
else
  info "SKIP route dns (zone not on Cloudflare yet). After NS cutover, re-run:"
  info "  bash swarmforge/scripts/setup_bubble_named_tunnel.sh $ROOT"
  info "Or manually CNAME $HOSTNAME → ${TUNNEL_UUID}.cfargotunnel.com in Cloudflare DNS."
fi

# ── 5. config.yml ───────────────────────────────────────────────────────────
if [[ -f "$CONFIG_YML" ]]; then
  info "backing up existing $CONFIG_YML → ${CONFIG_YML}.bak"
  cp "$CONFIG_YML" "${CONFIG_YML}.bak"
fi
cat > "$CONFIG_YML" <<EOF
# Generated by setup_bubble_named_tunnel.sh — do not commit.
tunnel: $TUNNEL_UUID
credentials-file: $CRED_JSON

ingress:
  - hostname: $HOSTNAME
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF
info "wrote $CONFIG_YML"

# ── 6. named-tunnel.env for the launcher ────────────────────────────────────
cat > "$ENV_OUT" <<EOF
# Generated by setup_bubble_named_tunnel.sh — gitignored under .swarmforge/
SWARMFORGE_NAMED_TUNNEL=$TUNNEL_NAME
SWARMFORGE_NAMED_TUNNEL_HOSTNAME=$HOSTNAME
SWARMFORGE_CLOUDFLARED_CONFIG=$CONFIG_YML
EOF
info "wrote $ENV_OUT"

cat >&2 <<EOF
setup_bubble_named_tunnel: done.

  Fixed URL: https://$HOSTNAME
  Next:
    1. Stop the quick tunnel if running (stop_ancillary / kill resident-spy-cloudflared.pid)
    2. bash swarmforge/scripts/launch_resident_spy_tunnel.sh $ROOT
    3. Open https://$HOSTNAME/resident-spy?token=\$(cat $OP/bridge-token)
EOF
echo "https://$HOSTNAME"
