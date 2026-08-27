#!/usr/bin/env bb
;; BL-436: TDD runner for fleet_telegram_creds_lib.bb's resolve-telegram-creds -
;; covers acceptance scenarios 01-04. BL-622 extends it to cover the primary-
;; root record and refusal/uniqueness scenarios 01-05 (03/06/07 are shell-
;; level/doc scenarios covered elsewhere). home-dir/project-root are always
;; fixture temp dirs, never the real $HOME.

(ns fleet-telegram-creds-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "fleet_telegram_creds_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-fleet-telegram-creds-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-creds-file! [home-dir swarm-name creds]
  (let [f (fleet-telegram-creds-lib/creds-file-path home-dir swarm-name)]
    (fs/create-dirs (fs/parent f))
    (spit (str f) (json/generate-string creds))))

;; ── per-swarm-telegram-creds-01: a non-primary swarm resolves from its
;;    fleet creds file, not the environment ─────────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-token" :chatId "fes-chat" :bridgePort 9001})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home root "fes" {"TELEGRAM_BOT_TOKEN" "should-never-be-used" "TELEGRAM_CHAT_ID" "should-never-be-used"} 8765)]
    (assert= "01: bot token comes from the fleet creds file" "fes-token" (:bot-token resolved))
    (assert= "01: chat id comes from the fleet creds file" "fes-chat" (:chat-id resolved))
    (assert= "01: not refused" false (:refused? resolved))))

;; ── per-swarm-telegram-creds-02: the primary swarm with no creds file
;;    falls back to the environment (bootstrap: no primary root recorded
;;    yet, swarm-name is primary) ─────────────────────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home root "primary" {"TELEGRAM_BOT_TOKEN" "env-token" "TELEGRAM_CHAT_ID" "env-chat"} 8765)]
    (assert= "02: bot token falls back to env when no creds file exists" "env-token" (:bot-token resolved))
    (assert= "02: chat id falls back to env when no creds file exists" "env-chat" (:chat-id resolved))
    (assert= "02: bridge port falls back to the given default" 8765 (:bridge-port resolved))
    (assert= "02: not refused" false (:refused? resolved))))

;; ── per-swarm-telegram-creds-03: a creds file overrides an inherited
;;    primary token exported into the launching shell (never merged) ─────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-own-token" :chatId "fes-own-chat" :bridgePort 9001})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home root "fes" {"TELEGRAM_BOT_TOKEN" "primary-token-leaked-into-shell" "TELEGRAM_CHAT_ID" "primary-chat-leaked-into-shell"} 8765)]
    (assert= "03: the creds file's own token wins" "fes-own-token" (:bot-token resolved))
    (assert= "03: the creds file's own chat id wins" "fes-own-chat" (:chat-id resolved))
    (assert (not= "primary-token-leaked-into-shell" (:bot-token resolved)))))

;; ── per-swarm-telegram-creds-04: the bridge port is read from the creds
;;    file for a non-primary swarm ───────────────────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "t" :chatId "c" :bridgePort 9099})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds home root "fes" {} 8765)]
    (assert= "04: bridge port comes from the creds file" 9099 (:bridge-port resolved))))

;; ── corrupt/unparseable creds file degrades to the env fallback, never a
;;    crash ────────────────────────────────────────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)
      f (fleet-telegram-creds-lib/creds-file-path home "broken")]
  (fs/create-dirs (fs/parent f))
  (spit (str f) "not json at all")
  ;; "broken" is not the primary swarm name, so env fallback would normally
  ;; be refused - record this root as primary first so the assertion is
  ;; about corrupt-JSON degradation, not about the BL-622 refusal path.
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home root "primary")
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home root "primary" {"TELEGRAM_BOT_TOKEN" "env-token" "TELEGRAM_CHAT_ID" "env-chat"} 8765)]
    (assert= "a corrupt creds file degrades to the env fallback rather than crashing" "env-token" (:bot-token resolved))))

;; ── a creds file missing bridgePort still falls back to the given
;;    default for JUST that field, while token/chat-id still win ────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "t" :chatId "c"})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds home root "fes" {} 8765)]
    (assert= "a creds file with no bridgePort still falls back to the given default for that field" 8765 (:bridge-port resolved))
    (assert= "token still comes from the file" "t" (:bot-token resolved))))

;; ── BL-622 non-primary-never-inherits-env-token-01: a swarm that is not
;;    the recorded primary never resolves the ambient env token ─────────

(let [home (mk-tmp-dir)
      primary-root (mk-tmp-dir)
      other-root (mk-tmp-dir)]
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home primary-root "primary")
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home other-root "secondary"
                   {"TELEGRAM_BOT_TOKEN" "primary-env-token" "TELEGRAM_CHAT_ID" "primary-env-chat"} 8765)]
    (assert= "BL-622-01: no bot token is resolved" nil (:bot-token resolved))
    (assert= "BL-622-01: no chat id is resolved" nil (:chat-id resolved))
    (assert= "BL-622-01: refused" true (:refused? resolved))
    (assert (some? (:reason resolved)))
    (assert (str/includes? (:reason resolved) "secondary"))))

;; ── BL-622 primary-env-fallback-preserved-02: the recorded primary still
;;    resolves ambient env credentials ────────────────────────────────────

(let [home (mk-tmp-dir)
      primary-root (mk-tmp-dir)]
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home primary-root "primary")
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home primary-root "primary"
                   {"TELEGRAM_BOT_TOKEN" "primary-env-token" "TELEGRAM_CHAT_ID" "primary-env-chat"} 8765)]
    (assert= "BL-622-02: the ambient token is resolved" "primary-env-token" (:bot-token resolved))
    (assert= "BL-622-02: not refused" false (:refused? resolved))))

;; ── BL-622 first-primary-launch-records-root-03: the first primary launch
;;    durably records its project root ────────────────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (assert= "BL-622-03: no primary root recorded before launch" nil (fleet-telegram-creds-lib/read-primary-root home))
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home root "primary")
  (assert= "BL-622-03: the primary root record is written naming this project root"
           (str root) (fleet-telegram-creds-lib/read-primary-root home)))

;; ── BL-622: ensure-primary-root-recorded! never overwrites an existing
;;    record - moving the primary is a deliberate operator edit ──────────

(let [home (mk-tmp-dir)
      first-root (mk-tmp-dir)
      second-root (mk-tmp-dir)]
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home first-root "primary")
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home second-root "primary")
  (assert= "ensure-primary-root-recorded! is a no-op once a record exists"
           (str first-root) (fleet-telegram-creds-lib/read-primary-root home)))

;; ── BL-622: a non-primary swarm launching first never records itself as
;;    primary ──────────────────────────────────────────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (fleet-telegram-creds-lib/ensure-primary-root-recorded! home root "fes")
  (assert= "a non-primary swarm-name never bootstraps the primary-root record"
           nil (fleet-telegram-creds-lib/read-primary-root home)))

;; ── BL-622 named-swarm-creds-file-wins-04: a named swarm with its own
;;    creds file resolves that token (regression) ─────────────────────────

(let [home (mk-tmp-dir)
      root (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-token" :chatId "fes-chat" :bridgePort 9001})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home root "fes"
                   {"TELEGRAM_BOT_TOKEN" "primary-env-token" "TELEGRAM_CHAT_ID" "primary-env-chat"} 8765)]
    (assert= "BL-622-04: the fes token is resolved" "fes-token" (:bot-token resolved))
    (assert (not= "primary-env-token" (:bot-token resolved)))))

;; ── BL-622 duplicate-token-refused-05: a token already recorded for
;;    another fleet swarm is refused ───────────────────────────────────────

(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "shared-token" :chatId "fes-chat" :bridgePort 9001})
  (write-creds-file! home "fes2" {:botToken "shared-token" :chatId "fes2-chat" :bridgePort 9002})
  (assert= "BL-622-05: fes2 conflicts with fes over the shared token"
           "fes" (fleet-telegram-creds-lib/conflicting-swarm home "fes2" "shared-token"))
  (assert (str/includes? (fleet-telegram-creds-lib/duplicate-token-message "fes2" "fes") "fes")))

(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-token" :chatId "fes-chat" :bridgePort 9001})
  (assert= "BL-622: distinct tokens never conflict"
           nil (fleet-telegram-creds-lib/conflicting-swarm home "fes2" "fes2-own-token"))
  (assert= "BL-622: a nil token never conflicts with anything"
           nil (fleet-telegram-creds-lib/conflicting-swarm home "fes2" nil)))

;; ── BL-622: a swarm never conflicts with ITSELF. The only fleet swarm on
;;    disk is "fes" and its own bot-token is compared against its own
;;    creds file - the self-exclusion guard (not= other-name swarm-name)
;;    must exclude the sole candidate and return nil, never "fes". This is
;;    deliberately the ONLY entry in the fleet dir, so a passing result
;;    cannot be masked by fs/list-dir enumeration order finding some OTHER
;;    swarm first (as the duplicate-token-refused-05 case above would if
;;    the self-exclusion guard were silently dropped: "fes" still sorts
;;    before "fes2" there, so removing the guard did not fail that check).
(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-own-token" :chatId "fes-chat" :bridgePort 9001})
  (assert= "BL-622: a swarm's own creds file never conflicts with itself"
           nil (fleet-telegram-creds-lib/conflicting-swarm home "fes" "fes-own-token")))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "fleet_telegram_creds_lib (BL-436): ALL TESTS PASSED")
  (do (println (str "fleet_telegram_creds_lib (BL-436): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
