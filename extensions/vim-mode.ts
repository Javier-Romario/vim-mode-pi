/**
 * Vim modal editor for pi.
 *
 * Install: ~/.pi/agent/extensions/vim-mode.ts  (auto-discovered), then /reload
 *
 * Normal mode:
 *   h j k l     move (logical lines, no wrap)
 *   0 $ ^       line start / line end / first non-blank
 *   w b e       word forward / backward / word end
 *   gg G        first / last line
 *   x X         delete char forward / backward
 *   dd D        delete line / delete to end of line
 *   cc C S      change line / change to end of line / change line
 *   d{motion}   delete over motion (dw, de, db, d$, d0, d^, dG)
 *   c{motion}   change over motion
 *   i a A I o O insert / append / append EOL / insert at ^ / open below / open above
 *   r{char}     replace char under cursor
 *   u           undo
 *   p           paste (yank kill ring)
 *   [count]     repeat (3j, 5w, 2dd, ...)
 *
 * Insert mode: everything passes through to the default editor.
 *   Esc -> normal mode. In normal mode, Esc aborts the agent (default behavior).
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Mode = "insert" | "normal";
type Motion = "h" | "j" | "k" | "l" | "w" | "b" | "e" | "0" | "$" | "^" | "gg" | "G";
type Operator = "d" | "c";

const WORD_RE = /[A-Za-z0-9_]/;
const MOTIONS: Motion[] = ["h", "j", "k", "l", "w", "b", "e", "0", "$", "^", "gg", "G"];

class VimEditor extends CustomEditor {
  private mode: Mode = "insert";
  private count = "";
  private pendingOp: Operator | null = null;
  private pendingG = false;
  private pendingReplace = false;

  // --- access to editor internals (not part of the public API) ---
  private st(): { lines: string[]; cursorLine: number; cursorCol: number } {
    return (this as any).state;
  }

  private setCursor(line: number, col: number): void {
    const s = this.st();
    const l = Math.max(0, Math.min(line, s.lines.length - 1));
    const text = s.lines[l] ?? "";
    s.cursorLine = l;
    s.cursorCol = Math.max(0, Math.min(col, text.length));
    (this as any).preferredVisualCol = null;
    (this as any).snappedFromCursorCol = null;
  }

  private cursorPos(): { line: number; col: number } {
    const s = this.st();
    return { line: s.cursorLine, col: s.cursorCol };
  }

  private getCount(): number {
    const n = Number.parseInt(this.count, 10);
    this.count = "";
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  private resetPending(): void {
    this.count = "";
    this.pendingOp = null;
    this.pendingG = false;
    this.pendingReplace = false;
  }

  // --- motion (mutates cursor) ---
  private moveMotion(motion: Motion, count: number): void {
    const s = this.st();
    switch (motion) {
      case "h":
        this.setCursor(s.cursorLine, s.cursorCol - count);
        break;
      case "l":
        this.setCursor(s.cursorLine, s.cursorCol + count);
        break;
      case "j":
        this.setCursor(s.cursorLine + count, s.cursorCol);
        break;
      case "k":
        this.setCursor(s.cursorLine - count, s.cursorCol);
        break;
      case "0":
        this.setCursor(s.cursorLine, 0);
        break;
      case "$":
        this.setCursor(s.cursorLine, (s.lines[s.cursorLine] ?? "").length);
        break;
      case "^": {
        const line = s.lines[s.cursorLine] ?? "";
        const m = line.match(/\S/);
        this.setCursor(s.cursorLine, m?.index ?? 0);
        break;
      }
      case "gg":
        this.setCursor(0, 0);
        break;
      case "G":
        this.setCursor(s.lines.length - 1, 0);
        break;
      case "w":
        for (let i = 0; i < count; i++) (this as any).moveWordForwards();
        break;
      case "b":
        for (let i = 0; i < count; i++) (this as any).moveWordBackwards();
        break;
      case "e":
        for (let i = 0; i < count; i++) this.moveToWordEnd();
        break;
    }
  }

  private moveToWordEnd(): void {
    (this as any).moveWordForwards();
    const s = this.st();
    const line = s.lines[s.cursorLine] ?? "";
    while (s.cursorCol < line.length - 1 && WORD_RE.test(line[s.cursorCol + 1] ?? "")) {
      s.cursorCol++;
    }
    (this as any).preferredVisualCol = null;
    (this as any).snappedFromCursorCol = null;
  }

  // --- text editing helpers ---
  private absIndex(line: number, col: number): number {
    const lines = this.st().lines;
    let idx = 0;
    for (let i = 0; i < line && i < lines.length; i++) idx += lines[i].length + 1;
    return idx + Math.max(0, Math.min(col, lines[line]?.length ?? 0));
  }

  private indexToPos(idx: number): { line: number; col: number } {
    const lines = this.st().lines;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length + 1;
      if (idx < len) return { line: i, col: idx };
      idx -= len;
    }
    const last = lines.length - 1;
    return { line: last, col: lines[last]?.length ?? 0 };
  }

  private deleteRange(p1: { line: number; col: number }, p2: { line: number; col: number }): void {
    const a = this.absIndex(p1.line, p1.col);
    const b = this.absIndex(p2.line, p2.col);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const text = this.getText();
    const removed = text.slice(lo, hi);
    if (!removed) return;

    const kr = (this as any).killRing;
    const wasKill = (this as any).lastAction === "kill";
    kr.push(removed, { prepend: b < a, accumulate: wasKill });
    (this as any).lastAction = "kill";

    this.setText(text.slice(0, lo) + text.slice(hi));
    const pos = this.indexToPos(Math.min(lo, this.getText().length));
    this.setCursor(pos.line, pos.col);
    this.requestRender();
  }

  private deleteLine(count: number): void {
    const s = this.st();
    const lines = s.lines;
    const startLine = s.cursorLine;
    const endLine = Math.min(startLine + count, lines.length);
    const removedLines = lines.slice(startLine, endLine);
    let removed = removedLines.join("\n");
    if (endLine < lines.length) removed += "\n";
    else if (startLine > 0) removed = "\n" + removed;

    (this as any).killRing.push(removed, { prepend: false, accumulate: false });
    (this as any).lastAction = "kill";

    const newLines = lines.slice(0, startLine).concat(lines.slice(endLine));
    this.setText(newLines.length > 0 ? newLines.join("\n") : "");
    const targetLine = Math.min(startLine, Math.max(0, newLines.length - 1));
    this.setCursor(targetLine, 0);
    this.requestRender();
  }

  private replaceChar(ch: string): void {
    if (ch.length !== 1 || ch.charCodeAt(0) < 32) return;
    const s = this.st();
    const lines = s.lines;
    const line = lines[s.cursorLine] ?? "";
    if (s.cursorCol < line.length) {
      (this as any).pushUndoSnapshot();
      lines[s.cursorLine] = line.slice(0, s.cursorCol) + ch + line.slice(s.cursorCol + 1);
      (this as any).lastAction = null;
      this.onChange?.(this.getText());
    }
    this.requestRender();
  }

  private openLine(dir: "below" | "above"): void {
    const s = this.st();
    if (dir === "below") {
      this.setCursor(s.cursorLine, (s.lines[s.cursorLine] ?? "").length);
      this.insertTextAtCursor("\n");
    } else {
      this.setCursor(s.cursorLine, 0);
      this.insertTextAtCursor("\n");
      this.setCursor(s.cursorLine - 1, 0);
    }
    this.enterInsert();
  }

  private enterInsert(): void {
    this.resetPending();
    this.mode = "insert";
    this.requestRender();
  }

  private isMotion(key: string): key is Motion {
    return (MOTIONS as string[]).includes(key);
  }

  private handleOperator(op: Operator, key: string): void {
    this.pendingOp = null;
    const count = this.getCount();

    // dd / cc
    if (key === "d" || key === "c") {
      this.deleteLine(count);
      if (op === "c") this.enterInsert();
      this.requestRender();
      return;
    }

    if (!this.isMotion(key)) {
      this.requestRender();
      return;
    }

    const start = this.cursorPos();
    this.moveMotion(key, count);
    this.deleteRange(start, this.cursorPos());
    if (op === "c") this.enterInsert();
    this.requestRender();
  }

  handleInput(data: string): void {
    // Escape: insert -> normal; normal -> pass through (abort agent)
    if (matchesKey(data, "escape")) {
      if (this.mode === "insert") {
        this.resetPending();
        this.mode = "normal";
        this.requestRender();
      } else {
        this.resetPending();
        super.handleInput(data);
      }
      return;
    }

    if (this.mode === "insert") {
      super.handleInput(data);
      return;
    }

    // ---- NORMAL MODE ----
    if (/^[1-9]$/.test(data)) {
      this.count += data;
      return;
    }

    if (this.pendingG) {
      this.pendingG = false;
      if (data === "g") this.moveMotion("gg", 1);
      this.requestRender();
      return;
    }

    if (this.pendingOp) {
      this.handleOperator(this.pendingOp, data);
      return;
    }

    if (this.pendingReplace) {
      this.pendingReplace = false;
      this.replaceChar(data);
      return;
    }

    // Enter in normal mode = move down (vim). Submit via i<Enter>.
    if (data === "\r" || data === "\n" || matchesKey(data, "enter")) {
      this.moveMotion("j", 1);
      this.requestRender();
      return;
    }

    // Backspace in normal mode = move left (vim), never delete.
    if (matchesKey(data, "backspace")) {
      this.moveMotion("h", 1);
      this.requestRender();
      return;
    }

    switch (data) {
      case "g":
        this.pendingG = true;
        return;
      case "h":
      case "j":
      case "k":
      case "l":
      case "w":
      case "b":
      case "e":
        this.moveMotion(data, this.getCount());
        this.requestRender();
        return;
      case "0":
      case "$":
      case "^":
      case "G":
        this.moveMotion(data, 1);
        this.requestRender();
        return;
      case "i":
        this.enterInsert();
        return;
      case "a":
        this.moveMotion("l", 1);
        this.enterInsert();
        return;
      case "A":
        this.moveMotion("$", 1);
        this.enterInsert();
        return;
      case "I":
        this.moveMotion("^", 1);
        this.enterInsert();
        return;
      case "o":
      case "O":
        this.openLine(data === "o" ? "below" : "above");
        return;
      case "x":
        for (let i = 0; i < this.getCount(); i++) (this as any).handleForwardDelete();
        this.requestRender();
        return;
      case "X":
        for (let i = 0; i < this.getCount(); i++) (this as any).handleBackspace();
        this.requestRender();
        return;
      case "D": {
        const p = this.cursorPos();
        const lineLen = (this.st().lines[p.line] ?? "").length;
        this.deleteRange(p, { line: p.line, col: lineLen });
        return;
      }
      case "C": {
        const p = this.cursorPos();
        const lineLen = (this.st().lines[p.line] ?? "").length;
        this.deleteRange(p, { line: p.line, col: lineLen });
        this.enterInsert();
        return;
      }
      case "S":
        this.deleteLine(this.getCount());
        this.enterInsert();
        return;
      case "d":
      case "c":
        this.pendingOp = data;
        return;
      case "r":
        this.pendingReplace = true;
        return;
      case "u":
        (this as any).undo();
        this.requestRender();
        return;
      case "p":
        (this as any).yank();
        this.requestRender();
        return;
    }

    // Ignore other printable chars; pass control sequences through to the app.
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const parts: string[] = [this.mode === "normal" ? "NORMAL" : "INSERT"];
    if (this.pendingOp) parts.push(this.pendingOp);
    if (this.pendingG) parts.push("g");
    if (this.count) parts.push(this.count);
    const label = ` ${parts.join(" ")} `;

    const last = lines.length - 1;
    if (visibleWidth(lines[last]!) >= label.length) {
      lines[last] = truncateToWidth(lines[last]!, width - label.length, "") + label;
    }
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, kb) => new VimEditor(tui, theme, kb));
  });
}
