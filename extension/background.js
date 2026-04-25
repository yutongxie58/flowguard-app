const DEFAULT_STATE = {
  recording: false,
  traceId: null,
  name: "Recorded Browser Workflow",
  goal: "Replay this captured browser workflow with safety checkpoints.",
  events: []
};

async function getState() {
  const data = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...data };
}

async function setState(nextState) {
  await chrome.storage.local.set(nextState);
  return getState();
}

function createTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeEvent(event) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: event.type,
    app: event.app || "",
    url: event.url || "",
    title: event.title || "",
    label: event.label || "",
    selector: event.selector || "",
    note: event.note || "",
    redacted: event.redacted !== false
  };
}

async function appendEvent(event) {
  const state = await getState();
  if (!state.recording) return state;

  const normalized = normalizeEvent(event);
  const previous = state.events[state.events.length - 1];
  const duplicate =
    previous &&
    previous.type === normalized.type &&
    previous.url === normalized.url &&
    previous.label === normalized.label &&
    Date.parse(normalized.timestamp) - Date.parse(previous.timestamp) < 1000;

  if (duplicate) return state;

  const events = [...state.events, normalized].slice(-200);
  return setState({ events });
}

async function broadcastRecordingState(recording) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url?.startsWith("http")) continue;
    chrome.tabs.sendMessage(tab.id, { type: "FLOWGUARD_RECORDING", recording }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "GET_STATE") {
      sendResponse(await getState());
      return;
    }

    if (message.type === "START_RECORDING") {
      const state = await setState({
        recording: true,
        traceId: createTraceId(),
        name: message.name || DEFAULT_STATE.name,
        goal: message.goal || DEFAULT_STATE.goal,
        events: []
      });
      await broadcastRecordingState(true);
      sendResponse(state);
      return;
    }

    if (message.type === "STOP_RECORDING") {
      const state = await setState({ recording: false });
      await broadcastRecordingState(false);
      sendResponse(state);
      return;
    }

    if (message.type === "CLEAR_TRACE") {
      const state = await setState({ events: [], traceId: null, recording: false });
      await broadcastRecordingState(false);
      sendResponse(state);
      return;
    }

    if (message.type === "TRACE_EVENT") {
      sendResponse(await appendEvent(message.event));
      return;
    }

    if (message.type === "ADD_NOTE") {
      sendResponse(await appendEvent({
        type: "note",
        note: message.note,
        url: sender.tab?.url || "",
        title: sender.tab?.title || ""
      }));
      return;
    }

    if (message.type === "SEND_TO_FLOWGUARD") {
      const state = await getState();
      const response = await fetch("http://localhost:5173/api/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.traceId || createTraceId(),
          name: state.name,
          goal: state.goal,
          createdAt: new Date().toISOString(),
          events: state.events
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send trace");
      await setState({ recording: false });
      await broadcastRecordingState(false);
      sendResponse({ ok: true, ...result });
      return;
    }
  })().catch(error => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url?.startsWith("http")) return;
  appendEvent({
    type: "page_view",
    app: new URL(tab.url).hostname.replace(/^www\./, ""),
    url: tab.url,
    title: tab.title || ""
  });
});
