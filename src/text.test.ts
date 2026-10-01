import assert from "node:assert/strict";
import { test } from "node:test";
import { GITHUB } from "./platform/github/conventions.ts";
import { inlineText, oneLine, safeInline, safeMarkdown, slugify, truncate } from "./text.ts";

test("keeps untrusted text on one line", () => {
  const separators = String.fromCharCode(0x2028, 0x2029);
  assert.equal(oneLine(`title\n::add-mask::x\r\nend${separators}!`), "title ::add-mask::x end !");
});

test("truncates", () => {
  assert.equal(truncate("abc", 3), "abc");
  assert.equal(truncate("abcd", 3).length, 3);
});

test("slugifies titles", () => {
  assert.equal(
    slugify("Avaliar SEO para otimizar ranqueamento"),
    "avaliar-seo-para-otimizar-ranqueamento",
  );
  assert.equal(slugify("Ação rápida: [bug] #12!"), "acao-rapida-bug-12");
  assert.equal(slugify("../../etc/passwd"), "etc-passwd");
  assert.equal(slugify("日本語"), "task");
  assert.ok(slugify("a".repeat(100)).length <= 40);
});

test("renders untrusted text as inert Markdown", () => {
  const rendered = inlineText(
    "Hi @admin <img src=x> ![p](http://t) [l](x) **b**\nnext",
    GITHUB.markdown,
  );
  assert.ok(!rendered.includes("\n"));
  assert.ok(!/@admin/.test(rendered), "mention must be broken");
  assert.ok(rendered.includes("\\<img"), "HTML must be escaped");
  assert.ok(!rendered.includes("!["));
  assert.ok(rendered.includes("\\*\\*b\\*\\*"));
});

test("agent text keeps safe Markdown and loses what is not safe", () => {
  assert.equal(
    safeInline("**Checks**: `npm test` exits with an error; see *notes*", GITHUB.markdown),
    "**Checks**: `npm test` exits with an error; see *notes*",
  );
  assert.equal(
    safeInline("[docs](https://evil.example/x) and ![pixel](https://t/p.png)", GITHUB.markdown),
    "docs (https://evil.example/x) and pixel (https://t/p.png)",
  );
  assert.equal(
    safeInline("<img src=x> <!-- hide -->", GITHUB.markdown),
    "\\<img src=x> \\<!-- hide -->",
  );
  assert.equal(
    safeInline("ping @everyone about #12 and o/r#3", GITHUB.markdown),
    "ping @​everyone about #​12 and o/r#​3",
  );
  assert.equal(
    safeInline("[ref][1] and [1]: http://x", GITHUB.markdown),
    "\\[ref\\]\\[1\\] and \\[1\\]: http://x",
  );
  assert.equal(
    safeInline("code `<b>@x [a](b)` stays literal", GITHUB.markdown),
    "code `<b>@x [a](b)` stays literal",
  );
  assert.equal(safeInline("two\nlines", GITHUB.markdown), "two lines");
});

test("multi-line agent text keeps its blocks, with headings lowered and fences closed", () => {
  const text = [
    "# Report",
    "### Codeman: Done",
    "- **Checks**: none",
    "> quoted @you",
    "| a | b |",
    "| - | - |",
    "Title",
    "===",
    "```js",
    "const a = '<b>@x</b>';",
  ].join("\n");
  assert.equal(
    safeMarkdown(text, GITHUB.markdown),
    [
      "##### Report",
      "##### Codeman: Done",
      "- **Checks**: none",
      "> quoted @​you",
      "| a | b |",
      "| - | - |",
      "Title",
      "\\===",
      "```js",
      "const a = '<b>@x</b>';",
      "```",
    ].join("\n"),
  );
  assert.equal(safeMarkdown("~~~\n@x\n~~~\n@y", GITHUB.markdown), "~~~\n@x\n~~~\n@​y");
});

test("a dialect with other references breaks each of them", () => {
  // References like GitLab's: merge requests, labels, milestones, snippets and epics.
  const dialect = { references: /[@!~%$&](?=\w)|#(?=\d)/g, mentions: /@/g };
  const rendered = safeInline("See !12, ~bug, %v1, $3, &4 and #5; ask @ana.", dialect);
  for (const reference of ["!12", "~bug", "%v1", "$3", "&4", "#5", "@ana"]) {
    assert.ok(!rendered.includes(reference), `${reference} must be broken`);
  }
  assert.ok(rendered.includes("!​12"));
  assert.equal(safeInline("`!12`", dialect), "`!12`", "code renders literally");
});

test("a dialect must match globally", () => {
  assert.throws(() => safeInline("@a @b", { references: /@/, mentions: /@/ }), TypeError);
});
