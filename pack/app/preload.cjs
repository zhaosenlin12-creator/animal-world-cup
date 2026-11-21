// Mark the renderer as a desktop shell. The game reads window.__desktop to
// stay in keyboard mode instead of mistaking Electron's maxTouchPoints>0 for a
// touchscreen (which would enable virtual controls and swallow keyboard input).
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("__desktop", true);
