#!/usr/bin/env bash
# BL-787 setup-01/setup-02: setup_bubble_named_tunnel.sh wiring, stubbed
# cloudflared + dig, no live Cloudflare account or DNS.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP="$SCRIPT_DIR/../setup_bubble_named_tunnel.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi
}

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
mkdir -p "$ROOT/bin"
chmod +x "$SETUP"

TUNNEL_UUID="11111111-1111-1111-1111-111111111111"

# Fake dig: NS query answers Cloudflare-backed iff FAKE_DIG_CLOUDFLARE is set.
cat > "$ROOT/bin/dig" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *NS* ]]; then
  if [[ -n "${FAKE_DIG_CLOUDFLARE:-}" ]]; then
    echo "ns1.cloudflare.com."
    echo "ns2.cloudflare.com."
  else
    echo "ns15.domaincontrol.com."
    echo "ns16.domaincontrol.com."
  fi
fi
exit 0
EOF

# Fake cloudflared: records every invocation; "tunnel list" always reports the
# tunnel as already existing (setup-02's precondition); "tunnel create" would
# be a bug if called under that precondition.
cat > "$ROOT/bin/cloudflared" <<EOF
#!/usr/bin/env bash
echo "fake-cloudflared: \$*" >> "$ROOT/cf-calls.log"
case "\$1 \$2" in
  "tunnel login") exit 0 ;;
  "tunnel list") echo '[{"name":"swarmforge-bubble","id":"$TUNNEL_UUID"}]' ;;
  "tunnel create") echo "Created tunnel swarmforge-bubble with id $TUNNEL_UUID" ;;
  "tunnel route") exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$ROOT/bin/dig" "$ROOT/bin/cloudflared"

export PATH="$ROOT/bin:$PATH"
export CLOUDFLARED="$ROOT/bin/cloudflared"

# ── setup-01: zone not Cloudflare-backed refuses (no --allow-pending-dns) ───
HOME1="$ROOT/home-setup01"
mkdir -p "$HOME1/.cloudflared"
: > "$HOME1/.cloudflared/cert.pem"
ROOT1="$ROOT/target-setup01"
mkdir -p "$ROOT1"

set +e
OUT01="$(
  HOME="$HOME1" \
  SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com \
  SWARMFORGE_NAMED_TUNNEL_ZONE=example.com \
  bash "$SETUP" "$ROOT1" 2>&1
)"
STATUS01=$?
set -e
check "setup-01: exits non-zero when zone is not Cloudflare-backed" '[[ "$STATUS01" -ne 0 ]]'
check "setup-01: prints the nameserver migration checklist" \
  'grep -qi "NS are Cloudflare-backed" <<< "$OUT01"'
check "setup-01: creates no tunnel" '! grep -q "tunnel create" "$ROOT/cf-calls.log" 2>/dev/null'
check "setup-01: writes no cloudflared config" '[[ ! -f "$HOME1/.cloudflared/config.yml" ]]'
rm -f "$ROOT/cf-calls.log"

# ── setup-02: zone Cloudflare-backed, tunnel exists; re-run changes nothing ─
HOME2="$ROOT/home-setup02"
mkdir -p "$HOME2/.cloudflared"
: > "$HOME2/.cloudflared/cert.pem"
echo '{}' > "$HOME2/.cloudflared/${TUNNEL_UUID}.json"
ROOT2="$ROOT/target-setup02"
mkdir -p "$ROOT2"

OUT02A="$(
  HOME="$HOME2" \
  FAKE_DIG_CLOUDFLARE=1 \
  SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com \
  SWARMFORGE_NAMED_TUNNEL_ZONE=example.com \
  bash "$SETUP" "$ROOT2" 2>&1
)"
STATUS02A=$?
check "setup-02 (first run): exits 0" '[[ "$STATUS02A" -eq 0 ]]'
check "setup-02 (first run): ingress config maps hostname to bridge port" \
  'grep -q "hostname: bubble.example.com" "$HOME2/.cloudflared/config.yml" && grep -q "127.0.0.1:8765" "$HOME2/.cloudflared/config.yml"'
check "setup-02 (first run): operator env names tunnel and hostname" \
  'grep -q "SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble" "$ROOT2/.swarmforge/operator/named-tunnel.env" && grep -q "SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com" "$ROOT2/.swarmforge/operator/named-tunnel.env"'
check "setup-02 (first run): does not create a tunnel (already exists)" \
  '! grep -q "tunnel create" "$ROOT/cf-calls.log"'

OUT02B="$(
  HOME="$HOME2" \
  FAKE_DIG_CLOUDFLARE=1 \
  SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com \
  SWARMFORGE_NAMED_TUNNEL_ZONE=example.com \
  bash "$SETUP" "$ROOT2" 2>&1
)"
STATUS02B=$?
check "setup-02 (second run): exits 0" '[[ "$STATUS02B" -eq 0 ]]'
check "setup-02 (second run): still creates no second tunnel" \
  '! grep -q "tunnel create" "$ROOT/cf-calls.log"'

# ── no operator-specific default: absent hostname/zone fails loud ──────────
set +e
OUT_NOHOST="$(HOME="$HOME2" SWARMFORGE_NAMED_TUNNEL_ZONE=example.com bash "$SETUP" "$ROOT2" 2>&1)"
STATUS_NOHOST=$?
OUT_NOZONE="$(HOME="$HOME2" SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com bash "$SETUP" "$ROOT2" 2>&1)"
STATUS_NOZONE=$?
set -e
check "no default hostname: exits non-zero" '[[ "$STATUS_NOHOST" -ne 0 ]]'
check "no default hostname: names the missing env var" 'grep -q "SWARMFORGE_NAMED_TUNNEL_HOSTNAME" <<< "$OUT_NOHOST"'
check "no default zone: exits non-zero" '[[ "$STATUS_NOZONE" -ne 0 ]]'
check "no default zone: names the missing env var" 'grep -q "SWARMFORGE_NAMED_TUNNEL_ZONE" <<< "$OUT_NOZONE"'

if [[ "$fail" -ne 0 ]]; then
  note "setup-01 output:"; printf '%s\n' "$OUT01"
  note "setup-02 first-run output:"; printf '%s\n' "$OUT02A"
  note "setup-02 second-run output:"; printf '%s\n' "$OUT02B"
  exit 1
fi
note "PASS: setup_bubble_named_tunnel DNS-gate + idempotent create"
