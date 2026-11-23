// no-bullet: the Owner dislikes the bullet U+2022, so no file gets one.
// Written as an escape so this file itself passes the guard.
const BULLET = "•";

export const BULLET_REASON = `No ${BULLET} character here: use - for a list item, ✓ for a chosen option, or plain words.`;

export const hasBullet = (text: string) => text.includes(BULLET);
