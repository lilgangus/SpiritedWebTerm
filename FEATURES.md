# wasm-browser-term: features and limits

A small Ghostty-like frontend. Host PTY bytes go through `ghostty-vt.wasm`;
keystrokes, paste, focus, and mouse reports go back through the same library
and then to the PTY.

## Supported

- Ghostty-like window chrome (traffic lights, tabs, title, default `#282c34` theme)
- Floating windows: drag the titlebar, resize from the corner; tab-row `+` opens a tab (beside the last tab), titlebar `+` opens a new window
- Tab bar scrolls horizontally once tabs hit a readable minimum width; scrollbar gutter is reserved so layout does not jump
- Drag tabs to reorder, drop onto another window, or drop on the desktop to detach into a new window
- Snap left, right, corners, or full screen from the green traffic-light menu (or by dragging to an edge)
- VT parse and HTML render via libghostty-vt (`ghostty_terminal_vt_write` + HTML formatter)
- Default Ghostty palette, fg/bg/cursor colors
- Block cursor overlay, optional blink (DEC mode 12)
- OSC 0/2 window title
- Visual bell (BEL)
- PTY replies (DA, DECRQM, …) when WASM callbacks install
- Key encoding to PTY, including Ctrl+C / Ctrl+D / Ctrl+Z / arrows / function keys
- Cmd/Ctrl+C copy, Cmd/Ctrl+V paste (`ghostty_paste_encode`, bracketed paste)
- Unsafe-paste confirmation (newlines / paste terminator)
- Cmd/Ctrl+A select all, middle-click paste
- Cmd/Ctrl + / - / 0 font size
- IME composition committed as paste
- Scrollback: wheel, scrollbar (Shift+wheel still scrolls when mouse tracking is on)
- Alternate-screen mouse tracking (when the program enables it)
- Focus in/out reports (DEC mode 1004)
- Live resize of cols/rows to the window
- Manual PTY sessions: Open Terminal on first load; after `exit` / disconnect, New Terminal or View Session (read-only scrollback; Escape returns to the overlay)

## Limits

- Not the native Ghostty renderer (no GPU text, ligatures, or Kitty graphics)
- No splits, command palette, or config file
- Copy is DOM selection, not Ghostty’s cell selection gestures
- Mouse encoding depends on the WASM C ABI for positions; tracking apps may mis-hit
- No OSC 52 clipboard write, images, or URL/OSC 8 click handling
- Font is the browser stack (JetBrains Mono if installed), not Ghostty’s bundled face
- WASM effect callbacks need a growable function table; without it, DA replies and bell are skipped
- Localhost PTY only; not a remote or multi-user terminal
