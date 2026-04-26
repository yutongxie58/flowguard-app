function isTypingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

function clickAction(action) {
  const button = document.querySelector(`[data-action="${action}"]`);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

function activeWorkflowIndex(items) {
  const index = items.findIndex(item => item.classList.contains("active"));
  return index === -1 ? 0 : index;
}

function switchWorkflow(direction) {
  const items = [...document.querySelectorAll("[data-action='select-workflow']")];
  if (!items.length) return false;
  const nextIndex = (activeWorkflowIndex(items) + direction + items.length) % items.length;
  items[nextIndex].click();
  items[nextIndex].focus({ preventScroll: false });
  return true;
}

function focusInstruction() {
  const instruction = document.querySelector("[data-role='instruction']");
  if (!instruction) return clickAction("edit");
  instruction.focus();
  instruction.select();
  return true;
}

document.addEventListener("keydown", event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  const key = event.key.toLowerCase();
  const handled = {
    r: () => clickAction("run"),
    a: () => clickAction("approve"),
    x: () => clickAction("reject"),
    e: () => focusInstruction(),
    "?": () => clickAction("why"),
    arrowdown: () => switchWorkflow(1),
    arrowright: () => switchWorkflow(1),
    arrowup: () => switchWorkflow(-1),
    arrowleft: () => switchWorkflow(-1)
  }[key]?.();

  if (handled) event.preventDefault();
});
