#!/usr/bin/env bash
# Check whether the configured zone is ready for Bubble named-tunnel setup.
# Exit 0 = Cloudflare NS detected; exit 2 = still on registrar DNS (migration pending).
# No operator-specific hostname/zone default ships in this tracked script
# (BL-787) — SWARMFORGE_NAMED_TUNNEL_ZONE / SWARMFORGE_NAMED_TUNNEL_HOSTNAME
# are required (see swarmforge/config/named-tunnel.env.example).
set -euo pipefail

ZONE="${SWARMFORGE_NAMED_TUNNEL_ZONE:-}"
HOST="${SWARMFORGE_NAMED_TUNNEL_HOSTNAME:-}"

[[ -n "$ZONE" ]] || { echo "check_bubble_named_tunnel_dns: no zone configured — set SWARMFORGE_NAMED_TUNNEL_ZONE (see swarmforge/config/named-tunnel.env.example)" >&2; exit 1; }
[[ -n "$HOST" ]] || { echo "check_bubble_named_tunnel_dns: no hostname configured — set SWARMFORGE_NAMED_TUNNEL_HOSTNAME (see swarmforge/config/named-tunnel.env.example)" >&2; exit 1; }

echo "=== NS for $ZONE ==="
NS="$(dig +short NS "$ZONE" | sort)"
echo "$NS"
echo
echo "=== Current site records (recreate in Cloudflare DNS after cutover) ==="
echo "A     $ZONE:"
dig +short A "$ZONE" | sed 's/^/  /'
echo "AAAA  $ZONE:"
dig +short AAAA "$ZONE" | sed 's/^/  /'
echo "CNAME www.$ZONE:"
dig +short CNAME "www.$ZONE" | sed 's/^/  /'
echo
echo "=== Tunnel hostname $HOST ==="
dig +short CNAME "$HOST" | sed 's/^/  /' || true
dig +short A "$HOST" | sed 's/^/  /' || true
echo

if printf '%s' "$NS" | grep -qi cloudflare; then
  echo "OK: zone appears Cloudflare-backed. Next: bash swarmforge/scripts/setup_bubble_named_tunnel.sh"
  exit 0
fi

cat <<EOF
PENDING: $ZONE is still on registrar DNS (not Cloudflare).
  Migrate NS at GoDaddy → Cloudflare, recreate Vercel records, then re-check.
  Full checklist: docs/how-to/named-tunnel-bubble-musicalsifu.md
EOF
exit 2
