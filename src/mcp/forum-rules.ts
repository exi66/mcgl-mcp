/**
 * Правила форума для агента: сжатый список запретов по «Разделу 2. Правила
 * поведения на форуме» из «Кодекса Галактики». Составлен вручную, без
 * формальностей и наказаний — так он стоит ~400 токенов вместо ~3000.
 *
 * Проверка актуальности: `pnpm rules:check` сравнивает хеш раздела на вики с
 * FORUM_RULES_SECTION_HASH. Изменились правила — пересмотреть список и обновить хеш.
 */

export const FORUM_RULES_SOURCE = "https://forum.minecraft-galaxy.ru/wiki/530";

/** sha256 (первые 16 символов) текста раздела 2, по которому составлен список. */
export const FORUM_RULES_SECTION_HASH = "de40caf9185db731";

export const FORUM_RULES = `Not allowed on the forum (posts, topics, communities, nicks, signatures, private messages):
- swearing (also masked or quoted), insults, provocation, harassment, humiliating nicknames, insulting someone's parents;
- adult content (allowed only as a video marked adult);
- sharing someone's personal data without consent;
- flood, off-topic (except chat sections), excessive caps/symbols/bbCode, necroposting old topics, over-quoting;
- links to third-party software, cracks, keys;
- sorting out personal conflicts in public (use PMs or a closed community);
- advertising anything outside the project or other similar servers; mass ads to users;
- trading game items, Gold (the in-game currency), services or accounts for real money (or inviting to Skype etc. for it); selling accounts outside the forum auction;
- sharing or using cheats, exploits, account hacking;
- topics in the wrong section or with a title that does not match the content; garish or heavy images; non-news topics in "Новости";
- garish avatars or signatures, external images in signatures;
- politics and religion;
- anything illegal under Russian law, promoting drugs;
- begging for Gold or any game or real money;
- fake or pointless support requests;
- insulting the server, administration or moderators; publicly discussing their actions or punishments (appeals only by the punished player via /requestunban/); impersonating staff; lying to staff;
- disrupting the forum (flash mobs and the like); publicly discussing event organizers.
Penalties range from a warning and a mute to bans and account blocking.`;
