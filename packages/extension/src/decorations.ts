import * as vscode from "vscode";

/**
 * Manages a decoration that marks files touched by an applied agent diff.
 * `markTouched(paths)` converts each diff path to a `vscode.Uri` and applies a
 * whole-line background + overview-ruler marker across each open editor whose
 * document matches a touched path, so added lines are visually signaled in the
 * gutter. Calling with a new set of paths implicitly clears prior editors that
 * are no longer touched; `dispose()` releases the decoration type.
 *
 * Uses the runtime `vscode` API (typecheck-only, like Task 8's panel.ts).
 */
export class DecorationManager {
  private readonly decorationType: vscode.TextEditorDecorationType;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }

  /** Mark the given file paths in the gutter of any open editor. */
  markTouched(paths: string[]): void {
    const touched = new Set(paths.map((p) => vscode.Uri.file(p).toString()));

    for (const editor of vscode.window.visibleTextEditors) {
      if (!touched.has(editor.document.uri.toString())) continue;
      const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
      editor.setDecorations(this.decorationType, [range]);
    }
  }

  /** Release the underlying decoration type. */
  dispose(): void {
    this.decorationType.dispose();
  }
}
