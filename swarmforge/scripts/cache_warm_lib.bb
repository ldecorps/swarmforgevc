#!/usr/bin/env bb
;; BL-519: launch-time cache-warm decision. Anthropic prompt caching keys on
;; an exact-byte prefix; agent_runtime_lib.bb's stable-prefix-text (the
;; inlined constitution+PIPELINE) is that prefix. A launcher must know
;; whether the ASSEMBLED stable prefix it is about to serve is the same one
;; already cached (reuse) or has changed since the last launch of this pack
;; (a changed constitution, or a changed pack model/effort routing) and
;; therefore needs a fresh warm rather than trusting a stale/orphaned entry.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "cache_warm_lib.bb")))
;; and referred to as cache-warm-lib/foo.
(ns cache-warm-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json])
  (:import [java.security MessageDigest]))

;; BL-546: the stable prefix is composed by PromptEngine (the single
;; authority) - cache warm keys on ITS output directly, not on a parallel
;; assembly. agent_runtime_lib delegates to the same function either way;
;; loading prompt_engine_lib here makes the dependency direct.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "prompt_engine_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(defn sha256-hex [s]
  (let [digest (-> (MessageDigest/getInstance "SHA-256")
                    (.digest (.getBytes (or s "") "UTF-8")))]
    (apply str (map #(format "%02x" %) digest))))

(defn stable-prefix-content-hash
  "Content hash of the assembled stable prefix: PromptEngine's
   constitution+PIPELINE text (or stable-text, an injectable override),
   plus model-routing-text (raw text describing per-role model/effort
   assignment - typically a pack's .conf file content) so a routing
   change also invalidates the hash, per BL-519's
   warm-hash-tracks-stable-prefix-05 scenario. stable-text is a seam so a
   test can simulate a constitution change deterministically instead of
   mutating the real swarmforge/constitution.prompt on disk; a real
   launcher never passes it and gets the real stable-prefix-text. A
   literal space between the two inputs guards against a crafted
   boundary in one making the concatenation collide with a different
   split of the same bytes."
  [& {:keys [model-routing-text stable-text]}]
  (sha256-hex (str (or stable-text (prompt-engine-lib/stable-prefix-text)) " " (or model-routing-text ""))))

(defn warm-decision
  "Pure decision: :reuse-cache when the current hash matches the prior
   recorded one (nothing changed since the last launch of this pack, so
   the existing cache entry is still valid) - :rewarm when it differs, or
   when no prior hash was ever recorded (first launch of this pack)."
  [prior-hash current-hash]
  (if (= prior-hash current-hash) :reuse-cache :rewarm))

(defn state-path
  "state-dir is a caller-supplied, redirectable path (never a hardcoded
   real runtime location) so a test can point this at its own temp root."
  [state-dir pack-name]
  (str (fs/path state-dir (str pack-name ".json"))))

(defn read-prior-hash [state-dir pack-name]
  (let [path (state-path state-dir pack-name)]
    (when (fs/exists? path)
      (:hash (json/parse-string (slurp path) true)))))

(defn record-hash! [state-dir pack-name hash]
  (handoff-lib/atomic-write! (state-path state-dir pack-name)
                             (json/generate-string {:hash hash})))

(defn decide-and-record-warm!
  "The impure orchestration a launcher calls once per launch: read the
   pack's prior hash from state-dir, compute the current hash from live
   inputs, decide, then persist the new hash - so the NEXT launch always
   compares against what is actually true now, regardless of today's
   decision. Returns {:decision :hash :prior-hash} for the caller to act
   on (e.g. only stagger the first same-tier launch on :rewarm)."
  [state-dir pack-name & {:keys [model-routing-text stable-text]}]
  (let [prior (read-prior-hash state-dir pack-name)
        current (stable-prefix-content-hash :model-routing-text model-routing-text
                                             :stable-text stable-text)
        decision (warm-decision prior current)]
    (record-hash! state-dir pack-name current)
    {:decision decision :hash current :prior-hash prior}))
