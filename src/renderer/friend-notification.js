"use strict";

const toast = document.getElementById("friendToast");
const background = document.getElementById("friendToastBackground");
const title = document.getElementById("friendToastTitle");
const names = document.getElementById("friendToastNames");
const others = document.getElementById("friendToastOthers");

function copyFor(locale, count, remaining) {
  const translate = (key, fallback) => window.matchOverlayI18n?.t?.(key, locale) ?? fallback;
  const titleKey = count === 1 ? "friendOnlineSingle" : "friendOnlineMultiple";
  return {
    title: translate(titleKey, count === 1 ? "FRIEND ONLINE" : "{count} FRIENDS ONLINE")
      .replace("{count}", String(count)),
    others: translate("friendOnlineOthers", "{count} MORE ONLINE")
      .replace("{count}", String(remaining)),
  };
}

function htmlLanguage(locale) {
  return ({
    "ja-jp": "ja-JP", "es-es": "es-ES", "es-us": "es-US", "ko-kr": "ko-KR",
    "zh-hans": "zh-Hans", "zh-hant": "zh-Hant", "pt-br": "pt-BR",
  })[locale] || locale;
}

function render(payload = {}) {
  const visibleNames = Array.isArray(payload.names)
    ? payload.names.slice(0, 2).map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const count = Math.max(visibleNames.length, Math.trunc(Number(payload.count) || 0));
  const remaining = Math.max(0, count - visibleNames.length);
  const localeApi = window.matchOverlayI18n;
  const locale = String(payload.locale || localeApi?.getLocale?.() || "en");
  localeApi?.applyTranslations?.(document, locale);
  const copy = copyFor(locale, count, remaining);
  const backgroundOpacity = Math.min(
    1,
    Math.max(0, Number(payload.backgroundOpacity ?? 0.94)),
  );
  background.style.opacity = String(backgroundOpacity);
  document.documentElement.lang = htmlLanguage(locale);
  title.textContent = copy.title;
  names.replaceChildren(...visibleNames.map((name) => {
    const row = document.createElement("div");
    row.className = "name";
    row.textContent = name;
    return row;
  }));
  others.textContent = copy.others;
  others.classList.toggle("hidden", remaining === 0);
  toast.classList.toggle("visible", payload.phase !== "leaving");
  toast.classList.toggle("leaving", payload.phase === "leaving");
}

window.friendNotification?.onPayload(render);
