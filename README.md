# vim-mode-pi

Vim modal editing for pi's TUI input. Normal + insert modes, motions, operators, counts, undo, kill-ring paste.

## Install

From npm:

```bash
pi install npm:vim-mode-pi
```

Pin a version:

```bash
pi install npm:vim-mode-pi@0.1.0
```

Or install from git / local path:

```bash
pi install git:github.com/Javier-Romario/vim-mode-pi@v0.1.0
pi install ./path/to/vim-mode-pi   # dev
```

Then `/reload` (or restart pi).

To try without installing:

```bash
pi -e npm:vim-mode-pi
```

## Modes

- **Normal** — default for navigation/editing. `Esc` here aborts the agent (pi default).
- **Insert** — passes through to the default editor. `Esc` returns to normal.

## Keys

| Key | Action |
|-----|--------|
| `h` `j` `k` `l` | move (logical lines, no wrap) |
| `0` `$` `^` | line start / end / first non-blank |
| `w` `b` `e` | word forward / backward / word end |
| `gg` `G` | first / last line |
| `x` `X` | delete char forward / backward |
| `dd` `D` | delete line / delete to EOL |
| `cc` `C` `S` | change line / change to EOL / change line |
| `d{motion}` `c{motion}` | delete/change over motion (`dw de db d$ d0 d^ dG`) |
| `i a A I o O` | insert / append / append EOL / insert at `^` / open below / open above |
| `r{char}` | replace char under cursor |
| `u` | undo |
| `p` | paste (yank kill ring) |
| `[count]` | repeat (`3j`, `5w`, `2dd`, ...) |

In normal mode, `Enter` moves down (vim). Submit via `i` then `Enter`.

## Notes

- Depends on pi-bundled packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`); declared as `peerDependencies`.
- Uses pi editor internals not in the public API. May break across pi releases.
