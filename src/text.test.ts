import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineText, oneLine, slugify, truncate } from "./text.ts";

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
  const rendered = inlineText("Hi @admin <img src=x> ![p](http://t) [l](x) **b**\nnext");
  assert.ok(!rendered.includes("\n"));
  assert.ok(!/@admin/.test(rendered), "mention must be broken");
  assert.ok(rendered.includes("\\<img"), "HTML must be escaped");
  assert.ok(!rendered.includes("!["));
  assert.ok(rendered.includes("\\*\\*b\\*\\*"));
});
