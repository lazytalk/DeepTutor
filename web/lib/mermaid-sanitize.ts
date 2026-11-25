/**
 * Quote mindmap node labels containing shape-syntax characters.
 *
 * Mermaid's mindmap parser reads `(`, `[`, `{` in bare labels as node shape
 * delimiters, so `f'(c) equals ...` fails to parse. Wrapping such labels in the
 * quoted square-bracket form keeps them literal; already-shaped nodes
 * (`root((...))`, `id[...]`) are left untouched. Mirrors the backend sanitizer
 * in deeptutor/agents/visualize/utils.py.
 */
const SHAPED = /^[A-Za-z0-9_-]*[(\[{]/;

export function sanitizeMindmapLabels(source: string): string {
  if (!source.trimStart().startsWith("mindmap")) return source;
  return source
    .split("\n")
    .map((line) => {
      const match = /^(\s*)(\S.*)$/.exec(line);
      if (!match) return line;
      const [, indent, text] = match;
      if (text.startsWith("mindmap") || SHAPED.test(text)) return line;
      if (/[()\[\]{}]/.test(text)) {
        return `${indent}["${text.replace(/"/g, '\\"')}"]`;
      }
      return line;
    })
    .join("\n");
}
