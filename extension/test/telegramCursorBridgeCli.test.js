const assert = require('node:assert/strict');
const { main } = require('../out/tools/telegram-cursor-bridge');

test('telegram-cursor-bridge main rejects missing Telegram env', async () => {
  const prev = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_PRINCIPAL_USER_ID: process.env.TELEGRAM_PRINCIPAL_USER_ID,
  };
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_PRINCIPAL_USER_ID;
  try {
    await assert.rejects(() => main(), /TELEGRAM_BOT_TOKEN/);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
