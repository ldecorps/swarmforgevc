#!/usr/bin/env bb
;; BL-413: pure decision logic for the stale acceptance-test-sandbox sweep -
;; see operator_runtime.bb's sandbox-sweep! for the thin wiring slice (real
;; /tmp listing, mtime/process-liveness reads via an injectable seam, bounded
;; deletion) that calls this.
;;
;; /tmp accumulated 879,887 entries / 37 GB of never-cleaned acceptance-test
;; sandboxes (sfvc-*, aps-* prefixes), inflating the VHDX on C: and degrading
;; every /tmp op. This sweep bounds the STOCK (the companion BL-420 bounds
;; the FLOW by fixing the extension test helpers to clean up their own
;; mkdtemp dirs at the source - both are required, see this ticket's notes).
;;
;; GUARDRAILS (the point of the ticket - a careless /tmp sweep can DECAPITATE
;; the running swarm, per the engineering "LIVE shared runtime path" rule):
;;   - an ALLOWLIST of known sandbox name prefixes, never a denylist - an
;;     unrecognized entry is left alone, always;
;;   - the running swarm's own socket/daemon root is excluded EXPLICITLY,
;;     checked FIRST, and wins over every other condition including age -
;;     defense in depth on top of the allowlist (a "swarmforge-*" name never
;;     matches the sandbox allowlist anyway, but a future careless edit to
;;     that allowlist must not silently defeat this guardrail too);
;;   - an entry with a live process rooted in it is never removed, regardless
;;     of staleness.

(ns sandbox-sweep-lib
  (:require [clojure.string :as str]))

;; An ALLOWLIST, never a denylist (the ticket's own explicit instruction) -
;; extend this list explicitly as new sandbox creators are discovered, never
;; widen it to a broad glob.
;;
;; BL-460: nine prefixes observed at volume in production (+21/min /tmp
;; growth) - each traced to a plain `mkTmpDir(...)` call in an
;; extension/test/*.test.js Vitest fixture (atomicWrite.test.js,
;; renderBriefingDiagramsCli.test.js, proposeOnboardingPromptsCli.test.js x2,
;; liveTicketFiles.test.js, chaseTrendLineCli.test.js,
;; negotiateOnboardingContractCli.test.js,
;; relayOnboardingNegotiationTelegramCli.test.js,
;; provisionOnboardingTelegramChannelCli.test.js) - pure file-based test
;; scratch dirs, never a spawned process, so they belong HERE (the dir
;; sweep) and not fixture_reaper_lib.bb's process-spawning allowlist.
(def known-sandbox-prefixes
  ["sfvc-" "aps-"
   "atomic-test-" "render-briefing-diagrams-test-"
   "propose-onboarding-prompts-target-" "propose-onboarding-prompts-test-"
   "live-ticket-files-" "chase-trend-test-"
   "negotiate-onboarding-contract-target-" "relay-onboarding-negotiation-"
   "provision-onboarding-telegram-channel-test-"])

(defn known-sandbox-prefix?
  [name]
  (boolean (some #(str/starts-with? name %) known-sandbox-prefixes)))

;; Pure: given one /tmp entry's decision inputs and returns whether the sweep
;; may remove it. socket-dir? is computed by the wiring against the REAL,
;; UID-scoped live socket path - never inferred here from a name pattern -
;; and is checked FIRST, ahead of every other condition. known-sandbox-prefix?
;; and stale? are booleans the wiring derives from the entry's own name/age;
;; has-live-process? likewise from the wiring's own process-liveness seam.
(defn removable?
  [{:keys [known-sandbox-prefix? stale? has-live-process? socket-dir?]}]
  (cond
    socket-dir? false
    (not known-sandbox-prefix?) false
    (not stale?) false
    has-live-process? false
    :else true))
