let isRecording = false;

function appFromLocation() {
  return window.location.hostname.replace(/^www\./, "");
}

function readableText(element) {
  const aria = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const text = element.innerText || element.value || element.placeholder || "";
  return (aria || title || text || element.name || element.id || element.tagName)
    .toString()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function selectorFor(element) {
  if (element.id) return `#${element.id}`;
  const parts = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute("role");
    const dataTestId = current.getAttribute("data-testid");
    const className = String(current.className || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(name => `.${CSS.escape(name)}`)
      .join("");
    parts.unshift(`${tag}${dataTestId ? `[data-testid="${dataTestId}"]` : ""}${role ? `[role="${role}"]` : ""}${className}`);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function sendTraceEvent(event) {
  if (!isRecording) return;
  chrome.runtime.sendMessage({
    type: "TRACE_EVENT",
    event: {
      ...event,
      app: appFromLocation(),
      url: window.location.href,
      title: document.title
    }
  }).catch(() => {});
}

function isSensitiveField(element) {
  const type = (element.getAttribute("type") || "").toLowerCase();
  const name = `${element.name || ""} ${element.id || ""} ${element.placeholder || ""}`.toLowerCase();
  return ["password", "token", "secret", "key"].some(word => type.includes(word) || name.includes(word));
}

chrome.runtime.sendMessage({ type: "GET_STATE" }, state => {
  isRecording = Boolean(state?.recording);
});

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "FLOWGUARD_RECORDING") {
    isRecording = Boolean(message.recording);
  }
});

document.addEventListener("click", event => {
  const target = event.target.closest("a,button,[role='button'],input[type='submit'],input[type='button']");
  if (!target) return;

  sendTraceEvent({
    type: "click",
    label: readableText(target),
    selector: selectorFor(target),
    redacted: true
  });
}, true);

document.addEventListener("change", event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;

  const fieldType = target instanceof HTMLSelectElement ? "select" : target.type || "text";
  sendTraceEvent({
    type: "form_change",
    label: `${readableText(target)} (${fieldType})`,
    selector: selectorFor(target),
    note: isSensitiveField(target) ? "Sensitive field changed; value redacted." : "Form value changed; value redacted.",
    redacted: true
  });
}, true);
