const state = {
  workflows: [],
  memory: null,
  health: null,
  session: JSON.parse(localStorage.getItem("flowguardSession") || "null"),
  authMode: "signin",
  selectedWorkflowId: new URLSearchParams(window.location.search).get("workflow") || "design-to-pr",
  execution: null,
  teachOpen: false,
  manageOpen: false,
  runRequest: "",
  instructionDraft: ""
};

const app = document.querySelector("#app");

const icons = {
  run: "▶",
  approve: "✓",
  reject: "×",
  edit: "✎",
  why: "?",
  signOut: "⇥"
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(state.session?.workspace?.id ? { "X-Workspace-Id": state.session.workspace.id } : {}),
      ...(state.session?.user?.email ? { "X-User-Email": state.session.user.email } : {})
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

function syncRecorderSession() {
  fetch("/api/recorder/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: state.session })
  }).catch(() => {});
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Not run yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function getSelectedWorkflow() {
  return state.workflows.find(workflow => workflow.id === state.selectedWorkflowId) || state.workflows[0];
}

function getActiveCheckpoint(workflow) {
  if (!workflow || !state.execution?.currentCheckpointId) return null;
  return workflow.checkpoints.find(checkpoint => checkpoint.id === state.execution.currentCheckpointId);
}

function getInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || "")
    .join("") || "FG";
}

function isWeeklyReportWorkflow(workflow) {
  return workflow?.baseTemplateId === "weekly-report"
    || workflow?.id === "weekly-report"
    || workflow?.template?.toLowerCase().includes("weekly report");
}

function render() {
  if (!state.session) {
    renderSignIn();
    return;
  }

  const workflow = getSelectedWorkflow();
  const activeCheckpoint = getActiveCheckpoint(workflow);
  const totalCheckpoints = workflow?.checkpoints?.length || 0;
  const highRisk = workflow?.checkpoints?.filter(checkpoint => checkpoint.risk === "high").length || 0;

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">FG</div>
          <div>
            <h1>FlowGuard</h1>
            <p>Teach once. Replay safely.</p>
          </div>
        </div>
        <div class="topbar-right">
          <div class="top-actions">
            <button class="button secondary" data-action="refresh">Sync recorder</button>
            <button class="button secondary" data-action="toggle-manage">${state.manageOpen ? "Close manager" : "Manage workflow"}</button>
            <button class="button secondary" data-action="toggle-teach">${state.teachOpen ? "Close recorder" : "Teach workflow"}</button>
            <button class="button" data-action="run">${icons.run} Run Workflow</button>
          </div>
          <div class="account-menu" aria-label="Account">
            <div class="profile-avatar" aria-hidden="true">${escapeHtml(getInitials(state.session.user.name))}</div>
            <div class="account-chip">
              <strong>${escapeHtml(state.session.user.name)}</strong>
              <span>${escapeHtml(state.session.workspace.name)}</span>
            </div>
            <button class="icon-button" data-action="sign-out" aria-label="Sign out" title="Sign out">${icons.signOut}</button>
          </div>
        </div>
      </header>

      <main class="main">
        <section class="hero">
          <div class="hero-copy">
            <p class="eyebrow">Human workflow recorder + checkpointed agent replay</p>
            <h2>Teach agents how your team works, then let them <span>pause before risky steps.</span></h2>
            <p class="hero-text">FlowGuard records professional toil, converts it into a multi-agent workflow, and inserts approval checkpoints before shared-code changes, team messages, deploys, and other high-impact actions.</p>
            <div class="metrics-strip">
              <div class="metric"><strong>${workflow?.recordedSteps?.length || 0}</strong><span>recorded steps</span></div>
              <div class="metric"><strong>${totalCheckpoints}</strong><span>safety checkpoints</span></div>
              <div class="metric"><strong>${highRisk}</strong><span>high-risk pauses</span></div>
            </div>
          </div>
          <aside class="demo-panel">
            <h3>Multi-agent execution</h3>
            ${renderPlannerStatus()}
            <div class="agent-grid">
              ${(workflow?.agents || []).map(agent => `
                <div class="agent-row">
                  <div class="agent-icon">${escapeHtml(agent.name.slice(0, 1))}</div>
                  <div>
                    <strong>${escapeHtml(agent.name)}</strong>
                    <span>${escapeHtml(agent.role)}</span>
                  </div>
                  <div class="confidence">${agent.confidence}%</div>
                </div>
              `).join("")}
            </div>
          </aside>
        </section>

        ${state.teachOpen ? renderTeachForm() : ""}

        <section class="workspace">
          <aside class="column surface">
            <div class="surface-header">
              <h3 class="section-title">Recorded workflows</h3>
            </div>
            <div class="surface-body">
              ${renderMemoryPanel()}
              <div class="workflow-list">
                ${state.workflows.map(item => `
                  <button class="workflow-item ${item.id === workflow?.id ? "active" : ""}" data-action="select-workflow" data-id="${escapeHtml(item.id)}">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>${escapeHtml(item.tagline)}</span>
                    <div class="pill-row">
                      <span class="pill">${escapeHtml(item.status)}</span>
                      <span class="pill low">${formatDate(item.lastRun)}</span>
                    </div>
                  </button>
                `).join("")}
              </div>
            </div>
          </aside>

          <section class="column surface">
            <div class="surface-header">
              <div>
                <h3 class="section-title">${escapeHtml(workflow?.name || "Workflow")}</h3>
                <p class="step-detail">${escapeHtml(workflow?.goal || "")}</p>
              </div>
              <button class="button" data-action="run">${icons.run} Run</button>
            </div>
            <div class="surface-body">
              ${renderRunRequest(workflow)}
              <h3 class="card-title">Recorded human workflow</h3>
              <div class="steps" style="margin-top: 12px;">
                ${(workflow?.recordedSteps || []).map(step => `
                  <article class="step-card">
                    <div class="step-top">
                      <div>
                        <div class="step-title">${escapeHtml(step.title)}</div>
                        <p class="step-detail">${escapeHtml(step.detail)}</p>
                      </div>
                      <div class="pill-row">
                        <span class="pill">${escapeHtml(step.source || "workflow")}</span>
                        <span class="pill ${escapeHtml(step.risk)}">${escapeHtml(step.risk)}</span>
                        ${step.judgment ? `<span class="pill medium">judgment</span>` : ""}
                      </div>
                    </div>
                  </article>
                `).join("")}
              </div>

              <h3 class="card-title" style="margin-top: 18px;">Agent execution timeline</h3>
              <div class="timeline" style="margin-top: 12px;">
                ${renderTimeline(workflow)}
              </div>
            </div>
          </section>

          <aside class="column surface">
            <div class="surface-header">
              <h3 class="section-title">Checkpoint approval</h3>
              ${state.execution ? `<span class="pill ${state.execution.status === "failed" ? "high" : "medium"}">${escapeHtml(state.execution.status.replaceAll("_", " "))}</span>` : `<span class="pill">idle</span>`}
            </div>
            <div class="surface-body">
              ${state.manageOpen ? renderWorkflowManager(workflow) : ""}
              ${renderCheckpointPanel(workflow, activeCheckpoint)}
            </div>
          </aside>
        </section>
      </main>
    </div>
  `;
}

function renderSignIn() {
  const isSignup = state.authMode === "signup";

  app.innerHTML = `
    <main class="signin-page">
      <section class="signin-panel">
        <div class="brand">
          <div class="brand-mark">FG</div>
          <div>
            <h1>FlowGuard</h1>
            <p>Workspace sign-in</p>
          </div>
        </div>
        <h2>${isSignup ? "Create your workspace." : "Welcome back."}</h2>
        <p class="hero-text">${isSignup ? "Set up an account for your team's workflow library, checkpoint decisions, and execution history." : "Sign in to your FlowGuard workspace."}</p>
        <div class="auth-tabs">
          <button class="${!isSignup ? "active" : ""}" data-action="auth-mode" data-mode="signin">Sign in</button>
          <button class="${isSignup ? "active" : ""}" data-action="auth-mode" data-mode="signup">Sign up</button>
        </div>
        <form class="teach-form" data-form="${isSignup ? "signup" : "signin"}">
          ${isSignup ? `
            <div class="field">
              <label for="auth-name">Name</label>
              <input id="auth-name" name="name" placeholder="Example: Alex Chen" />
            </div>
          ` : ""}
          <div class="field">
            <label for="auth-email">Email</label>
            <input id="auth-email" name="email" type="email" placeholder="alex@company.com" />
          </div>
          <div class="field">
            <label for="auth-password">Password</label>
            <div class="password-field">
              <input id="auth-password" name="password" type="password" placeholder="At least 6 characters" />
              <button class="button secondary" type="button" data-action="toggle-password">Show</button>
            </div>
          </div>
          ${isSignup ? `
            <div class="field">
              <label for="auth-workspace">Workspace</label>
              <input id="auth-workspace" name="workspaceName" placeholder="Example: Design Systems Team" />
            </div>
          ` : ""}
          <button class="button" type="submit">${isSignup ? "Create account" : "Sign in"}</button>
        </form>
      </section>
    </main>
  `;
}

function renderRunRequest(workflow) {
  if (!workflow) return "";
  if (isWeeklyReportWorkflow(workflow)) {
    const inputs = workflow.inputs || {};
    return `
      <section class="run-request weekly-report-inputs">
        <div class="run-request-copy">
          <strong>Weekly report inputs</strong>
          <p class="step-detail">FlowGuard will pull GitHub activity, combine it with your notes, and pause before sending.</p>
        </div>
        <div class="weekly-grid">
          <div class="field">
            <label for="weekly-repo">GitHub repo</label>
            <input id="weekly-repo" data-weekly-input="repo" value="${escapeHtml(inputs.repo || "")}" placeholder="owner/repo" />
          </div>
          <div class="field">
            <label for="weekly-range">Date range</label>
            <select id="weekly-range" data-weekly-input="dateRange">
              <option value="this-week" ${(inputs.dateRange || "this-week") === "this-week" ? "selected" : ""}>This week</option>
              <option value="last-7-days" ${inputs.dateRange === "last-7-days" ? "selected" : ""}>Last 7 days</option>
            </select>
          </div>
          <div class="field">
            <label for="weekly-audience">Audience</label>
            <select id="weekly-audience" data-weekly-input="audience">
              ${["team", "manager", "public"].map(option => `<option value="${option}" ${(inputs.audience || "team") === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="weekly-channel">Channel</label>
            <select id="weekly-channel" data-weekly-input="channel">
              ${["Slack", "email"].map(option => `<option value="${option}" ${(inputs.channel || "Slack") === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="weekly-slack">Slack destination</label>
            <input id="weekly-slack" data-weekly-input="slackChannel" value="${escapeHtml(inputs.slackChannel || "#weekly-report")}" />
          </div>
        </div>
        <div class="weekly-notes">
          <div class="field">
            <label for="weekly-completed">Extra completed work</label>
            <textarea id="weekly-completed" data-weekly-input="completedNotes" placeholder="Anything not visible in GitHub">${escapeHtml(inputs.completedNotes || "")}</textarea>
          </div>
          <div class="field">
            <label for="weekly-blockers">Blockers</label>
            <textarea id="weekly-blockers" data-weekly-input="blockerNotes" placeholder="Waiting on review, missing context, release risk...">${escapeHtml(inputs.blockerNotes || "")}</textarea>
          </div>
          <div class="field">
            <label for="weekly-next">Next steps</label>
            <textarea id="weekly-next" data-weekly-input="nextStepNotes" placeholder="Focus areas for next week">${escapeHtml(inputs.nextStepNotes || "")}</textarea>
          </div>
        </div>
        <textarea class="instruction-box" data-role="run-request" placeholder="Optional tone or focus for this report">${escapeHtml(state.runRequest)}</textarea>
        <button class="button" data-action="run">${icons.run} Generate weekly report</button>
      </section>
    `;
  }

  return `
    <section class="run-request">
      <div class="run-request-copy">
        <h3 class="card-title">Run request</h3>
        <p class="step-detail">Optional context for this run only. The saved workflow stays unchanged.</p>
      </div>
      <textarea class="instruction-box" data-role="run-request" placeholder="Example: Apply the new loading button design, prepare a PR draft, and wait before notifying Slack.">${escapeHtml(state.runRequest)}</textarea>
      <button class="button" data-action="run">${icons.run} Run workflow</button>
    </section>
  `;
}

function renderPlannerStatus() {
  const health = state.health;
  if (!health) {
    return `
      <div class="planner-status">
        <div>
          <strong>Planner Agent</strong>
          <span>Checking planner mode...</span>
        </div>
        <span class="pill">loading</span>
      </div>
    `;
  }

  return `
    <div class="planner-status ${health.llmPlannerHealthy ? "active" : health.llmPlanner ? "warning" : ""}">
      <div>
        <strong>Planner Agent</strong>
        <span>${plannerStatusText(health)}</span>
      </div>
      <span class="pill ${health.llmPlannerHealthy ? "low" : health.llmPlanner ? "medium" : ""}">${health.llmPlannerHealthy ? "LLM active" : health.llmPlanner ? "fallback" : "rules"}</span>
    </div>
  `;
}

function plannerStatusText(health) {
  if (!health.llmPlanner) return "Rule-based fallback active";
  if (health.llmPlannerHealthy) return `LLM risk classifier active: ${health.model}`;
  return `LLM configured, fallback active: ${health.plannerLastError || "provider unavailable"}`;
}

function renderMemoryPanel() {
  const memory = state.memory;
  if (!memory) {
    return `
      <div class="memory-panel">
        <div class="memory-top">
          <strong>Agent memory</strong>
          <span class="pill">loading</span>
        </div>
      </div>
    `;
  }

  const storageLabel = memory.atlasActive ? "MongoDB Atlas" : "Local JSON";
  const lastDecision = memory.lastDecision
    ? `${memory.lastDecision.decision} ${memory.lastDecision.checkpointId}`
    : "No decisions yet";

  return `
    <div class="memory-panel">
      <div class="memory-top">
        <strong>Agent memory</strong>
        <span class="pill ${memory.atlasActive ? "low" : ""}">${escapeHtml(storageLabel)}</span>
      </div>
      <p class="memory-copy">Persistent workflow memory for traces, runs, and human approvals.</p>
      <div class="memory-grid">
        <div><strong>${memory.workflows}</strong><span>workflows</span></div>
        <div><strong>${memory.traces}</strong><span>traces</span></div>
        <div><strong>${memory.executions}</strong><span>runs</span></div>
        <div><strong>${memory.decisions}</strong><span>decisions</span></div>
      </div>
      <div class="memory-foot">
        <span>${escapeHtml(memory.database)}</span>
        <span>${escapeHtml(lastDecision)}</span>
      </div>
      ${state.health?.allowDemoReset ? `<button class="button secondary reset-button" data-action="reset-demo">Reset demo data</button>` : ""}
    </div>
  `;
}

function renderWorkflowManager(workflow) {
  if (!workflow) return "";
  const steps = (workflow.recordedSteps || []).map(step => step.title).join("\n");
  return `
    <form class="manager-panel" data-form="manage">
      <div class="surface-header compact">
        <h3 class="section-title">Workflow library</h3>
        <span class="pill">editable</span>
      </div>
      <div class="field">
        <label for="manage-name">Name</label>
        <input id="manage-name" name="name" value="${escapeHtml(workflow.name)}" />
      </div>
      <div class="field">
        <label for="manage-goal">Goal</label>
        <textarea id="manage-goal" name="goal">${escapeHtml(workflow.goal)}</textarea>
      </div>
      <div class="field">
        <label for="manage-steps">Steps</label>
        <textarea id="manage-steps" name="steps">${escapeHtml(steps)}</textarea>
      </div>
      <div class="action-stack">
        <button class="button" type="submit">Save edits</button>
        <button class="button danger" type="button" data-action="delete-workflow">Delete</button>
      </div>
      <p class="step-detail">Saving regenerates the agent plan and checkpoints from the edited steps.</p>
    </form>
  `;
}

function renderTeachForm() {
  return `
    <section class="surface" style="margin-bottom: 16px;">
      <div class="surface-header">
        <h3 class="section-title">Teach Agent</h3>
        <span class="pill">browser recorder</span>
      </div>
      <form class="surface-body teach-form" data-form="teach">
        <div class="artifact" style="margin-top: 0;">
          <strong>Real recorder path</strong>
          <p>Install the Chrome extension from the <code>extension</code> folder, record a browser workflow, then send the trace here to generate a plan automatically.</p>
        </div>
        <div class="field">
          <label for="workflow-name">Workflow name</label>
          <input id="workflow-name" name="name" value="Customer Support Response Guardrail" />
        </div>
        <div class="field">
          <label for="workflow-goal">Goal</label>
          <input id="workflow-goal" name="goal" value="Draft a customer support response, verify facts, and ask before sending." />
        </div>
        <div class="field">
          <label for="workflow-steps">Recorded steps</label>
          <textarea id="workflow-steps" name="steps">Read customer ticket
Search product docs
Draft response
Check refund policy
Send email to customer</textarea>
        </div>
        <button class="button" type="submit">Generate workflow spec</button>
      </form>
    </section>
  `;
}

function renderTimeline(workflow) {
  const timeline = state.execution?.workflowId === workflow?.id
    ? state.execution.timeline
    : workflow?.plan || [];

  if (!timeline.length) return `<div class="empty">Run the agent to generate an execution timeline.</div>`;

  return timeline.map((item, index) => `
    <article class="timeline-item ${escapeHtml(item.status)}">
      <div class="timeline-dot">${item.status === "complete" ? "✓" : index + 1}</div>
      <div>
        <div class="step-top">
          <div>
            <div class="step-title">${escapeHtml(item.title)}</div>
            <p class="step-detail">${escapeHtml(item.detail)}</p>
          </div>
          <span class="pill ${escapeHtml(item.risk)}">${escapeHtml(item.risk)}</span>
        </div>
        <div class="timeline-meta">
          <span class="pill">${escapeHtml(item.agent)}</span>
          <span class="pill">${escapeHtml(item.status)}</span>
        </div>
      </div>
    </article>
  `).join("");
}

function renderCheckpointPanel(workflow, checkpoint) {
  if (!workflow) return `<div class="empty">No workflow selected.</div>`;
  const runInstruction = state.execution?.input?.runInstruction;

  if (state.execution?.status === "failed" && state.execution.artifacts.failure) {
    const failure = state.execution.artifacts.failure;
    return `
      <div class="artifact failure">
        <strong>Agent Failure Explanation</strong>
        <p><b>Failed step:</b> ${escapeHtml(failure.step)}</p>
        <p><b>Why:</b> ${escapeHtml(failure.why)}</p>
        <p><b>How to fix:</b> ${escapeHtml(failure.fix)}</p>
      </div>
      <button class="button" style="margin-top: 12px; width: 100%; justify-content: center;" data-action="run">${icons.run} Rerun Agent</button>
    `;
  }

  if (!state.execution) {
    return `
      <div class="empty">
        Run the workflow to prepare execution artifacts. FlowGuard will pause before the first risky action and explain why.
      </div>
      <div class="artifact">
        <strong>Expected output</strong>
        <p>Patch preview, test command, PR summary, Slack draft, execution logs, checkpoint decisions, and a failure debugger if the plan is rejected.</p>
      </div>
    `;
  }

  if (state.execution.status === "complete") {
    return `
      ${renderGitHubArtifact(state.execution)}
      ${renderWeeklyReportArtifact(state.execution)}
      ${renderExecutionPackage(state.execution)}
      <div class="artifact">
        <strong>PR draft summary</strong>
        <p>${escapeHtml(state.execution.artifacts.prSummary)}</p>
      </div>
      <div class="artifact">
        <strong>Slack draft</strong>
        <p>${escapeHtml(state.execution.artifacts.slackMessage)}</p>
      </div>
      <button class="button" style="margin-top: 12px; width: 100%; justify-content: center;" data-action="run">${icons.run} Run again</button>
    `;
  }

  if (!checkpoint) {
    return `<div class="empty">Agent is working. The next approval will appear here.</div>`;
  }

  return `
    <div class="checkpoint-card ${escapeHtml(checkpoint.risk)}">
      <span class="pill ${escapeHtml(checkpoint.risk)}">${escapeHtml(checkpoint.risk)} risk</span>
      <h3>${escapeHtml(checkpoint.title)}</h3>
      <p>${escapeHtml(checkpoint.reason)}</p>
      ${runInstruction ? `
        <div class="proposal">
          <strong>This run's request</strong>
          ${escapeHtml(runInstruction)}
        </div>
      ` : ""}
      <div class="proposal">
        <strong>Proposed guarded action</strong>
        ${escapeHtml(checkpoint.proposedAction)}
      </div>
      <textarea class="instruction-box" data-role="instruction" placeholder="Optional edit instruction for the agent">${escapeHtml(state.instructionDraft)}</textarea>
      <div class="action-stack">
        <button class="button" data-action="approve" data-checkpoint="${escapeHtml(checkpoint.id)}">${icons.approve} Approve</button>
        <button class="button danger" data-action="reject" data-checkpoint="${escapeHtml(checkpoint.id)}">${icons.reject} Reject</button>
        <button class="button secondary wide" data-action="edit" data-checkpoint="${escapeHtml(checkpoint.id)}">${icons.edit} Edit instruction</button>
        <button class="button ghost wide" data-action="why">${icons.why} Ask agent why</button>
      </div>
    </div>
    ${renderGitHubArtifact(state.execution)}
    ${renderWeeklyReportArtifact(state.execution)}
    ${renderExecutionPackage(state.execution)}
    <div class="artifact">
      <strong>Persistent memory</strong>
      <p>This run saves workflow spec, execution logs, and approve/reject decisions through the backend API.</p>
    </div>
  `;
}

function renderExecutionPackage(execution) {
  const executionPackage = execution?.artifacts?.executionPackage;
  if (!executionPackage) return "";

  return `
    <div class="artifact package-artifact">
      <strong>Execution package</strong>
      <div class="artifact-kv">
        <span>Branch</span>
        <code>${escapeHtml(executionPackage.branchName)}</code>
      </div>
      <div class="artifact-kv">
        <span>Test command</span>
        <code>${escapeHtml(executionPackage.testCommand)}</code>
      </div>
      <div class="artifact-list">
        <span>Changed files</span>
        ${(executionPackage.changedFiles || []).map(file => `<code>${escapeHtml(file)}</code>`).join("")}
      </div>
      <div class="proposal">
        <strong>Patch preview</strong>
        ${(executionPackage.patchPreview || []).map(line => `<div>${escapeHtml(line)}</div>`).join("")}
      </div>
      <div class="proposal">
        <strong>PR title</strong>
        ${escapeHtml(executionPackage.prTitle)}
      </div>
    </div>
  `;
}

function renderGitHubArtifact(execution) {
  const github = execution?.artifacts?.github;
  if (!github) return "";
  if (!github.ok) {
    return `
      <div class="artifact">
        <strong>GitHub integration</strong>
        <p>Repo context will appear when connected to a real repository.</p>
      </div>
    `;
  }

  return `
    <div class="artifact">
      <strong>GitHub repository context</strong>
      <p>${escapeHtml(github.repo)} uses <b>${escapeHtml(github.defaultBranch)}</b> as default branch, has ${Number(github.openIssues).toLocaleString()} open issues, and ${Number(github.stars).toLocaleString()} stars.</p>
    </div>
  `;
}

function renderWeeklyReportArtifact(execution) {
  const weekly = execution?.artifacts?.weeklyReport;
  if (!weekly) return "";
  const activity = weekly.activity;
  const delivery = weekly.delivery;
  return `
    <div class="artifact weekly-report-artifact">
      <strong>Weekly report draft</strong>
      ${weekly.ok && activity ? `
        <div class="artifact-kv"><span>Repo</span><code>${escapeHtml(weekly.repo)}</code></div>
        <div class="artifact-kv"><span>Activity</span><code>${activity.mergedPulls.length} PRs / ${activity.commits.length} commits / ${activity.closedIssues.length} closed issues</code></div>
      ` : `<p>${escapeHtml(weekly.error || "GitHub activity is not available yet.")}</p>`}
      ${weekly.reportText ? `<pre class="report-preview">${escapeHtml(weekly.reportText)}</pre>` : ""}
      ${delivery ? `<p><b>${escapeHtml(delivery.status)}:</b> ${escapeHtml(delivery.message)}</p>` : `<p>Waiting for approval before sending or drafting the final update.</p>`}
    </div>
  `;
}

async function load() {
  if (!state.session) {
    render();
    return;
  }
  const [workflows, memory, health] = await Promise.all([
    api("/api/workflows"),
    api("/api/memory"),
    api("/api/health")
  ]);
  state.workflows = workflows;
  state.memory = memory;
  state.health = health;
  if (!state.workflows.some(workflow => workflow.id === state.selectedWorkflowId)) {
    state.selectedWorkflowId = state.workflows[0]?.id;
  }
  render();
}

async function signUp(form) {
  const formData = new FormData(form);
  const session = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      workspaceName: formData.get("workspaceName")
    })
  });
  state.session = session;
  localStorage.setItem("flowguardSession", JSON.stringify(session));
  syncRecorderSession();
  await load();
}

async function signIn(form) {
  const formData = new FormData(form);
  const session = await api("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({
      email: formData.get("email"),
      password: formData.get("password")
    })
  });
  state.session = session;
  localStorage.setItem("flowguardSession", JSON.stringify(session));
  syncRecorderSession();
  await load();
}

function signOut() {
  localStorage.removeItem("flowguardSession");
  state.session = null;
  syncRecorderSession();
  state.workflows = [];
  state.memory = null;
  state.execution = null;
  render();
}

async function refreshWorkflows() {
  const previousId = state.selectedWorkflowId;
  const [workflows, memory, health] = await Promise.all([
    api("/api/workflows"),
    api("/api/memory"),
    api("/api/health")
  ]);
  state.workflows = workflows;
  state.memory = memory;
  state.health = health;
  state.selectedWorkflowId = state.workflows.some(workflow => workflow.id === previousId)
    ? previousId
    : state.workflows[0]?.id;
  state.execution = null;
  render();
}

async function runWorkflow() {
  const workflow = getSelectedWorkflow();
  if (!workflow) return;
  const runInstruction = document.querySelector("[data-role='run-request']")?.value.trim() || state.runRequest;
  const weeklyInput = {};
  document.querySelectorAll("[data-weekly-input]").forEach(field => {
    weeklyInput[field.dataset.weeklyInput] = field.value.trim();
  });
  state.execution = await api(`/api/workflows/${workflow.id}/runs`, {
    method: "POST",
    body: JSON.stringify({ input: { ...workflow.inputs, ...weeklyInput, runInstruction } })
  });
  state.memory = await api("/api/memory");
  state.runRequest = "";
  state.instructionDraft = "";
  render();
}

async function decide(checkpointId, decision) {
  if (!state.execution) return;
  const instruction = document.querySelector("[data-role='instruction']")?.value || state.instructionDraft;
  state.execution = await api(`/api/executions/${state.execution.id}/decisions`, {
    method: "POST",
    body: JSON.stringify({ checkpointId, decision, instruction })
  });
  state.memory = await api("/api/memory");
  state.instructionDraft = "";
  render();
}

async function teachWorkflow(form) {
  const formData = new FormData(form);
  const steps = String(formData.get("steps") || "")
    .split("\n")
    .map(step => step.trim())
    .filter(Boolean);

  const workflow = await api("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: formData.get("name"),
      goal: formData.get("goal"),
      steps
    })
  });

  state.workflows.unshift(workflow);
  state.memory = await api("/api/memory");
  state.selectedWorkflowId = workflow.id;
  state.execution = null;
  state.teachOpen = false;
  render();
}

async function updateWorkflow(form) {
  const workflow = getSelectedWorkflow();
  if (!workflow) return;
  const formData = new FormData(form);
  const steps = String(formData.get("steps") || "")
    .split("\n")
    .map(step => step.trim())
    .filter(Boolean);

  const updated = await api(`/api/workflows/${workflow.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: formData.get("name"),
      goal: formData.get("goal"),
      steps
    })
  });

  state.workflows = state.workflows.map(item => item.id === updated.id ? updated : item);
  state.memory = await api("/api/memory");
  state.selectedWorkflowId = updated.id;
  state.execution = null;
  render();
}

async function deleteWorkflow() {
  const workflow = getSelectedWorkflow();
  if (!workflow) return;

  const shouldDelete = window.confirm(`Delete "${workflow.name}"? This removes saved runs for this workflow too.`);
  if (!shouldDelete) return;

  await api(`/api/workflows/${workflow.id}`, { method: "DELETE" });
  state.workflows = state.workflows.filter(item => item.id !== workflow.id);
  state.memory = await api("/api/memory");
  state.selectedWorkflowId = state.workflows[0]?.id;
  state.execution = null;
  state.manageOpen = false;
  render();
}

async function resetDemoData() {
  const shouldReset = window.confirm("Reset demo data? This clears workflows, traces, and executions, then restores seed workflows.");
  if (!shouldReset) return;

  await api("/api/admin/reset-demo", { method: "POST" });
  state.execution = null;
  state.selectedWorkflowId = "design-to-pr";
  state.runRequest = "";
  await refreshWorkflows();
}

app.addEventListener("click", event => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  if (action === "toggle-teach") {
    state.teachOpen = !state.teachOpen;
    render();
  }
  if (action === "sign-out") {
    signOut();
  }
  if (action === "auth-mode") {
    state.authMode = target.dataset.mode;
    render();
  }
  if (action === "toggle-password") {
    const input = document.querySelector("#auth-password");
    if (input) {
      input.type = input.type === "password" ? "text" : "password";
      target.textContent = input.type === "password" ? "Show" : "Hide";
    }
  }
  if (action === "toggle-manage") {
    state.manageOpen = !state.manageOpen;
    render();
  }
  if (action === "refresh") {
    refreshWorkflows().catch(error => alert(error.message));
  }
  if (action === "reset-demo") {
    resetDemoData().catch(error => alert(error.message));
  }
  if (action === "select-workflow") {
    state.selectedWorkflowId = target.dataset.id;
    state.runRequest = "";
    state.execution = null;
    render();
  }
  if (action === "run") {
    runWorkflow().catch(error => alert(error.message));
  }
  if (action === "delete-workflow") {
    deleteWorkflow().catch(error => alert(error.message));
  }
  if (action === "approve") {
    decide(target.dataset.checkpoint, "approved").catch(error => alert(error.message));
  }
  if (action === "reject") {
    decide(target.dataset.checkpoint, "rejected").catch(error => alert(error.message));
  }
  if (action === "edit") {
    state.instructionDraft = document.querySelector("[data-role='instruction']")?.value || "";
    if (!state.instructionDraft.trim()) {
      state.instructionDraft = "Narrow the change to Button.tsx only and wait before notifying Slack.";
    }
    render();
  }
  if (action === "why") {
    const workflow = getSelectedWorkflow();
    const checkpoint = getActiveCheckpoint(workflow);
    if (checkpoint) {
      state.instructionDraft = `Why paused: ${checkpoint.reason}`;
      render();
    }
  }
});

app.addEventListener("submit", event => {
  const signInForm = event.target.closest("[data-form='signin']");
  if (signInForm) {
    event.preventDefault();
    signIn(signInForm).catch(error => alert(error.message));
    return;
  }

  const signUpForm = event.target.closest("[data-form='signup']");
  if (signUpForm) {
    event.preventDefault();
    signUp(signUpForm).catch(error => alert(error.message));
    return;
  }

  const teachForm = event.target.closest("[data-form='teach']");
  if (teachForm) {
    event.preventDefault();
    teachWorkflow(teachForm).catch(error => alert(error.message));
    return;
  }

  const manageForm = event.target.closest("[data-form='manage']");
  if (manageForm) {
    event.preventDefault();
    updateWorkflow(manageForm).catch(error => alert(error.message));
  }
});

syncRecorderSession();

load().catch(error => {
  app.innerHTML = `<main class="main"><div class="surface empty">Failed to load FlowGuard: ${escapeHtml(error.message)}</div></main>`;
});
