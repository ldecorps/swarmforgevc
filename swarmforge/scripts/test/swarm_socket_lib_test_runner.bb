#!/usr/bin/env bb
;; BL-367: TDD runner for swarm_socket_lib.bb's pure resolve-socket-path
;; decision. No real sockets, no real filesystem - just string-length
;; arithmetic, so every path-length-limit case (including the pathologically
;; deep-checkout scenario) is deterministic and instant.

(ns swarm-socket-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_socket_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual (swap! failures conj (str "FAIL: " msg))))

;; ── primary-socket-path / xdg-fallback-socket-path ──────────────────────

(assert= "primary-socket-path nests under .swarmforge/tmux/, never /tmp"
         "/home/pi/swarmforgevc/.swarmforge/tmux/12345.sock"
         (swarm-socket-lib/primary-socket-path "/home/pi/swarmforgevc" "12345"))

(assert= "xdg-fallback-socket-path lives under XDG_RUNTIME_DIR, never /tmp"
         "/run/user/1000/swarmforge/12345.sock"
         (swarm-socket-lib/xdg-fallback-socket-path "/run/user/1000" "12345"))

;; ── resolve-socket-path: BL-367 scenario 01 (not shared scratch space) ──

(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir "/home/pi/swarmforgevc" :hash "12345" :xdg-runtime-dir "/run/user/1000"})]
  (assert= "a normal-length project root resolves to the primary .swarmforge/ path"
           {:path "/home/pi/swarmforgevc/.swarmforge/tmux/12345.sock" :source :primary}
           result)
  (assert-true "the resolved path never starts with /tmp" (not (str/starts-with? (:path result) "/tmp"))))

;; ── resolve-socket-path: BL-367 scenario 03 (no XDG_RUNTIME_DIR, but the
;;    primary path is short enough - the common case, not a failure) ─────

(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir "/home/pi/swarmforgevc" :hash "12345" :xdg-runtime-dir nil})]
  (assert= "a missing XDG_RUNTIME_DIR does not matter when the primary path already fits"
           {:path "/home/pi/swarmforgevc/.swarmforge/tmux/12345.sock" :source :primary}
           result))

(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir "/home/pi/swarmforgevc" :hash "12345" :xdg-runtime-dir ""})]
  (assert= "a blank XDG_RUNTIME_DIR (some shells export it empty) is treated the same as unset"
           {:path "/home/pi/swarmforgevc/.swarmforge/tmux/12345.sock" :source :primary}
           result))

;; ── resolve-socket-path: BL-367 scenario 04 (deeply-nested project) ─────

(def deep-working-dir (str "/home/carillon/" (apply str (repeat 80 "a"))))

(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir deep-working-dir :hash "12345" :xdg-runtime-dir "/run/user/1000"})]
  (assert= "a too-long primary path falls back to XDG_RUNTIME_DIR, still never /tmp"
           {:path "/run/user/1000/swarmforge/12345.sock" :source :xdg-fallback}
           result))

(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir deep-working-dir :hash "12345" :xdg-runtime-dir nil})]
  (assert= "a too-long primary path with NO XDG_RUNTIME_DIR fallback fails with a named error - never a blind bind"
           :path-too-long (:error result))
  (assert-true "the error message names the OS unix-socket path limit constraint, not an opaque errno"
               (boolean (re-find #"unix-socket path limit" (:message result)))))

;; ── resolve-socket-path: exact boundary at max-safe-socket-path-len (100) ──
;; The comparison is `<=`, not `<` - a mutant flipping that operator would
;; pass every test above (which only exercise clearly-under and clearly-over
;; cases) while silently rejecting a project root that fits EXACTLY at the
;; limit, or accepting one that overruns it by one byte. Pin both sides of
;; the boundary explicitly.

;; suffix = "/.swarmforge/tmux/" (18) + hash (5) + ".sock" (5) = 28 chars.
;; working-dir of 72 chars -> primary path of exactly 100 chars (the limit).
(def boundary-working-dir-at-limit (str "/home/carillon/" (apply str (repeat 57 "a"))))
(assert= "boundary-working-dir-at-limit is exactly 72 chars (test fixture sanity check)"
         72 (count boundary-working-dir-at-limit))

(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir boundary-working-dir-at-limit :hash "12345" :xdg-runtime-dir "/run/user/1000"})]
  (assert= "a primary path of EXACTLY 100 chars (the limit) still resolves to primary, never falls back or errors"
           {:path (str boundary-working-dir-at-limit "/.swarmforge/tmux/12345.sock") :source :primary}
           result))

;; One byte over the limit (73-char working-dir -> 101-char primary path)
;; must NOT resolve to primary - it must fall back (or error with no fallback).
(def boundary-working-dir-over-limit (str "/home/carillon/" (apply str (repeat 58 "a"))))
(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir boundary-working-dir-over-limit :hash "12345" :xdg-runtime-dir "/run/user/1000"})]
  (assert= "a primary path ONE BYTE over the limit (101 chars) falls back, proving the boundary is <=, not < or unbounded"
           {:path "/run/user/1000/swarmforge/12345.sock" :source :xdg-fallback}
           result))

;; A pathologically long XDG_RUNTIME_DIR (the fallback's own length depends
;; on IT, not on working-dir) can itself overrun the limit too.
(def absurdly-long-xdg-runtime-dir (str "/run/user/" (apply str (repeat 200 "a"))))
(let [result (swarm-socket-lib/resolve-socket-path
              {:working-dir deep-working-dir :hash "12345" :xdg-runtime-dir absurdly-long-xdg-runtime-dir})]
  (assert= "even the XDG_RUNTIME_DIR fallback can overrun when IT is absurdly long - still a named error, never a blind bind"
           :path-too-long (:error result)))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "swarm_socket_lib (BL-367): ALL TESTS PASSED")
  (do (println (str "swarm_socket_lib (BL-367): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
