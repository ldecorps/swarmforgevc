'use strict';

// BL-867: the named-tunnel identity vars a live operator host genuinely
// exports (see swarmforge/config/named-tunnel.env.example) so the real
// resident-spy tunnel can run there. A BL-787 fixture subprocess that
// spreads process.env wholesale inherits these ambient values even when
// its own case means one of them ABSENT - the case then silently observes
// the operator's real identity instead of the absence it names (BL-861
// hardener finding: this is what made invariant 2 fail, and made
// invariant 3's quick-mode half vacuous, on a contaminated host).
//
// isolatedEnv builds a fixture subprocess env from `ambient` (defaults to
// the real process.env) with every one of these vars stripped first, then
// `overrides` applied on top - so a case's own choice to name a var
// present or leave it absent is the ONLY thing that determines what the
// subprocess sees, never what the host happened to export.
const NAMED_TUNNEL_IDENTITY_VARS = Object.freeze([
  'SWARMFORGE_NAMED_TUNNEL',
  'SWARMFORGE_NAMED_TUNNEL_HOSTNAME',
  'SWARMFORGE_NAMED_TUNNEL_ZONE',
  'SWARMFORGE_CLOUDFLARED_CONFIG',
]);

function isolatedEnv(overrides, ambient = process.env) {
  const env = { ...ambient };
  for (const key of NAMED_TUNNEL_IDENTITY_VARS) {
    delete env[key];
  }
  return Object.assign(env, overrides);
}

module.exports = { NAMED_TUNNEL_IDENTITY_VARS, isolatedEnv };
