// BL-376: split out of tmuxClient.ts into its own module so a test can
// intercept a call to it via a genuine cross-module spy
// (vi.spyOn(sleepSyncModule, 'sleepSync')). A same-file call binds to the
// local function declaration at compile time - immune to reassigning the
// exported property on the SAME module's own exports object, confirmed
// empirically (spying it while driving a real wedged retry loop recorded
// zero calls despite ~800ms of genuine Atomics.wait elapsing) - so the
// seam needs to live in a separate module respawnAgent's fallback default
// imports normally, exactly like its other real adapters (capturePane,
// sendKeys).
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
