import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("renders headings, emphasis, lists, and tables as markup", () => {
    expect(renderMarkdown("## Title")).toContain("<h2>Title</h2>");
    expect(renderMarkdown("**bold** and `inline`")).toContain(
      "<strong>bold</strong>",
    );
    expect(renderMarkdown("- one\n- two")).toContain("<li>one</li>");
    expect(renderMarkdown("| a |\n| - |\n| 1 |")).toContain("<table>");
  });

  it("escapes model-authored HTML instead of parsing it", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">\n\n<b>no</b>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
  });

  it("gives fenced blocks a language label and a copy button", () => {
    const html = renderMarkdown('```ts\nconst a = "<b>";\n```');
    expect(html).toContain('<span class="dsh-code-lang">ts</span>');
    expect(html).toContain('class="dsh-code-copy"');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("&lt;b&gt;");
  });

  it("gives indented code blocks the same copy affordance", () => {
    const html = renderMarkdown("    indented();");
    expect(html).toContain('class="dsh-code-copy"');
    expect(html).toContain("indented();");
  });

  it("renders an unterminated fence, as produced mid-stream", () => {
    const html = renderMarkdown("Here:\n```js\nconst x = 1;");
    expect(html).toContain("const x = 1;");
    expect(html).toContain('<span class="dsh-code-lang">js</span>');
  });

  it("linkifies bare URLs and keeps explicit links", () => {
    expect(renderMarkdown("see https://example.com/x")).toContain(
      '<a href="https://example.com/x">',
    );
    expect(renderMarkdown("[docs](https://example.com)")).toContain(
      ">docs</a>",
    );
  });

  it("leaves a script-scheme link as inert text with no anchor", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href");
  });

  it("refuses a script-scheme image without emitting a link", () => {
    const html = renderMarkdown("![x](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("x");
  });

  it("renders images as links so the webview fetches nothing", () => {
    const html = renderMarkdown("![diagram](https://tracker.test/p?d=secret)");
    expect(html).not.toContain("<img");
    expect(html).toContain('class="dsh-md-image"');
    expect(html).toContain(">diagram</a>");
    expect(html).toContain("https://tracker.test/p?d=secret");
  });

  it("labels an image with its source when the alt text is empty", () => {
    expect(renderMarkdown("![](https://example.com/a.png)")).toContain(
      ">https://example.com/a.png</a>",
    );
  });
});
