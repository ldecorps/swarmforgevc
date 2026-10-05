'use strict';

const chiptunes = require('../../../extension/out/bridge/letsTalkChiptunes');
const uiHtml = require('../../../extension/out/bridge/letsTalkUiHtml');

const FEATURE = "Let's Talk hold music expands with iconic chiptunes";

function registerSteps(registry) {
  registry.defineScoped(/^the Let's Talk hold-music chiptune catalog is available$/, (ctx) => {
    ctx.catalog = chiptunes.getLetsTalkChiptunesCatalog();
  }, FEATURE);

  registry.defineScoped(/^hold music remains quiet and toggleable$/, (ctx) => {
    // The hold-music toggle is a checked checkbox (on by default) and the
    // player runs at a low fixed gain, so the music stays quiet and can be
    // switched off from the UI.
    const html = uiHtml.getLetsTalkUiHtml();
    if (!html.includes('id="hold-music-toggle"') || !html.includes('checked')) {
      throw new Error("expected a checked hold-music toggle in the Let's Talk UI");
    }
    if (!html.includes('chiptuneGain.gain.value = 0.015')) {
      throw new Error('expected the hold-music player to run at a low fixed gain');
    }
  }, FEATURE);

  registry.defineScoped(/^the hold-music song list is inspected$/, (ctx) => {
    ctx.songs = ctx.catalog.songs.map((s) => s.name);
  }, FEATURE);

  registry.defineScoped(/^it includes a song titled like (.+)$/, (ctx, title) => {
    const match = ctx.songs.find((name) => name.toLowerCase().includes(title.toLowerCase()));
    if (!match) {
      throw new Error(`expected song titled like "${title}", got: ${JSON.stringify(ctx.songs)}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
