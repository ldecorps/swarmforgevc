import base from './vitest.config.mjs';

const cfg = typeof base === 'object' && base.default ? base.default : base;
export default {
  ...cfg,
  test: {
    ...cfg.test,
    // BL-1441 hardening (BL-956-pipeline-board-caption-and-cap-hotfix's
    // mutation gate): scope the Stryker dry run to the tests covering
    // pipelineBoard.ts, per the vitest.bl1081/bl1348/bl1365/bl1383/bl1402/
    // bl1441/bl1475/bl1476/bl1477.stryker.config.mjs precedent - avoids the
    // standing Stryker-sandbox-only red in test/activePoolFreshnessAudit.test.js
    // without editing the shared vitest.config.mjs. Found by import path
    // (require(...pipelineBoard) exactly, never the pipelineBoardSync/
    // pipelineBoardPinSync sibling modules a bare substring grep would also
    // catch).
    include: [
      'test/bl979PipelineBoardTicketRows.test.js',
      'test/bl980RecentlyClosedElapsed.test.js',
      'test/pipelineBoard.test.js',
      'test/pipelineBoardHeld.test.js',
      'test/pipelineBoardSync.test.js',
    ],
  },
};
