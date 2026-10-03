#!/usr/bin/env bb
;; BL-1850: append one row of a local-model seat's settings to
;; <root>/.swarmforge/local-agent/seat-settings/<seat>.jsonl - what the
;; seat starts with, and a fingerprint that changes only when a setting
;; does - so a change in the seat's behaviour can be tied to the setting
;; that changed. Every local-model seat's generated launch script runs this
;; before qwen starts (swarmforge.sh write_role_launch_script). Run it by
;; hand after changing a setting outside the swarm, such as the GPU power
;; limit.
;;
;; Usage: local_seat_settings_snapshot_cli.bb <root> --seat <seat> --model <model>
;;          --endpoint-url <url> --card <prompt file> --worktree <seat worktree>
;;          [--qwen-home <dir>] [--nvidia-smi <cmd>] [--qwen-bin <cmd>]
;;
;; Never stops a start (invariant 1): every source is asked in parallel and
;; bounded, a source that does not answer is recorded as "unknown", any
;; failure is logged to stderr, and it always exits 0 within 3 seconds.
;; Never records a credential (invariant 2): qwen's provider entry and
;; compression settings pass through drop-credentials before writing.

(require '[babashka.fs :as fs]
         '[babashka.http-client :as http]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "local_seat_settings_snapshot_lib.bb")))
(alias 'lib 'local-seat-settings-snapshot-lib)

(def started-ms (System/currentTimeMillis))
;; The probes share one deadline, well inside the 3 s the start may spend.
(def probe-deadline-ms 2300)
(def per-request-ms 1500)

(defn- log! [& parts]
  (binding [*out* *err*] (println (str "local-seat-settings-snapshot: " (str/join " " parts)))))

(defn- parse-args [args]
  (let [[root & opts] args]
    (loop [m {:root root} [k v & more] opts]
      (if-not k
        m
        (recur (assoc m (keyword (str/replace k #"^--" "")) v) more)))))

(defn- ollama-base [url]
  (-> (str url) (str/replace #"/+$" "") (str/replace #"/v1$" "")))

(defn- ollama-facts [url model]
  (let [base (ollama-base url)
        version (-> (http/get (str base "/api/version") {:timeout per-request-ms :throw false}) :body (json/parse-string true) :version)
        show (when-not (str/blank? model)
               (let [r (http/post (str base "/api/show")
                                  {:timeout per-request-ms :throw false
                                   :headers {"Content-Type" "application/json"}
                                   :body (json/generate-string {:model model :name model})})]
                 (when (= 200 (:status r)) (json/parse-string (:body r) true))))]
    (when-not (and version (or show (str/blank? model)))
      (log! "ollama answered only in part: version" (pr-str version) "show" (if show "ok" "none")))
    (if (or version show)
      {:version (or version lib/unknown)
       :parameters (if show (lib/parse-show-parameters (:parameters show)) lib/unknown)
       :quantization (or (get-in show [:details :quantization_level]) lib/unknown)}
      lib/unknown)))

(defn- run-bounded
  "cmd's stdout, or nil - and every way it can come to nothing (a timeout,
   a non-zero exit) is logged."
  [cmd ms]
  (let [p (process/process cmd {:out :string :err :string})
        r (deref p ms ::timeout)]
    (cond
      (= r ::timeout) (do (process/destroy-tree p) (log! (first cmd) "timed out") nil)
      (zero? (:exit r)) (:out r)
      :else (do (log! (first cmd) "exited" (:exit r)) nil))))

(defn- gpu-facts [cmd]
  (let [out (run-bounded [cmd "--query-gpu=name,enforced.power.limit,power.default_limit" "--format=csv,noheader"]
                         per-request-ms)
        parsed (some-> out lib/parse-nvidia-smi)]
    (when (and out (not parsed)) (log! "nvidia-smi printed nothing usable:" (pr-str (str/trim out))))
    (or parsed lib/unknown)))

(defn- qwen-version [cmd]
  (or (some-> (run-bounded [cmd "--version"] per-request-ms) str/trim not-empty) lib/unknown))

(defn- read-json [path]
  (when (and path (fs/exists? path))
    (try (json/parse-string (slurp (str path)) true)
         (catch Exception e (log! "unreadable" (str path) (.getMessage e)) nil))))

(defn- qwen-facts [{:keys [model worktree qwen-home]} version]
  (let [user (read-json (fs/path qwen-home "settings.json"))
        workspace (when worktree (read-json (fs/path worktree ".qwen" "settings.json")))
        provider (lib/pick-provider-entry {:workspace workspace :user user :model model})
        compression (or (:chatCompression workspace) (:chatCompression user))]
    {:version version
     :provider (lib/drop-credentials provider)
     :chatCompression (lib/drop-credentials compression)}))

(defn- card-facts [card]
  (try
    (let [bytes (fs/read-all-bytes card)
          digest (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes)]
      {:path (str card) :bytes (alength bytes) :sha256 (apply str (map #(format "%02x" (bit-and % 0xff)) digest))})
    (catch Exception e (log! "card unreadable:" (str card) (.getMessage e)) lib/unknown)))

(defn- await-all
  "Each future's value, or unknown for any not done by the shared deadline."
  [futures]
  (into {} (for [[k fut] futures]
             (let [left (max 0 (- probe-deadline-ms (- (System/currentTimeMillis) started-ms)))
                   v (deref fut left ::timeout)]
               (when (= v ::timeout) (future-cancel fut) (log! (name k) "did not answer in time"))
               [k (if (= v ::timeout) lib/unknown v)]))))

(defn- probe [f label]
  (future (try (f) (catch Exception e (log! label "failed:" (.getMessage e)) lib/unknown))))

(defn -main [args]
  (let [{:keys [root seat model endpoint-url card] :as opts} (parse-args args)
        opts (update opts :qwen-home #(or % (str (fs/path (System/getProperty "user.home") ".qwen"))))]
    (when (or (str/blank? root) (str/blank? seat))
      (log! "usage: <root> --seat <seat> --model <model> --endpoint-url <url> --card <file> --worktree <dir>")
      (System/exit 0))
    (try
      (let [{:keys [ollama gpu qwen-version]}
            (await-all {:ollama (probe #(ollama-facts endpoint-url model) "ollama")
                        :gpu (probe #(gpu-facts (or (:nvidia-smi opts) "nvidia-smi")) "nvidia-smi")
                        :qwen-version (probe #(qwen-version (or (:qwen-bin opts) "qwen")) "qwen --version")})
            row (lib/finish-row {:at (str (java.time.Instant/now))
                                 :seat seat
                                 :model (or model "")
                                 :ollama ollama
                                 :qwen (qwen-facts opts qwen-version)
                                 :card (if (str/blank? card) lib/unknown (card-facts card))
                                 :gpu gpu})
            file (fs/path root ".swarmforge" "local-agent" "seat-settings" (str seat ".jsonl"))]
        (fs/create-dirs (fs/parent file))
        (spit (str file) (str (json/generate-string row) "\n") :append true))
      (catch Throwable e
        (log! "no row written:" (.getMessage e))))
    (shutdown-agents)
    (System/exit 0)))

(-main *command-line-args*)
