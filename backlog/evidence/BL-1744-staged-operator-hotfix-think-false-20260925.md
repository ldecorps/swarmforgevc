# BL-1744 - the operator hotfix staged on master (reference implementation)

Staged on the shared master checkout since 2026-09-24 ~18:34Z by the operator
session, at the human's direction ("ok commit and let the swarm know",
2026-09-24 18:33Z; "Commit the think:false and push both parts",
2026-09-25 06:33Z). Every attempt to commit it on main died in the
property-suite guard (heap-cap worker crash on the main checkout, BL-1729), and
it now blocks `build_freshness_cli.bb sync` (coordinator note 011573).
Captured verbatim with `git diff --cached` at 2026-09-25T11:13Z against HEAD 3162f76cc8.

Operator's live measurements (same session): qwen3.8-27b-iq3s-seat with
thinking on used its whole reply budget on a `<think>` block and never
answered (132 s, cut off). With `think: false` it answered cleanly with no
`<think>` (51 s, and again at 93-95 s on longer prompts). Regression run: 8
test files, 78 tests green.

```diff
diff --git a/extension/src/tools/localQwenSeatLive.ts b/extension/src/tools/localQwenSeatLive.ts
index b218413856..0885dd738c 100644
--- a/extension/src/tools/localQwenSeatLive.ts
+++ b/extension/src/tools/localQwenSeatLive.ts
@@ -129,6 +129,17 @@ export async function readLocalEndpoint(
  * test asserting on it) never has to account for a briefing prefix. Omitted
  * when undefined - `JSON.stringify` drops an undefined-valued key - so a
  * caller with no briefing sends exactly the request this seat always sent.
+ *
+ * `think: false` is ollama's own native toggle for a reasoning-capable model
+ * (`ollama show` lists it under Capabilities). Measured live against
+ * qwen3.8-27b-iq3s-seat on this CPU-only host: with thinking on, a turn spent
+ * its whole 120-token reply budget on an unsuppressed `<think>` block and
+ * never reached an answer (132s, cut off mid-thought); with `think: false`,
+ * the same question answered cleanly in 51s with no `<think>` at all. This
+ * seat's whole purpose is a short spoken-style reply (the briefing says
+ * "Answer in a few short sentences that read well aloud"), so thinking is
+ * always off here, not made configurable. A model with no thinking
+ * capability ignores the field.
  */
 export async function completeWithLocalModel(
   modelId: string,
@@ -140,7 +151,7 @@ export async function completeWithLocalModel(
   const res = await fetchFn(`${endpointUrl}/api/generate`, {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
-    body: JSON.stringify({ model: modelId, prompt, system, stream: false }),
+    body: JSON.stringify({ model: modelId, prompt, system, think: false, stream: false }),
   });
   const raw = await res.text();
   if (!res.ok) {
diff --git a/extension/test/bl1235LocalQwenSeatLive.test.js b/extension/test/bl1235LocalQwenSeatLive.test.js
index 5777bf4693..2ed82c24a7 100644
--- a/extension/test/bl1235LocalQwenSeatLive.test.js
+++ b/extension/test/bl1235LocalQwenSeatLive.test.js
@@ -248,7 +248,7 @@ describe('BL-1235 the completion call', () => {
     });
 
     assert.equal(sawUrl, `${ENDPOINT}/api/generate`);
-    assert.deepEqual(sawBody, { model: 'qwen3:14b', prompt: 'hello', stream: false });
+    assert.deepEqual(sawBody, { model: 'qwen3:14b', prompt: 'hello', think: false, stream: false });
     assert.equal(reply, 'hi');
   });
 
@@ -263,6 +263,7 @@ describe('BL-1235 the completion call', () => {
       model: 'qwen3:14b',
       prompt: 'hello',
       system: 'You are the local seat.',
+      think: false,
       stream: false,
     });
   });
```

By specifier.
