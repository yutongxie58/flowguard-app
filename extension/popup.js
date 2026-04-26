const statusEl = document.querySelector("#status");
const countEl = document.querySelector("#event-count");
const workspaceNameEl = document.querySelector("#workspace-name");
const nameEl = document.querySelector("#name");
const goalEl = document.querySelector("#goal");
const noteEl = document.querySelector("#note");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const sendButton = document.querySelector("#send");
const clearButton = document.querySelector("#clear");
const noteButton = document.querySelector("#note-button");
const syncWorkspaceButton = document.querySelector("#sync-workspace");

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function render(state) {
  statusEl.textContent = state.recording ? "Recording browser workflow" : "Idle";
  countEl.textContent = state.events?.length || 0;
  const hasWorkspace = Boolean(state.session?.workspace?.id);
  workspaceNameEl.textContent = hasWorkspace ? state.session.workspace.name : "Not connected";
  workspaceNameEl.dataset.connected = hasWorkspace ? "true" : "false";
  syncWorkspaceButton.textContent = hasWorkspace ? "Resync" : "Sign in";
  nameEl.value = state.name || nameEl.value;
  goalEl.value = state.goal || goalEl.value;
  startButton.disabled = state.recording;
  stopButton.disabled = !state.recording;
  sendButton.disabled = !state.events?.length;
}

async function refresh() {
  statusEl.textContent = "Syncing FlowGuard workspace...";
  const state = await sendMessage({ type: "GET_STATE" });
  render(state);
  if (!state.session?.workspace?.id) {
    statusEl.textContent = "Click Sign in to connect a workspace";
  }
}

syncWorkspaceButton.addEventListener("click", async () => {
  const isConnected = workspaceNameEl.dataset.connected === "true";
  statusEl.textContent = isConnected ? "Checking FlowGuard sign-in..." : "Opening FlowGuard sign-in...";
  const state = await sendMessage({
    type: isConnected ? "REFRESH_FLOWGUARD_SESSION" : "OPEN_FLOWGUARD_SIGNIN"
  });
  render(state);
  statusEl.textContent = state.session?.workspace?.id
    ? "Workspace synced"
    : "Sign in to FlowGuard, then reopen this popup";
});

startButton.addEventListener("click", async () => {
  statusEl.textContent = "Syncing FlowGuard workspace...";
  const state = await sendMessage({
    type: "START_RECORDING",
    name: nameEl.value,
    goal: goalEl.value
  });
  render(state);
});

stopButton.addEventListener("click", async () => {
  render(await sendMessage({ type: "STOP_RECORDING" }));
});

clearButton.addEventListener("click", async () => {
  render(await sendMessage({ type: "CLEAR_TRACE" }));
});

noteButton.addEventListener("click", async () => {
  const note = noteEl.value.trim();
  if (!note) return;
  const state = await sendMessage({ type: "ADD_NOTE", note });
  noteEl.value = "";
  render(state);
});

sendButton.addEventListener("click", async () => {
  statusEl.textContent = "Sending to FlowGuard...";
  const result = await sendMessage({ type: "SEND_TO_FLOWGUARD" });
  if (!result.ok) {
    statusEl.textContent = result.error || "Send failed";
    return;
  }
  statusEl.textContent = "Sent. Refresh FlowGuard.";
  chrome.tabs.create({ url: `http://localhost:5173/?workflow=${result.workflow.id}` });
});

refresh();
