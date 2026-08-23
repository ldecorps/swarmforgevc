#!/usr/bin/env bb
;; BL-1081 / BL-897: the ACP seat snapshot crosses a TS/bb boundary no import
;; bridges. acpSeatState.ts WRITES it; acp_session_lib.bb READS it. A field
;; renamed on one side and not the other fails silently - the reader sees nil,
;; decides "not ACP-hosted", and the seat quietly falls back to the pane
;; heuristics this whole ticket exists to replace. Green everywhere, and the
;; feature simply stops working.
;;
;; BL-897's rule: a constant mirrored across such a boundary needs a test
;; asserting both literals agree. A "kept in sync" comment is not a gate. This
;; is that test: it drives the REAL TypeScript snapshot builder and asserts the
;; REAL bb reader understands every field of what it produced.

(ns bl1081-acp-snapshot-agreement-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; FOUR parents: this file is swarmforge/scripts/test/<name>.bb, so three
;; lands on swarmforge/ and every path below silently misses.
(def repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*)))))))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "acp_session_lib.bb")))

(def failures (atom []))
(defn fail! [m] (swap! failures conj (str "FAIL: " m)))

(def out-dir (str (fs/path repo-root "extension" "out" "swarm")))

(when-not (fs/exists? (fs/path out-dir "acpSeatState.js"))
  (fail! (str "extension/out is not compiled - " out-dir
              "/acpSeatState.js is missing, so this gate would pass by testing nothing"))
  (doseq [f @failures] (binding [*out* *err*] (println f)))
  (System/exit 1))

(defn ts-snapshot
  "Builds a snapshot with the REAL TypeScript, for a given event stream."
  [role events-json]
  (let [expr (str "const {foldAcpEvents,snapshotForSeat}=require(" (json/generate-string (str (fs/path out-dir "acpSeatState.js"))) ");"
                  "const evts=" events-json ";"
                  "process.stdout.write(JSON.stringify(snapshotForSeat(" (json/generate-string role) ",foldAcpEvents(evts))));")
        r (process/sh ["node" "-e" expr])]
    (when-not (zero? (:exit r))
      (fail! (str "the TS snapshot builder failed: " (:err r))))
    (json/parse-string (str/trim (str (:out r))) true)))

(def tmp (str (fs/create-temp-dir {:prefix "bl1081-agree-"})))
(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))

(defn round-trip!
  "Writes what TS produced to where bb reads it, then reads it back with the
   REAL bb reader - the whole boundary, end to end."
  [role snapshot]
  (fs/create-dirs (fs/path tmp ".swarmforge" "acp"))
  (spit (str (acp-session-lib/snapshot-path tmp role)) (json/generate-string snapshot))
  (acp-session-lib/read-snapshot tmp role))

;; ── an idle seat ─────────────────────────────────────────────────────────
(let [ts (ts-snapshot "coder" "[{kind:'turn_ended',stopReason:'end_turn'}]")
      bb (round-trip! "coder" ts)]
  (when (nil? bb)
    (fail! "the bb reader did not recognise a snapshot the TS side produced - the boundary has drifted"))
  (when bb
    (when-not (acp-session-lib/acp-hosted? bb) (fail! "acp-hosted? false for a TS-produced snapshot"))
    (when-not (= "end_turn" (acp-session-lib/stop-reason bb))
      (fail! (str "stop-reason disagreed: " (pr-str (acp-session-lib/stop-reason bb)))))
    (when-not (:idle? (acp-session-lib/idle-decision bb))
      (fail! "idle-decision disagreed on an ended turn"))
    (when-not (= "stop_reason:end_turn" (:from (acp-session-lib/idle-decision bb)))
      (fail! (str "idleFrom disagreed: " (pr-str (:from (acp-session-lib/idle-decision bb))))))
    (when (acp-session-lib/menu-check-applies? bb)
      (fail! "the menu check must not apply to an ACP seat"))))

;; ── a blocked seat ───────────────────────────────────────────────────────
(let [ts (ts-snapshot "coder" "[{kind:'permission_requested',requestId:3,tool:'write_file'}]")
      bb (round-trip! "coder" ts)]
  (when-not (acp-session-lib/permission-pending? bb)
    (fail! "permission-pending? disagreed with the TS side"))
  (when (:idle? (acp-session-lib/idle-decision bb))
    (fail! "a blocked seat must not read as idle on either side")))

;; ── a mid-turn seat ──────────────────────────────────────────────────────
(let [ts (ts-snapshot "coder" "[]")
      bb (round-trip! "coder" ts)]
  (when (acp-session-lib/stop-reason bb) (fail! "no turn ended, yet a stop reason was read"))
  (when (:idle? (acp-session-lib/idle-decision bb)) (fail! "a seat that never ended a turn is not idle")))

;; ── EVERY field the TS side writes is one the bb side knows ──────────────
;; This is what catches a rename: a new or renamed field the reader ignores.
(let [ts (ts-snapshot "coder" "[{kind:'turn_ended',stopReason:'refusal'}]")
      known #{:role :acp :stopReason :idle :idleFrom :permissionPending :permissionTool :turnsEnded}
      unknown (remove known (keys ts))]
  (when (seq unknown)
    (fail! (str "the TS snapshot carries field(s) the bb reader does not know: " (pr-str (vec unknown))
                " - rename them on both sides or teach acp_session_lib.bb to read them")))
  (doseq [k known]
    (when-not (contains? ts k)
      (fail! (str "the bb reader expects field " k " but the TS side no longer writes it")))))

;; ── the PATH agrees too, not only the payload ────────────────────────────
(let [r (process/sh ["node" "-e"
                     (str "const {acpSnapshotRelPath}=require("
                          (json/generate-string (str (fs/path out-dir "acpHostRuntime.js")))
                          ");process.stdout.write(acpSnapshotRelPath('coder'));")])
      ts-path (str/trim (str (:out r)))
      bb-path (str (fs/relativize (fs/path tmp) (acp-session-lib/snapshot-path tmp "coder")))]
  (when-not (= ts-path bb-path)
    (fail! (str "the snapshot PATH disagrees across the boundary: TS " ts-path " vs bb " bb-path
                " - the reader would look where nothing is written"))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "bl1081_acp_snapshot_agreement_test_runner: ok - the TS writer and bb reader agree on payload and path"))
