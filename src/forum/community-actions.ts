import { ForumError } from "./errors.js";
import { actionLink, parseCommunity } from "./parsers/community.js";
import type { PlayerSession } from "./player-session.js";
import { site } from "./site.js";
import type { Community } from "./types.js";

/**
 * Вступить в сообщество или выйти из него от имени игрока.
 *
 * На главной сообщества кнопка — ссылка `GET /hmain/N/join?_h=<токен>`
 * (или `/leave?_h=`). Токен берётся со свежей страницы. Без заголовка Referer
 * форум молча отвечает пустой страницей и ничего не делает. Успех — 302 на
 * /hmain/N; результат проверяем повторной загрузкой страницы.
 *
 * Возвращает карточку сообщества после действия (без описания).
 */
export async function changeMembership(
  session: PlayerSession,
  communityId: number,
  action: "join" | "leave",
): Promise<Omit<Community, "description">> {
  return session.withAuth(async () => {
    const before = await session.getAuthed(site.community(communityId));
    const state = parseCommunity(before, communityId);

    if (action === "join") {
      if (state.membership === "member") return withoutDescription(state);
      if (state.membership === "blocked") {
        throw new ForumError(`Cannot join "${state.name}": ${state.joinBlockedReason}`);
      }
      if (state.membership === "closed") {
        throw new ForumError(
          `"${state.name}" is a closed community: joining is by application or by invitation (an invitation comes as a system private message; then the join button appears)`,
        );
      }
    } else if (state.membership !== "member") {
      throw new ForumError(`You are not a member of "${state.name}"`);
    }

    const href = actionLink(before, action);
    if (!href) throw new ForumError(`The forum did not offer a ${action} button for "${state.name}"`);
    await session.http.get(href, { referer: session.http.absoluteUrl(site.community(communityId)) });

    const after = parseCommunity(await session.getAuthed(site.community(communityId)), communityId);
    const expected = action === "join" ? "member" : "can_join";
    if (action === "join" ? after.membership !== "member" : after.membership === "member") {
      throw new ForumError(
        `The forum did not confirm ${action} for "${state.name}" (now: ${after.membership}, expected: ${expected})`,
      );
    }
    return withoutDescription(after);
  });
}

function withoutDescription(c: Community): Omit<Community, "description"> {
  const { description: _description, ...rest } = c;
  return rest;
}
