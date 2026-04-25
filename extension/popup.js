const statusEl = document.querySelector("#status");
const countEl = document.querySelector("#event-count");
const nameEl = document.querySelector("#name");
const goalEl = document.querySelector("#goal");
const noteEl = document.querySelector("#note");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const sendButton = document.querySelector("#send");
const clearButton = document.querySelector("#clear");
const noteButton = document.querySelector("#note-button");

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function render(state) {
  statusEl.textContent = state.recording ? "Recording browser workflow" : "Idle";
  countEl.textContent = state.events?.length || 0;
  nameEl.value = state.name || nameEl.value;
  goalEl.value = state.goal || goalEl.value;
  startButton.disabled = state.recording;
  stopButton.disabled = !state.recording;
  sendButton.disabled = !state.events?.length;
}

async function refresh() {
  render(await sendMessage({ type: "GET_STATE" }));
}

startButton.addEventListener("click", async () => {
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
