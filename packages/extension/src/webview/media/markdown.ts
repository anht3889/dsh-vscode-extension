import createMarkdownIt, {
  type MarkdownIt,
  type RendererRule,
} from "markdown-it";

/**
 * Assistant markdown renderer.
 *
 * `html: false` is the safety property: model-authored raw HTML is escaped as
 * text rather than parsed, so nothing the model writes becomes markup in the
 * webview. Emphasis, headings, lists, tables, and fences follow CommonMark, and
 * `linkify` promotes bare URLs, matching the editor's markdown preview.
 */
const md: MarkdownIt = createMarkdownIt({ html: false, linkify: true });

/** The class the webview delegates code-copy clicks from. */
export const COPY_BUTTON_CLASS = "dsh-code-copy";

/**
 * Render one code block with a language label and a copy affordance.
 * @param code - verbatim block contents.
 * @param lang - info-string language, or the empty string for indented blocks.
 * @returns the block's HTML, with `code` escaped.
 */
function renderCode(code: string, lang: string): string {
  const escapedLang = md.utils.escapeHtml(lang);
  const classAttr = lang === "" ? "" : ` class="language-${escapedLang}"`;
  return (
    `<div class="dsh-code">` +
    `<div class="dsh-code-head">` +
    `<span class="dsh-code-lang">${escapedLang}</span>` +
    `<button type="button" class="${COPY_BUTTON_CLASS}" aria-label="Copy code">Copy</button>` +
    `</div>` +
    `<pre><code${classAttr}>${md.utils.escapeHtml(code)}</code></pre>` +
    `</div>\n`
  );
}

const fence: RendererRule = (tokens, idx) => {
  const token = tokens[idx];
  if (token === undefined) return "";
  const info = token.info.trim();
  return renderCode(token.content, info === "" ? "" : (info.split(/\s+/)[0] ?? ""));
};

const codeBlock: RendererRule = (tokens, idx) => {
  const token = tokens[idx];
  return token === undefined ? "" : renderCode(token.content, "");
};

/**
 * Render an image reference as a link instead of an `<img>`.
 *
 * The webview's CSP admits images only from the extension's own resource origin,
 * and a model-authored remote image URL is an exfiltration channel: the request
 * itself carries whatever the model put in the query. A link states the same
 * information without the webview fetching anything.
 */
const image: RendererRule = (tokens, idx) => {
  const token = tokens[idx];
  if (token === undefined) return "";
  const src = String(token.attrGet("src") ?? "");
  const label = md.utils.escapeHtml(token.content === "" ? src : token.content);
  if (!md.validateLink(src)) return label;
  const href = md.utils.escapeHtml(md.normalizeLink(src));
  return `<a class="dsh-md-image" href="${href}" title="Image (opens externally)">${label}</a>`;
};

md.renderer.rules.fence = fence;
md.renderer.rules.code_block = codeBlock;
md.renderer.rules.image = image;

/**
 * Render assistant markdown to HTML for the transcript.
 * @param source - markdown text, possibly a partially streamed document.
 * @returns HTML safe to inject: no raw HTML survives and code is escaped.
 */
export function renderMarkdown(source: string): string {
  return md.render(source);
}
