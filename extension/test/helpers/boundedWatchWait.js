'use strict';

// BL-933: fs.watch's own event delivery is the one genuinely OS-async step
// in the three tests this helper serves (BL-131) - kept real on purpose,
// never faked. What BL-131 left unbounded is the await itself: on a loaded
// host a late or dropped OS event ran out the whole test lane's 20000ms
// budget and reported a bare Vitest timeout naming only the test. This
// races the same "resolved by the real event" promise against an explicit,
// much shorter deadline, so a missing event fails fast with a message
// naming the event and the path that was being watched.
const DEFAULT_TIMEOUT_MS = 10000;

function describeWatchWaitTimeout(eventLabel, watchedPath, timeoutMs) {
  return `real fs.watch event "${eventLabel}" on ${watchedPath} did not arrive within ${timeoutMs}ms`;
}

function awaitRealWatchEvent(promise, { eventLabel, watchedPath, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!eventLabel || !watchedPath) {
    throw new Error('awaitRealWatchEvent requires both eventLabel and watchedPath');
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(describeWatchWaitTimeout(eventLabel, watchedPath, timeoutMs)));
    }, timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

module.exports = { awaitRealWatchEvent, describeWatchWaitTimeout, DEFAULT_TIMEOUT_MS };
