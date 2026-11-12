import { describe, expect, test } from "vitest";
import { load } from "../../src/forum/parsers/common.js";
import { postHtmlToText } from "../../src/forum/parsers/content.js";

/** HTML тела поста (как внутри div.post-text) → текст. */
function render(html: string): string {
  const $ = load(`<div id="post">${html}</div>`);
  return postHtmlToText($, $("#post"));
}

describe("postHtmlToText (bbCode → text)", () => {
  test("line breaks and whitespace", () => {
    expect(render("first line<br/>  second   line<br/><br/><br/><br/>third")).toBe(
      "first line\nsecond line\n\nthird",
    );
  });

  test("[quote] with and without author", () => {
    const html =
      '<div class=bc_quote><div class=bc_quote_title>Nick</b> писал(а):</div>quoted text</div>my reply' +
      "<div class=bc_quote>anonymous quote</div>";
    expect(render(html)).toBe("[quote: Nick]\nquoted text\n[/quote]\nmy reply\n[quote]\nanonymous quote\n[/quote]");
  });

  test("nested quotes", () => {
    const html =
      "<div class=bc_quote><div class=bc_quote_title>A</b> писал(а):</div>" +
      "<div class=bc_quote><div class=bc_quote_title>B</b> писал(а):</div>inner</div>outer</div>";
    expect(render(html)).toBe("[quote: A]\n\n[quote: B]\ninner\n[/quote]\nouter\n[/quote]");
  });

  test("[spoiler] and [scroll]", () => {
    const html =
      '<div class="spoler"><div class="spoler-head" onclick="switchTable(this);"><img src="/img/icon_plus.gif" class="_plus"> Hidden</div>' +
      '<div class="spoler-body">secret</div></div>' +
      '<div class="scroll"><div class="scroll-head"><img src="/img/icon_plus.gif" class="_plus"> Long</div><div class="scroll-body">body</div></div>';
    expect(render(html)).toBe("[spoiler: Hidden]\nsecret\n[/spoiler]\n\n[spoiler: Long]\nbody\n[/spoiler]");
  });

  test("[img] wrapped in a preview link; decorative images dropped", () => {
    const html =
      '<a href="https://i.mcgl.ru/abc" onclick="return false;"><img class="post-image" src="https://i.mcgl.ru/abc?p"></a>' +
      ' and <img class="post-image" src="/img/ns/6.gif"> <img src="/img/smile.gif">';
    expect(render(html)).toBe(
      "[image: https://i.mcgl.ru/abc] and [image: https://forum.minecraft-galaxy.ru/img/ns/6.gif]",
    );
  });

  test("[youtube]/[video]/[audio]", () => {
    const html =
      '<iframe src="https://www.youtube.com/embed/xyz"></iframe>' +
      '<video><source src="/files/v.mp4"></video><audio src="https://x.ru/a.mp3"></audio>';
    expect(render(html)).toBe(
      "[video: https://www.youtube.com/embed/xyz][video: https://forum.minecraft-galaxy.ru/files/v.mp4][audio: https://x.ru/a.mp3]",
    );
  });

  test("links: external, forum-relative, redirect, user links", () => {
    const html =
      '<a href="https://example.com/x">site</a>, ' +
      '<a href="/topic/24">rules</a>, ' +
      '<a target="_blank" href="/redirect/?url=https%3A%2F%2Fibb.co%2FKj">https://ibb.co/Kj</a>, ' +
      '<a href="/profilemain/1" class="user-link vip">Nick</a>, ' +
      "<a href=\"javascript: onPaste('x')\">Paste</a>";
    expect(render(html)).toBe(
      "site (https://example.com/x), rules (https://forum.minecraft-galaxy.ru/topic/24), https://ibb.co/Kj, Nick, Paste",
    );
  });

  test("[item] becomes a token for ItemResolver, with metadata", () => {
    const html =
      '<a href="/item/41"><div class="blocks-32"></div></a> and <a href="/item/35/14"><div class="blocks-32"></div></a>';
    expect(render(html).replace(/\s+/g, " ")).toBe("⟦item:41:0⟧ and ⟦item:35:14⟧");
  });

  test("[craft] grid with amounts, empty slots and legend token", () => {
    // Разметка как на форуме: слоты — td.craft-slot, результат — td > div.craft-slot.
    const item = (id: number, amount?: number) =>
      `<div class="items-bg-32"><a href="/item/${id}/0"><div class="blocks-32"></div></a>${
        amount ? `<div class="items-amount">${amount}</div>` : ""
      }</div>`;
    const slot = (id: number) => `<td class="craft-slot">${item(id)}</td>`;
    const html =
      'Recipe:<table class="craft-table">' +
      `<tr>${slot(1)}${slot(0)}<td rowspan="2" class="craft-arrow"><img src="/img/craft-arrow.png"/></td>` +
      `<td rowspan="2"><div class="craft-slot">${item(124, 4)}</div></td></tr>` +
      `<tr>${slot(1)}${slot(1)}</tr></table>`;
    expect(render(html)).toBe("Recipe:\n[craft]\n1 - -> 124x4\n1 1\n⟦legend:1:0;124:0⟧\n[/craft]");
  });

  test("[table] cells and [list] items", () => {
    const html =
      "<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>" +
      "<ul><li>one</li><li>two</li></ul>";
    expect(render(html)).toBe("H1 | H2\n\na | b\n\n- one\n\n- two");
  });

  test("scripts and styles are ignored", () => {
    expect(render("<script>alert(1)</script><style>.x{}</style>text")).toBe("text");
  });
});
