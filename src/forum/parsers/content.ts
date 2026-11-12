import { itemToken, legendToken } from "../objects.js";
import { absUrl, type Doc, type Node } from "./common.js";

/** "/item/41" → [41, 0], "/item/35/14" → [35, 14]. */
function itemFromHref(href: string | undefined): [number, number] | undefined {
  const m = /^\/item\/(\d+)(?:\/(\d+))?/.exec(href ?? "");
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined;
}

/**
 * HTML тела поста → читаемый текст для агента.
 *
 * - <br>, блоки → переводы строк;
 * - цитаты (`.bc_quote`) → `[quote: ник] … [/quote]`;
 * - спойлеры и свёртки (`.spoler`, `.scroll`) → `[spoiler: заголовок] … [/spoiler]`;
 * - картинки `.post-image` → `[image: url]`, iframe/video/audio → `[video: url]`/`[audio: url]`;
 * - предметы игры (`/item/N`, внутри только иконка) → маркер, который ItemResolver
 *   заменит на `[Золотой блок #41]`; окна крафта → сетка id с легендой названий;
 * - внешние ссылки → `текст (url)`, редиректы форума раскрываются;
 * - ники (`a.user-link`) остаются просто ником.
 */
export function postHtmlToText($: Doc, el: Node): string {
  const node = el.clone();
  node.find("script, style, img._plus").remove();

  // <div class=bc_quote><div class=bc_quote_title>Ник писал(а):</div>текст…</div>
  node.find(".bc_quote").each((_, block) => {
    const b = $(block);
    const title = b.children(".bc_quote_title").first();
    const who = title
      .text()
      .replace(/\s*писал\(а\):\s*$/, "")
      .trim();
    title.remove();
    b.prepend(`\n[quote${who ? `: ${who}` : ""}]\n`).append("\n[/quote]\n");
    b.replaceWith(b.contents());
  });

  node.find(".spoler, .scroll").each((_, block) => {
    const b = $(block);
    const head = b.children(".spoler-head, .scroll-head").first().text().trim();
    const body = b.children(".spoler-body, .scroll-body").first();
    body.prepend(`\n[spoiler: ${head}]\n`).append("\n[/spoiler]\n");
    b.replaceWith(body.contents());
  });

  node.find("img.post-image").each((_, img) => {
    const src = $(img).attr("src") ?? "";
    // Картинка обычно обёрнута в ссылку на оригинал: заменяем всю ссылку.
    const wrapper = $(img).parent("a");
    const marker = `[image: ${absUrl(src.replace(/\?p$/, ""))}]`;
    (wrapper.length ? wrapper : $(img)).replaceWith(marker);
  });
  node.find("img").remove();

  // [youtube], [coub], [vimeo] → iframe; [video], [audio] → <video>/<audio> c src или <source>.
  node.find("iframe, video, audio").each((_, f) => {
    const m = $(f);
    const src = m.attr("src") ?? m.find("source[src]").first().attr("src") ?? "";
    const kind = f.tagName === "audio" ? "audio" : "video";
    m.replaceWith(src ? `[${kind}: ${absUrl(src)}]` : "");
  });

  // [craft], [procraft], [forge], [furnace], [design]: сетка слотов `table.craft-table`.
  // Рендерим построчно id предметов ("-" — пустой слот, "->" — стрелка к результату,
  // "x4" — количество) и легенду с названиями (её раскрывает ItemResolver).
  // Только ASCII: так дешевле в токенах.
  node.find("table.craft-table").each((_, table) => {
    const used: [number, number][] = [];
    const rows = $(table)
      .find("tr")
      .map((_, tr) =>
        $(tr)
          .children("td")
          .map((_, td) => {
            const cell = $(td);
            if (cell.hasClass("craft-arrow")) return "->";
            const item = itemFromHref(cell.find('a[href^="/item/"]').first().attr("href"));
            if (!item || item[0] === 0) return "-";
            if (!used.some(([i, m]) => i === item[0] && m === item[1])) used.push(item);
            const label = item[1] ? `${item[0]}:${item[1]}` : String(item[0]);
            const amount = cell.find(".items-amount").first().text().trim();
            return amount ? `${label}x${amount}` : label;
          })
          .get()
          .join(" "),
      )
      .get();
    $(table).replaceWith(`\n[craft]\n${rows.join("\n")}\n${legendToken(used)}\n[/craft]\n`);
  });

  // [table]: ячейки через " | ", строки с новой строки.
  node.find("td, th").each((_, cell) => {
    if ($(cell).next("td, th").length) $(cell).append(" | ");
  });
  // [list], [listn]
  node.find("li").each((_, li) => {
    $(li).prepend("- ");
  });

  node.find("a[href]").each((_, a) => {
    const $a = $(a);
    let href = $a.attr("href") ?? "";
    const label = $a.text().trim();

    if ($a.hasClass("user-link") || href.startsWith("javascript")) {
      $a.replaceWith(label);
      return;
    }
    const item = itemFromHref(href);
    if (item && !label) {
      $a.replaceWith(item[0] ? itemToken(item[0], item[1]) : "");
      return;
    }
    const redirect = /^\/redirect\/\?url=(.+)$/.exec(href);
    if (redirect) href = decodeURIComponent(redirect[1]);
    href = absUrl(href);
    $a.replaceWith(!label || label === href ? href : `${label} (${href})`);
  });

  node.find("br").replaceWith("\n");
  node.find("div, p, li, tr, hr, pre").each((_, b) => {
    $(b).prepend("\n").append("\n");
  });

  return node
    .text()
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
