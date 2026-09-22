const HOTKEYS_SHORTCUT = 'f1';

function registerHotkeysShortcut(pi) {
  pi.registerShortcut(HOTKEYS_SHORTCUT, {
    description: 'Show all keyboard shortcuts',
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.setEditorText('/hotkeys');
    },
  });
}

module.exports = { registerHotkeysShortcut };
