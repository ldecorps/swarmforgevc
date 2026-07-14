// BL-288: Vercel's own discovered entry point (filesystem routing: any file
// under api/ becomes a function). Deliberately just a re-export - ALL
// testable logic lives in the compiled extension/out/notify/
// recertWebhookVercelHandler.js (built from extension/src/notify/
// recertWebhookVercelHandler.ts, unit-tested in
// extension/test/recertWebhookVercelHandler.test.js) so this file has
// nothing of its own that needs a live Vercel runtime to verify.
'use strict';

const { recertWebhookHandler, config } = require('../extension/out/notify/recertWebhookVercelHandler');

module.exports = recertWebhookHandler;
module.exports.config = config;
