const SOURCE = "https://raw.githubusercontent.com/phazz1980/nutriciolog/main/ai-status.json";
let current = null;
let pending = null;
let checkedAt = 0;

export function validateAnnouncement(value, now = Date.now()) {
  if (value?.enabled !== true || typeof value.title !== "string" || !value.title.trim() ||
      value.title.length > 80 || typeof value.message !== "string" || !value.message.trim() ||
      value.message.length > 600 || (value.expiresAt !== null &&
      (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= now))) return null;
  return { title: value.title.trim(), message: value.message.trim(), expiresAt: value.expiresAt };
}

export function activeAnnouncement() {
  return current && (current.expiresAt === null || Date.parse(current.expiresAt) > Date.now()) ? current : null;
}

export async function refreshAnnouncement() {
  if (pending) return pending;
  if (Date.now() - checkedAt < 60_000) return activeAnnouncement();
  pending = (async () => {
    // Public control file outside the AI gateway; never sends auth, menu or UID.
    try {
      let received = false;
      for (const source of [SOURCE, new URL("../ai-status.json", import.meta.url).href]) {
        try {
          const response = await fetch(source + "?minute=" + Math.floor(Date.now() / 60_000), {
            cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(4_000),
          });
          if (!response.ok) throw new Error("Status unavailable");
          const text = await response.text();
          if (text.length > 4096) throw new Error("Status too large");
          current = validateAnnouncement(JSON.parse(text));
          received = true;
          break;
        } catch { /* Try the same public configuration on the website itself. */ }
      }
      if (!received) throw new Error("Status unavailable");
    } catch { /* Keep only an unexpired previously received public notice. */ }
    checkedAt = Date.now();
    console.info("[Объявление]", activeAnnouncement() ? "active" : "off");
    return activeAnnouncement();
  })();
  try { return await pending; } finally { pending = null; }
}
