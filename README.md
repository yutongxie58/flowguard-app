# FlowGuard

Teach an agent a workflow once, then replay it safely with human checkpoints.

FlowGuard is a hackathon-ready MVP for recording professional workflows, converting them into multi-agent workflows, and pausing before risky actions such as creating PRs, sending Slack messages, deploying, or emailing customers.

## MVP Demo

The default demo is **Design-to-PR Guardrail Agent**:

1. Sign into a lightweight workspace.
2. Review a recorded human handoff workflow.
3. Enter a fresh run request, such as "Use the latest Figma button handoff and prepare a PR draft only."
4. Run the multi-agent workflow.
5. Watch the execution timeline pause at a checkpoint.
6. Review the generated execution package: branch, files, patch preview, test command, PR title, and Slack draft.
7. Approve, reject, edit instruction, or ask why the agent paused.
8. See generated PR and Slack artifacts.
9. Reject a checkpoint to trigger the Agent Failure Explanation.

The recorded workflow is the reusable procedure. The run request is what changes this time.

## Chrome Recorder MVP

FlowGuard now includes a real browser capture layer in `extension/`.

Install it locally:

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension` folder in this repo.
5. Keep FlowGuard running at `http://localhost:5173`.

Use it:

1. Click the FlowGuard extension icon.
2. Enter a workflow name and goal.
3. Click **Start**.
4. Do a short workflow across Figma, GitHub, Linear, Jira, Slack web, or any browser app.
5. Add a human note for judgment-heavy steps.
6. Click **Stop**, then **Send to FlowGuard**.
7. The app opens the generated workflow and checkpoint plan.

The recorder captures structured metadata only:

```json
{
  "type": "click",
  "app": "github.com",
  "url": "https://github.com/flowguard-demo/design-system",
  "label": "Pull requests",
  "selector": "a[href=/pulls]",
  "redacted": true
}
```

Form values are not stored. Sensitive fields are explicitly redacted.

## Workflow Management

Teams can clean up outdated workflows directly in the app:

1. Select a workflow from the left sidebar.
2. Click **Manage workflow**.
3. Edit the workflow name, goal, or step list.
4. Click **Save edits** to regenerate the agent plan and checkpoints.
5. Click **Delete** to remove stale workflows and their saved runs.

This is useful after a team changes process, migrates tools, or stops using an old recorded trace.

## Workspace Accounts

FlowGuard includes lightweight workspace accounts:

- name
- email
- workspace name
- password

The browser stores the verified session in `localStorage`, and MongoDB stores `users` and `workspaces`. Passwords are hashed with Node's built-in `crypto.scryptSync`; plaintext passwords are not stored.

Workflows, traces, executions, and memory counts are scoped to the selected workspace.

## Flexible Replay

FlowGuard does not blindly repeat the exact same clicks. A workflow is a reusable procedure, and each execution can include a new run request.

Example:

```text
Recorded workflow:
Open Figma -> find component -> draft patch -> run tests -> prepare PR -> notify Slack

Run request:
Use the latest loading button design and prepare a PR draft only.
```

The agent follows the learned procedure, adapts the artifacts to the new request, and pauses before risky actions.

Checkpoint edits also update the current run package. For example, if the recorded workflow says `Select quantity = 3`, the run request says `set quantity to 4`, and a checkpoint edit says `actually set quantity to 5`, FlowGuard updates the preview to the latest instruction.

## MongoDB Memory Demo Moment

The left sidebar includes an **Agent memory** panel.

Use it during judging:

1. Point out **MongoDB Atlas** as the active memory layer.
2. Run a workflow.
3. Approve or reject a checkpoint.
4. Show the run/decision counts update.
5. Say: "MongoDB stores the team's workflow memory: traces, agent runs, and every human approval decision."

During testing, set `ALLOW_DEMO_RESET=true` to show a **Reset demo data** button in the Agent memory panel. It clears workflows, traces, and executions, then restores the seed workflows.

## Production-Ready Paths

FlowGuard keeps working locally with no secrets, but the codebase now has optional production integrations. External write actions should stay behind checkpoint approval.

### MongoDB Atlas

Set these environment variables to use Atlas instead of local JSON:

```bash
MONGODB_URI="mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority"
MONGODB_DB="flowguard"
```

FlowGuard stores:

- `workflows`
- `traces`
- `executions`

This is the prize story: MongoDB is persistent memory for human workflows, recorder traces, and agent approval decisions.

### LLM Planner / Risk Classifier

Set:

```bash
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5.2"
```

When configured, FlowGuard asks the Planner Agent to convert recorder traces or taught steps into structured workflow plans and checkpoint risk classifications. Without a key, it falls back to the local rule-based planner.

The UI shows the Planner Agent mode:

- **LLM active:** OpenAI planning is configured and healthy.
- **fallback:** an OpenAI key is configured, but the latest planner request failed, so FlowGuard used local rules.
- **rules:** no OpenAI key is configured.

### GitHub Integration

FlowGuard can enrich workflow runs with real GitHub repository context when a workflow includes a repo such as `owner/name` or a recorder trace includes GitHub URLs. The Weekly Report Guardrail also pulls this week's merged PRs, commits, closed issues, and opened issues to draft a status report before the send checkpoint.

Optional:

```bash
GITHUB_TOKEN="github_pat_..."
```

Public repo lookup works without a token, but authenticated requests have better rate limits.

### Slack Webhook

Set this to post approved weekly reports to Slack:

```bash
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

If it is not configured, FlowGuard still generates the report and marks the approved update as a send-ready draft.

### Fetch / Agentverse Scaffold

See `agents/`.

The local app already exposes the agent actions over HTTP. The `agents/agentverse/flowguard_agent.py` wrapper shows how Planner, Executor, and Checkpoint actions map to a uAgents-style message interface.

### Deployment Notes

See `deploy/`.

We are intentionally stopping before actual deployment until the product/demo path is polished.

## 90-Second Demo Script

1. "Teams repeat the same design-to-engineering workflow every week, but giving an agent full autonomy is risky."
2. Click **Run Agent** on the Design-to-PR workflow.
3. Point to the timeline: "Planner and Executor completed the low-risk discovery steps."
4. Point to the right panel: "FlowGuard prepares execution artifacts, then pauses because the next step would affect shared design-system code."
5. Click **Ask agent why**, then **Approve**.
6. Repeat approval for PR creation.
7. At Slack approval: "This is high risk because it communicates to a team channel."
8. Click **Reject** with an edit instruction to show the failure debugger.
9. Close with: "We do not just automate tasks. We teach agents how professionals actually work, then replay those workflows safely."

## Why It Is Prize-Aligned

- **Cognition:** reduces professional toil and explains agent failure points.
- **Fetch.ai:** models the system as Planner, Executor, and Checkpoint agents.
- **MongoDB:** workflow specs, execution logs, and approval decisions map directly to persistent collections.
- **Vultr:** the backend is a simple deployable Node service.
- **Figma:** the main demo centers on design-to-engineering handoff and checkpoint UI iteration.

## Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

No install step is required. The MVP uses Node's built-in HTTP server and stores demo data in `data/flowguard-db.json`.

The local data file is ignored by git. Delete it whenever you want to reset the seeded demo state.

For local secrets, create `.env` from `.env.example`. The server loads it automatically with `dotenv`, and `.env` is ignored by git.

## Code Structure

```text
server.js              Node backend, API routes, JSON persistence
public/index.html      App shell
public/app.js          Frontend state, UI rendering, API calls
public/styles.css      Product UI styling
extension/             Chrome recorder extension
data/                  Local workflow/execution store, generated on first run
```

## API Shape

```text
GET  /api/workflows
GET  /api/health
GET  /api/memory
POST /api/admin/reset-demo
POST /api/auth/signup
POST /api/auth/signin
GET  /api/workflows/:id
POST /api/workflows
PUT  /api/workflows/:id
DELETE /api/workflows/:id
POST /api/workflows/:id/runs
GET  /api/executions/:id
POST /api/executions/:id/decisions
GET  /api/traces
POST /api/traces
```

## Hackathon Pitch

Professionals repeat complex workflows every week: design handoff, repo changes, tests, PRs, team updates, and deployments. Fully autonomous agents are risky because they do not know which steps require human judgment.

FlowGuard learns how humans do the workflow, turns that trace into a multi-agent plan, and adds approval checkpoints before high-impact actions. We do not just automate tasks; we teach agents how professionals actually work and make sure they act safely.

## Next Integrations

- Replace JSON persistence with MongoDB Atlas collections.
- Add real LLM planning and risk classification.
- Connect GitHub PR creation and Slack posting behind checkpoint approval.
- Register the Executor Agent in Fetch Agentverse.
- Deploy the Node service on Vultr.
