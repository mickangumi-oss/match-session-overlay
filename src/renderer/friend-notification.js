"use strict";

const toast = document.getElementById("friendToast");
const background = document.getElementById("friendToastBackground");
const title = document.getElementById("friendToastTitle");
const names = document.getElementById("friendToastNames");
const others = document.getElementById("friendToastOthers");

function copyFor(locale, count, remaining) {
  if (locale === "ja-jp") {
    return {
      title: count === 1 ? "フレンドがオンライン" : `${count}人のフレンドがオンライン`,
      others: `ほか${remaining}人がオンライン`,
    };
  }
  return {
    title: count === 1 ? "FRIEND ONLINE" : `${count} FRIENDS ONLINE`,
    others: `${remaining} MORE ONLINE`,
  };
}

function render(payload = {}) {
  const visibleNames = Array.isArray(payload.names)
    ? payload.names.slice(0, 2).map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const count = Math.max(visibleNames.length, Math.trunc(Number(payload.count) || 0));
  const remaining = Math.max(0, count - visibleNames.length);
  const copy = copyFor(String(payload.locale || "en"), count, remaining);
  const backgroundOpacity = Math.min(
    1,
    Math.max(0, Number(payload.backgroundOpacity ?? 0.94)),
  );
  background.style.opacity = String(backgroundOpacity);
  document.documentElement.lang = payload.locale === "ja-jp" ? "ja" : "en";
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
