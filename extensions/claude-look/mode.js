'use strict';
const { workingIndicator, pickVerb } = require('./spinner.js');
const { renderHeader } = require('./header.js');
const { createWorking } = require('./working.js');

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
const lines = (produce) => ({ render: produce, invalidate() {} });

// Owns the on/compact/off state and everything that has to change when it flips.
// Renderers and the markdown transformer are registered once and read `mode()` at call time, so
// they switch without a reload. Components already drawn keep their old look until Pi redraws them.
function createLook({ initial = 'on', now = Date.now, setInterval: setTick = setInterval, clearInterval: clearTick = clearInterval } = {}) {
  let current = initial;
  let verb = pickVerb();
  let timer = null;
  const working = createWorking(now);

  function refresh(ui) {
    if (current === 'off' || !working.active()) return;
    ui.setWorkingMessage(working.text(verb));
  }

  function stopTimer() {
    if (timer) clearTick(timer);
    timer = null;
  }

  // Style the session: spinner, labels and header. 'off' hands all of it back to Pi's defaults.
  function apply(ui, ctx) {
    if (current === 'off') {
      stopTimer();
      ui.setWorkingIndicator();
      ui.setWorkingMessage();
      ui.setHiddenThinkingLabel();
      ui.setHeader(undefined);
      return;
    }
    ui.setWorkingIndicator(workingIndicator());
    ui.setHiddenThinkingLabel('✻ Thinking…');
    ui.setHeader(() => (current === 'compact'
      ? lines(() => [])
      : lines((width) => renderHeader(width, { cwd: ctx.cwd, home: process.env.HOME ?? '' }))));
    if (working.active()) refresh(ui);
    else ui.setWorkingMessage(verb);
  }

  return {
    mode: () => current,
    setMode(mode, ui, ctx) { current = mode; apply(ui, ctx); },
    apply,
    // Agent run lifecycle. Idle: the working row is hidden by Pi and the timer is stopped.
    runStart(ui) {
      working.start();
      verb = pickVerb();
      stopTimer();
      if (current === 'off') return;
      refresh(ui);
      timer = setTick(() => refresh(ui), 1000);
      if (timer && timer.unref) timer.unref();
    },
    turnStart(ui) {
      if (current === 'off') return;
      verb = pickVerb();
      refresh(ui);
    },
    messageUpdate: (message) => working.update(message),
    messageEnd: (message) => working.end(message),
    runEnd() { stopTimer(); working.stop(); },
    working,
  };
}

module.exports = { createLook, lines };
