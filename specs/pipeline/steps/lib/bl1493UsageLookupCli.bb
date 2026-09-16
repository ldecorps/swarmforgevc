#!/usr/bin/env bb
;; BL-1493 acceptance driver: exercises the REAL
;; context-telemetry-store/latest-event-for-role against a real fixture
;; log, rebinding its own *read-tail-chunk* seam to COUNT bytes actually
;; pulled from disk - never a reimplementation of the lookup's own
;; chunk-growth logic.
;;
;; Usage: bb bl1493UsageLookupCli.bb <stateDir> <role> [maxWindowBytes]
;; Prints one JSON line:
;;   {"result": <event-or-null>, "bytesRead": N, "fileLen": N}
(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "context_telemetry_store.bb")))

(def state-dir (nth *command-line-args* 0))
(def role (nth *command-line-args* 1))
(def max-window-bytes
  (if (> (count *command-line-args*) 2)
    (Long/parseLong (nth *command-line-args* 2))
    context-telemetry-store/default-tail-window-bytes))

(def bytes-read (atom 0))

(def result
  (binding [context-telemetry-store/*read-tail-chunk*
            (fn [raf start len]
              (swap! bytes-read + len)
              (let [buf (byte-array len)]
                (.seek raf start)
                (.readFully raf buf)
                buf))]
    (context-telemetry-store/latest-event-for-role state-dir role max-window-bytes)))

(def file-len
  (let [f (context-telemetry-store/log-file state-dir)]
    (if (fs/exists? f) (fs/size f) 0)))

(println (json/generate-string {:result result :bytesRead @bytes-read :fileLen file-len}))
