const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ quiet: true, override: true });
const { MongoClient } = require("mongodb");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "flowguard-db.json");
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "flowguard";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ALLOW_DEMO_RESET = process.env.ALLOW_DEMO_RESET === "true";
const HOST = process.env.HOST || "127.0.0.1";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000);
const COLLECTIONS = ["workflows", "executions", "traces", "users", "workspaces"];
let mongoClient = null;
let mongoDb = null;
let storageMode = "json";
let lastPlannerError = null;
let recorderSession = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const seedData = {
  workflows: [
    {
      id: "design-to-pr",
      name: "Design-to-PR Guardrail",
      tagline: "Turn a Figma handoff into a reviewed code change and team update.",
      status: "ready",
      owner: "Design Systems",
      lastRun: "2026-04-24T16:30:00.000Z",
      template: "Design-to-PR workflow",
      goal: "Create a safe PR for a UI component change from a new Figma button design.",
      inputs: {
        figmaLink: "https://figma.com/file/flowguard-button-v2",
        repo: "flowguard-demo/design-system",
        targetComponent: "Button.tsx",
        slackChannel: "#design-eng"
      },
      agents: [
        {
          id: "planner",
          name: "Planner Agent",
          role: "Converts the taught workflow into an executable plan.",
          confidence: 94
        },
        {
          id: "executor",
          name: "Executor Agent",
          role: "Runs safe steps, drafts code changes, tests, and messages.",
          confidence: 89
        },
        {
          id: "checkpoint",
          name: "Checkpoint Agent",
          role: "Classifies risk and pauses before shared-code or external actions.",
          confidence: 97
        }
      ],
      recordedSteps: [
        {
          id: "step-1",
          source: "Human trace",
          title: "Open Figma design",
          detail: "Designer reviews button states, spacing, variants, and comments.",
          risk: "low",
          judgment: false
        },
        {
          id: "step-2",
          source: "Human trace",
          title: "Extract component requirements",
          detail: "Capture deltas: new compact size, loading state copy, disabled contrast.",
          risk: "medium",
          judgment: true
        },
        {
          id: "step-3",
          source: "Human trace",
          title: "Find matching React component",
          detail: "Search repo for Button.tsx, usage sites, stories, and tests.",
          risk: "low",
          judgment: false
        },
        {
          id: "step-4",
          source: "Human trace",
          title: "Modify component",
          detail: "Draft props, variants, style tokens, and Storybook examples.",
          risk: "medium",
          judgment: true
        },
        {
          id: "step-5",
          source: "Human trace",
          title: "Run tests",
          detail: "Run component tests, lint, and screenshot diff checks.",
          risk: "medium",
          judgment: false
        },
        {
          id: "step-6",
          source: "Human trace",
          title: "Create PR and notify Slack",
          detail: "Open PR, summarize the design intent, and post update to #design-eng.",
          risk: "high",
          judgment: true
        }
      ],
      plan: [
        {
          id: "plan-1",
          agent: "planner",
          title: "Parse design input",
          status: "pending",
          detail: "Read Figma handoff and identify expected UI states.",
          risk: "low"
        },
        {
          id: "plan-2",
          agent: "executor",
          title: "Map design to Button.tsx",
          status: "pending",
          detail: "Locate component API, token usage, and tests.",
          risk: "low"
        },
        {
          id: "plan-3",
          agent: "executor",
          title: "Draft component patch",
          status: "pending",
          detail: "Prepare changes for compact size and loading variant.",
          risk: "medium",
          checkpointId: "cp-code"
        },
        {
          id: "plan-4",
          agent: "executor",
          title: "Run verification",
          status: "pending",
          detail: "Run unit tests and visual checks before PR creation.",
          risk: "medium"
        },
        {
          id: "plan-5",
          agent: "checkpoint",
          title: "Create PR",
          status: "blocked",
          detail: "Open PR changing Button.tsx and related stories.",
          risk: "medium",
          checkpointId: "cp-pr"
        },
        {
          id: "plan-6",
          agent: "checkpoint",
          title: "Send Slack update",
          status: "blocked",
          detail: "Post status to #design-eng with PR link and preview.",
          risk: "high",
          checkpointId: "cp-slack"
        }
      ],
      checkpoints: [
        {
          id: "cp-code",
          action: "modify_component",
          title: "Approve component patch",
          risk: "medium",
          requiresApproval: true,
          reason: "This step changes shared design-system code used by multiple teams.",
          proposedAction: "Apply a Button.tsx patch adding compact size and loading state."
        },
        {
          id: "cp-pr",
          action: "create_pr",
          title: "Approve PR creation",
          risk: "medium",
          requiresApproval: true,
          reason: "This step publishes code changes for team review.",
          proposedAction: "Prepare PR draft in flowguard-demo/design-system touching Button.tsx, Button.test.tsx, and Button.stories.tsx."
        },
        {
          id: "cp-slack",
          action: "send_slack_message",
          title: "Approve Slack update",
          risk: "high",
          requiresApproval: true,
          reason: "This step communicates externally to the design-engineering channel.",
          proposedAction: "Send a concise handoff update to #design-eng with PR and preview links."
        }
      ]
    },
    {
      id: "weekly-report",
      name: "Weekly Report Guardrail",
      tagline: "Pull GitHub activity, draft a weekly update, and ask before sending.",
      status: "ready",
      owner: "Engineering Ops",
      lastRun: null,
      template: "Weekly report workflow",
      goal: "Generate a weekly engineering status update from GitHub activity, human notes, blockers, and next steps.",
      inputs: {
        reportScope: "repo",
        repo: "flowguard-demo/platform",
        githubUser: "",
        dateRange: "this-week",
        audience: "team",
        channel: "Slack",
        slackChannel: "#weekly-report",
        completedNotes: "",
        blockerNotes: "",
        nextStepNotes: ""
      },
      agents: [
        { id: "planner", name: "Planner Agent", role: "Builds the report plan.", confidence: 91 },
        { id: "executor", name: "Executor Agent", role: "Collects and drafts updates.", confidence: 86 },
        { id: "checkpoint", name: "Checkpoint Agent", role: "Reviews external-send risk.", confidence: 95 }
      ],
      recordedSteps: [
        { id: "wr-1", source: "Human trace", title: "Pull this week's GitHub activity", detail: "Collect merged PRs, commits, closed issues, and opened issues from a selected repo or GitHub user.", risk: "low", judgment: false },
        { id: "wr-2", source: "Human trace", title: "Summarize likely completed work", detail: "Group GitHub activity into completed, in progress, risks, and links.", risk: "low", judgment: true },
        { id: "wr-3", source: "Human trace", title: "Add blockers and next steps", detail: "Let the user add or edit blockers, extra completed work, and follow-ups.", risk: "medium", judgment: true },
        { id: "wr-4", source: "Human trace", title: "Generate weekly report", detail: "Create a concise team, manager, or public-facing update.", risk: "medium", judgment: true },
        { id: "wr-5", source: "Human trace", title: "Send or draft update", detail: "Post to Slack or prepare a send-ready draft after approval.", risk: "high", judgment: true }
      ],
      plan: [
        { id: "wr-plan-1", agent: "planner", title: "Collect GitHub activity", status: "pending", detail: "Fetch merged PRs, commits, closed issues, and opened issues for the date range.", risk: "low" },
        { id: "wr-plan-2", agent: "executor", title: "Draft weekly report", status: "pending", detail: "Summarize completed work, in progress, blockers, next steps, and risks.", risk: "medium" },
        { id: "wr-plan-3", agent: "checkpoint", title: "Send report", status: "blocked", detail: "Post or draft the approved weekly update.", risk: "high", checkpointId: "wr-cp-send" }
      ],
      checkpoints: [
        {
          id: "wr-cp-send",
          action: "send_report",
          title: "Approve report send",
          risk: "high",
          requiresApproval: true,
          reason: "This communicates project status to a broad internal audience.",
          proposedAction: "Send weekly report to #weekly-report."
        }
      ]
    }
  ],
  executions: [],
  traces: []
};

function ensureJsonDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(seedData, null, 2));
  }
}

function normalizeDb(db) {
  db.workflows ||= [];
  db.executions ||= [];
  db.traces ||= [];
  db.users ||= [];
  db.workspaces ||= [];
  for (const workflow of db.workflows) {
  if (workflow.id === "design-to-pr") {
      workflow.inputs ||= {};
      if (workflow.inputs.repo === "acme/web") workflow.inputs.repo = "flowguard-demo/design-system";
      for (const checkpoint of workflow.checkpoints || []) {
        if (checkpoint.id === "cp-pr") {
          checkpoint.proposedAction = "Prepare PR draft in flowguard-demo/design-system touching Button.tsx, Button.test.tsx, and Button.stories.tsx.";
        }
      }
    }
    if (workflow.id === "weekly-report" || workflow.baseTemplateId === "weekly-report") {
      const weeklySeed = seedData.workflows.find(item => item.id === "weekly-report");
      workflow.inputs ||= {};
      if (workflow.inputs.repo === "acme/platform") workflow.inputs.repo = "flowguard-demo/platform";
      workflow.name = "Weekly Report Guardrail";
      workflow.tagline = "Pull GitHub activity, draft a weekly update, and ask before sending.";
      workflow.status = "ready";
      workflow.goal = "Generate a weekly engineering status update from GitHub activity, human notes, blockers, and next steps.";
      workflow.recordedSteps = weeklySeed.recordedSteps;
      workflow.plan = weeklySeed.plan;
      workflow.checkpoints = weeklySeed.checkpoints;
      workflow.inputs.dateRange ||= "this-week";
      workflow.inputs.reportScope ||= "repo";
      workflow.inputs.githubUser ||= "";
      workflow.inputs.audience ||= "team";
      workflow.inputs.channel ||= "Slack";
      if (!workflow.inputs.slackChannel || workflow.inputs.slackChannel === "#weekly-status") workflow.inputs.slackChannel = "#weekly-report";
      workflow.inputs.completedNotes ||= "";
      workflow.inputs.blockerNotes ||= "";
      workflow.inputs.nextStepNotes ||= "";
    }
  }
  return db;
}

function freshSeedData() {
  return JSON.parse(JSON.stringify(seedData));
}

function slugify(value) {
  return String(value || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "workspace";
}

function getWorkspaceId(req) {
  const raw = req.headers["x-workspace-id"];
  return Array.isArray(raw) ? raw[0] : raw;
}

function scopedItems(items, workspaceId) {
  if (!workspaceId) return items;
  return items.filter(item => item.workspaceId === workspaceId);
}

function seedWorkflowsForWorkspace(workspace) {
  return freshSeedData().workflows.map(workflow => ({
    ...workflow,
    id: `${workspace.id}-${workflow.id}`,
    baseTemplateId: workflow.id,
    workspaceId: workspace.id,
    createdBy: workspace.createdBy,
    owner: workflow.owner
  }));
}

function ensureWorkspaceSeedWorkflows(db, workspace) {
  const hasSeed = db.workflows.some(workflow => workflow.workspaceId === workspace.id);
  if (!hasSeed) {
    db.workflows.unshift(...seedWorkflowsForWorkspace(workspace));
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const { hash } = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, ...safeUser } = user;
  return safeUser;
}

function normalizeRecorderSession(session) {
  if (!session?.workspace?.id) return null;
  return {
    user: {
      email: String(session.user?.email || ""),
      name: String(session.user?.name || "")
    },
    workspace: {
      id: String(session.workspace.id),
      name: String(session.workspace.name || session.workspace.id)
    },
    syncedAt: new Date().toISOString()
  };
}

function readJsonDb() {
  ensureJsonDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  return normalizeDb(db);
}

function writeJsonDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function connectStorage() {
  if (!MONGODB_URI) {
    ensureJsonDb();
    storageMode = "json";
    return;
  }

  if (MONGODB_URI.includes("CLUSTER.mongodb.net") || MONGODB_URI.includes("USER:PASSWORD")) {
    throw new Error("MONGODB_URI still contains placeholder text. Update .env or unset the exported shell variable.");
  }

  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB);
    storageMode = "mongodb";

    for (const collectionName of COLLECTIONS) {
      await mongoDb.collection(collectionName).createIndex({ id: 1 }, { unique: true });
    }

    const workflowCount = await mongoDb.collection("workflows").countDocuments();
    if (workflowCount === 0) {
      await writeDb(seedData);
    }
  } catch (error) {
    console.warn(`MongoDB unavailable, using local JSON storage: ${error.message}`);
    mongoClient = null;
    mongoDb = null;
    storageMode = "json";
    ensureJsonDb();
  }
}

async function readMongoDb() {
  const collectionDocs = await Promise.all(
    COLLECTIONS.map(collectionName =>
      mongoDb.collection(collectionName).find({}, { projection: { _id: 0 } }).toArray()
    )
  );
  return normalizeDb(
    Object.fromEntries(COLLECTIONS.map((collectionName, index) => [collectionName, collectionDocs[index]]))
  );
}

async function writeMongoDb(db) {
  const normalized = normalizeDb(db);
  for (const collectionName of COLLECTIONS) {
    const collection = mongoDb.collection(collectionName);
    const docs = normalized[collectionName];
    if (docs.length) {
      await collection.bulkWrite(
        docs.map(doc => ({
          replaceOne: { filter: { id: doc.id }, replacement: { ...doc }, upsert: true }
        }))
      );
      await collection.deleteMany({ id: { $nin: docs.map(doc => doc.id) } });
    } else {
      await collection.deleteMany({});
    }
  }
}

async function readDb() {
  return storageMode === "mongodb" ? readMongoDb() : readJsonDb();
}

async function writeDb(db) {
  return storageMode === "mongodb" ? writeMongoDb(db) : writeJsonDb(db);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Workspace-Id, X-User-Email"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function riskScore(risk) {
  return { low: 1, medium: 2, high: 3 }[risk] || 1;
}

function extractRunOverrides(...instructions) {
  const text = instructions.filter(Boolean).join(" ").toLowerCase();
  const original = instructions.filter(Boolean).join(" ");
  const quantityMatches = [...original.matchAll(/\b(?:quantity\s*(?:=|to|:)?\s*|order\s+|buy\s+|set\s+(?:it\s+)?to\s+)(\d{1,5})\b/gi)];
  const quotedSearchMatches = [...original.matchAll(/['"]([^'"]+)['"]/g)];
  const searchMatches = [...original.matchAll(/\b(?:search for|search|sku|item|product)\s+([a-z0-9._-]+)/gi)];
  const dateMatches = [...original.matchAll(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month|\d{4}-\d{2}-\d{2})\b/gi)];
  const suppressNotify = /\b(do not|don't|dont|skip|hold|wait before)\b.*\b(slack|notify|send|email|message|post)\b/i.test(original);

  return {
    quantity: quantityMatches.at(-1)?.[1] || null,
    searchTerm: quotedSearchMatches.at(-1)?.[1] || searchMatches.at(-1)?.[1] || null,
    date: dateMatches.at(-1)?.[1] || null,
    suppressNotify,
    hasOverrides: Boolean(quantityMatches.length || quotedSearchMatches.length || searchMatches.length || dateMatches.length || suppressNotify || text.includes("instead"))
  };
}

function applyOverridesToReplayLine(title, overrides) {
  let nextTitle = title;
  if (overrides.searchTerm && /\b(search|sku|item|product)\b/i.test(nextTitle)) {
    nextTitle = nextTitle.replace(/(['"]).*?\1/g, `'${overrides.searchTerm}'`);
    if (nextTitle === title) nextTitle = nextTitle.replace(/(search(?: for)?|sku|item|product)(.*)$/i, `$1 '${overrides.searchTerm}'`);
  }
  if (overrides.quantity && /\b(quantity|qty|units?|amount|order|buy|cart)\b/i.test(nextTitle)) {
    nextTitle = nextTitle.replace(/(quantity\s*=\s*)\d+/i, `$1${overrides.quantity}`);
    nextTitle = nextTitle.replace(/(\bquantity\s*(?:to|:)?\s*)\d+/i, `$1${overrides.quantity}`);
    if (nextTitle === title) nextTitle = nextTitle.replace(/\b\d+\b/, overrides.quantity);
    if (nextTitle === title) nextTitle = `${nextTitle} (${overrides.quantity} units)`;
  }
  if (overrides.date && /\b(date|delivery|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(nextTitle)) {
    nextTitle = nextTitle.replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month|\d{4}-\d{2}-\d{2})\b/i, overrides.date);
    if (nextTitle === title) nextTitle = `${nextTitle} (${overrides.date})`;
  }
  if (overrides.suppressNotify && /\b(slack|notify|send|email|message|post)\b/i.test(nextTitle)) {
    nextTitle = `Hold for approval before: ${nextTitle}`;
  }
  return nextTitle;
}

function buildGenericPatchPreview(workflow, input) {
  const instructionText = [
    input.runInstruction,
    ...(input.editInstructions || [])
  ];
  const overrides = extractRunOverrides(...instructionText);
  const replayLines = workflow.recordedSteps
    .map(step => applyOverridesToReplayLine(step.title, overrides))
    .map(title => `+ replay: ${title}`)
    .slice(0, 5);

  if (overrides.hasOverrides) {
    replayLines.push(`+ apply run overrides: ${instructionText.filter(Boolean).join(" | ")}`);
  }

  return replayLines;
}

function createExecutionArtifacts(workflow, input = {}) {
  const repo = input.repo || workflow.inputs?.repo || "flowguard-demo/design-system";
  const component = input.targetComponent || workflow.inputs?.targetComponent || "Button.tsx";
  const channel = input.slackChannel || workflow.inputs?.slackChannel || "#design-eng";
  const runInstruction = input.runInstruction || "Follow the recorded workflow with the current task context.";
  const editInstructions = input.editInstructions || [];
  const effectiveInstruction = editInstructions.length
    ? `${runInstruction} Latest checkpoint edit: ${editInstructions.at(-1)}`
    : runInstruction;
  const branchName = `flowguard/${component.replace(/\.[^.]+$/, "").toLowerCase()}-design-update`;

  if (isWeeklyReportWorkflow(workflow)) {
    return createWeeklyReportArtifacts(workflow, input);
  }

  if (workflow.baseTemplateId === "design-to-pr" || workflow.id === "design-to-pr" || workflow.template?.toLowerCase().includes("design")) {
    return {
      prSummary: `PR draft package for ${repo}: ${effectiveInstruction} Draft updates target ${component}, include compact/loading coverage, and wait for approval before publishing.`,
      slackMessage: `Design-to-PR update ready for review: ${effectiveInstruction} ${component} changes are packaged with tests and a preview. Waiting on FlowGuard approval before posting to ${channel}.`,
      failure: null,
      executionPackage: {
        branchName,
        changedFiles: [
          `src/components/${component}`,
          `src/components/${component.replace(".tsx", ".test.tsx")}`,
          `src/components/${component.replace(".tsx", ".stories.tsx")}`
        ],
        testCommand: `npm test -- ${component.replace(".tsx", "")} && npm run lint`,
        patchPreview: [
          `+ add compact size token mapping to ${component}`,
          "+ add loading state aria-label and disabled interaction guard",
          "+ add Storybook examples for compact, loading, disabled",
          "+ add regression tests for loading and disabled contrast"
        ],
        prTitle: `Update ${component.replace(".tsx", "")} from design handoff`,
        prBody: [
          "## Summary",
          `- Run request: ${runInstruction}`,
          ...(editInstructions.length ? [`- Latest checkpoint edit: ${editInstructions.at(-1)}`] : []),
          `- Updates ${component} based on the recorded workflow`,
          "- Adds compact and loading variants",
          "- Adds tests and Storybook coverage",
          "",
          "## FlowGuard checkpoints",
          "- Component patch requires approval",
          "- PR creation requires approval",
          `- Slack update to ${channel} requires approval`
        ].join("\n")
      }
    };
  }

  return {
    prSummary: `Execution package for ${workflow.name}: ${effectiveInstruction}`,
    slackMessage: `FlowGuard prepared a guarded run for "${workflow.name}" using this request: ${effectiveInstruction}`,
    failure: null,
    executionPackage: {
      branchName: `flowguard/${workflow.id}`,
      changedFiles: workflow.recordedSteps.slice(0, 3).map(step => step.title),
      testCommand: "Run the verification step recorded in this workflow.",
      patchPreview: buildGenericPatchPreview(workflow, input),
      prTitle: workflow.name,
      prBody: `## Goal\n${workflow.goal}\n\n## Run request\n${runInstruction}${editInstructions.length ? `\n\n## Checkpoint edits\n${editInstructions.map(item => `- ${item}`).join("\n")}` : ""}\n\n## Steps\n${workflow.recordedSteps.map(step => `- ${step.title}`).join("\n")}`
    }
  };
}

function createExecution(workflow, input = {}) {
  const firstCheckpointId = workflow.checkpoints[0]?.id || null;
  const execution = {
    id: crypto.randomUUID(),
    workflowId: workflow.id,
    startedAt: new Date().toISOString(),
    status: firstCheckpointId ? "waiting_for_approval" : "complete",
    input: { ...workflow.inputs, ...input },
    currentCheckpointId: firstCheckpointId,
    timeline: workflow.plan.map((step, index) => {
      const canAutoComplete = index < 2 && !step.checkpointId;
      return {
        ...step,
        status: step.checkpointId === firstCheckpointId ? "waiting" : canAutoComplete ? "complete" : step.status,
        completedAt: canAutoComplete ? new Date(Date.now() - (2 - index) * 8000).toISOString() : null
      };
    }),
    decisions: [],
    artifacts: createExecutionArtifacts(workflow, input)
  };

  return execution;
}

function advanceExecution(workflow, execution) {
  const checkpointIds = workflow.checkpoints.map(checkpoint => checkpoint.id);
  const approved = new Set(
    execution.decisions
      .filter(decision => decision.decision === "approved")
      .map(decision => decision.checkpointId)
  );

  for (const item of execution.timeline) {
    if (!item.checkpointId) {
      item.status = "complete";
      item.completedAt ||= new Date().toISOString();
      continue;
    }

    if (approved.has(item.checkpointId)) {
      item.status = "complete";
      item.completedAt ||= new Date().toISOString();
      continue;
    }

    item.status = "waiting";
    execution.currentCheckpointId = item.checkpointId;
    execution.status = "waiting_for_approval";
    return;
  }

  execution.currentCheckpointId = null;
  execution.status = "complete";
}

function createWorkflowFromTeach(body) {
  const steps = Array.isArray(body.steps) ? body.steps.filter(Boolean) : [];
  const normalizedSteps = steps.length ? steps : [
    "Review source context",
    "Plan implementation",
    "Draft change",
    "Run verification",
    "Ask before publishing"
  ];

  const checkpoints = normalizedSteps
    .map((title, index) => {
      const lower = title.toLowerCase();
      const highRisk = lower.includes("send") || lower.includes("deploy") || lower.includes("slack") || lower.includes("email");
      const mediumRisk = highRisk || lower.includes("pr") || lower.includes("merge") || lower.includes("change") || lower.includes("modify");
      if (!mediumRisk && index < normalizedSteps.length - 1) return null;
      return {
        id: `cp-${index + 1}`,
        action: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        title: `Approve: ${title}`,
        risk: highRisk ? "high" : "medium",
        requiresApproval: true,
        reason: highRisk
          ? "This step affects other people or production-facing communication."
          : "This step changes shared work and should be reviewed before execution.",
        proposedAction: title
      };
    })
    .filter(Boolean);

  return {
    id: `workflow-${Date.now()}`,
    name: body.name || "Taught Workflow",
    tagline: body.tagline || "A newly taught workflow with risk-aware checkpoints.",
    status: "ready",
    owner: body.owner || "Hackathon Team",
    lastRun: null,
    template: body.template || "Custom taught workflow",
    goal: body.goal || "Replay this professional workflow with human checkpoints.",
    inputs: body.inputs || {},
    agents: seedData.workflows[0].agents,
    recordedSteps: normalizedSteps.map((title, index) => ({
      id: `custom-step-${index + 1}`,
      source: "Taught step",
      title,
      detail: `Human-provided instruction ${index + 1}.`,
      risk: checkpoints.some(checkpoint => checkpoint.proposedAction === title)
        ? checkpoints.find(checkpoint => checkpoint.proposedAction === title).risk
        : "low",
      judgment: riskScore(checkpoints.find(checkpoint => checkpoint.proposedAction === title)?.risk) >= 2
    })),
    plan: normalizedSteps.map((title, index) => {
      const checkpoint = checkpoints.find(item => item.proposedAction === title);
      return {
        id: `custom-plan-${index + 1}`,
        agent: checkpoint ? "checkpoint" : index === 0 ? "planner" : "executor",
        title,
        status: checkpoint ? "blocked" : "pending",
        detail: `Replay taught step: ${title}`,
        risk: checkpoint?.risk || "low",
        checkpointId: checkpoint?.id
      };
    }),
    checkpoints
  };
}

function workflowFromPlannedSteps(baseWorkflow, planned, sourceLabel) {
  if (!planned || !Array.isArray(planned.steps) || !planned.steps.length) return baseWorkflow;

  const plannedSteps = planned.steps.slice(0, 8).map((step, index) => ({
    title: step.title || `Planned step ${index + 1}`,
    detail: step.detail || "Generated by Planner Agent.",
    risk: ["low", "medium", "high"].includes(step.risk) ? step.risk : "low"
  }));

  const checkpointActions = new Set(
    (planned.checkpoints || [])
      .filter(checkpoint => checkpoint?.requiresApproval !== false)
      .map(checkpoint => checkpoint.action)
  );

  const checkpoints = plannedSteps
    .map((step, index) => {
      const action = step.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (step.risk === "low" && !checkpointActions.has(action) && index < plannedSteps.length - 1) return null;
      const plannedCheckpoint = (planned.checkpoints || []).find(checkpoint => checkpoint.action === action);
      return {
        id: `llm-cp-${index + 1}`,
        action,
        title: plannedCheckpoint?.title || `Approve: ${step.title}`,
        risk: step.risk === "high" ? "high" : "medium",
        requiresApproval: true,
        reason: plannedCheckpoint?.reason || (
          step.risk === "high"
            ? "The planner classified this as a high-impact action."
            : "The planner classified this as shared work that should be reviewed."
        ),
        proposedAction: plannedCheckpoint?.proposedAction || step.title
      };
    })
    .filter(Boolean);

  return {
    ...baseWorkflow,
    tagline: planned.tagline || baseWorkflow.tagline,
    goal: planned.goal || baseWorkflow.goal,
    recordedSteps: plannedSteps.map((step, index) => ({
      id: `llm-step-${index + 1}`,
      source: sourceLabel,
      title: step.title,
      detail: step.detail,
      risk: step.risk,
      judgment: riskScore(step.risk) >= 2
    })),
    plan: plannedSteps.map((step, index) => {
      const checkpoint = checkpoints.find(item => item.proposedAction === step.title || item.action === step.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
      return {
        id: `llm-plan-${index + 1}`,
        agent: checkpoint ? "checkpoint" : index === 0 ? "planner" : "executor",
        title: step.title,
        status: checkpoint ? "blocked" : "pending",
        detail: step.detail,
        risk: checkpoint?.risk || step.risk,
        checkpointId: checkpoint?.id
      };
    }),
    checkpoints
  };
}

function extractResponseText(responseBody) {
  if (responseBody.output_text) return responseBody.output_text;
  return (responseBody.output || [])
    .flatMap(item => item.content || [])
    .map(content => content.text || "")
    .join("\n")
    .trim();
}

async function enhanceWorkflowWithLlm(baseWorkflow, plannerInput, sourceLabel) {
  if (!OPENAI_API_KEY) return baseWorkflow;

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["goal", "tagline", "steps", "checkpoints"],
    properties: {
      goal: { type: "string" },
      tagline: { type: "string" },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "detail", "risk"],
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
            risk: { type: "string", enum: ["low", "medium", "high"] }
          }
        }
      },
      checkpoints: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["action", "title", "reason", "proposedAction", "requiresApproval"],
          properties: {
            action: { type: "string" },
            title: { type: "string" },
            reason: { type: "string" },
            proposedAction: { type: "string" },
            requiresApproval: { type: "boolean" }
          }
        }
      }
    }
  };

  const prompt = [
    "You are FlowGuard's Planner Agent.",
    "Convert human workflow traces into a concise replay plan.",
    "Classify risk as low, medium, or high.",
    "Require checkpoints before actions that modify shared code, create PRs, deploy, delete data, send messages, email customers, or communicate to teams.",
    "Return only the structured output requested by the schema.",
    "",
    JSON.stringify(plannerInput, null, 2)
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "flowguard_workflow_plan",
            strict: true,
            schema
          }
        }
      })
    }).finally(() => clearTimeout(timeout));

    const responseBody = await response.json();
    if (!response.ok) throw new Error(responseBody.error?.message || "OpenAI planner request failed");

    const text = extractResponseText(responseBody);
    const planned = JSON.parse(text);
    lastPlannerError = null;
    return workflowFromPlannedSteps(baseWorkflow, planned, sourceLabel);
  } catch (error) {
    lastPlannerError = error.name === "AbortError"
      ? `OpenAI planner timed out after ${LLM_TIMEOUT_MS}ms`
      : error.message;
    console.warn(`LLM planner fallback: ${error.message}`);
    return baseWorkflow;
  }
}

function rebuildWorkflowFromEdit(existingWorkflow, body) {
  const steps = Array.isArray(body.steps)
    ? body.steps.filter(Boolean)
    : existingWorkflow.recordedSteps.map(step => step.title);
  const rebuilt = createWorkflowFromTeach({
    name: body.name || existingWorkflow.name,
    goal: body.goal || existingWorkflow.goal,
    tagline: body.tagline || existingWorkflow.tagline,
    owner: existingWorkflow.owner,
    template: existingWorkflow.template,
    inputs: existingWorkflow.inputs,
    steps
  });

  return {
    ...existingWorkflow,
    ...rebuilt,
    id: existingWorkflow.id,
    lastRun: existingWorkflow.lastRun,
    status: body.status || existingWorkflow.status,
    tagline: body.tagline || existingWorkflow.tagline
  };
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown app";
  }
}

function repoFromGitHubUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.replace(/^www\./, "").includes("github.com")) return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return `${owner}/${repo.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

function repoFromWorkflow(workflow) {
  if (workflow.inputs?.repo && /^[^/\s]+\/[^/\s]+$/.test(workflow.inputs.repo)) return workflow.inputs.repo;
  for (const step of workflow.recordedSteps || []) {
    const repo = repoFromGitHubUrl(step.detail);
    if (repo) return repo;
  }
  return null;
}

async function fetchGitHubRepo(repo) {
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;

  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "FlowGuard-Hackathon"
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      repo,
      ok: false,
      error: body.message || "GitHub repository lookup failed"
    };
  }

  return {
    repo: body.full_name,
    ok: true,
    description: body.description || "",
    defaultBranch: body.default_branch,
    openIssues: body.open_issues_count,
    stars: body.stargazers_count,
    url: body.html_url,
    integration: "github"
  };
}

function isWeeklyReportWorkflow(workflow) {
  return workflow?.baseTemplateId === "weekly-report"
    || workflow?.id === "weekly-report"
    || workflow?.template?.toLowerCase().includes("weekly report");
}

function githubHeaders() {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "FlowGuard-Hackathon"
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

function resolveDateRange(input = {}) {
  if (input.startDate && input.endDate) {
    return {
      label: "custom range",
      start: new Date(`${input.startDate}T00:00:00.000Z`),
      end: new Date(`${input.endDate}T23:59:59.999Z`)
    };
  }

  const now = new Date();
  const start = new Date(now);
  const day = start.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  start.setUTCHours(0, 0, 0, 0);

  return {
    label: input.dateRange === "last-7-days" ? "last 7 days" : "this week",
    start: input.dateRange === "last-7-days" ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) : start,
    end: now
  };
}

async function fetchGitHubEndpoint(repo, endpoint, params = {}) {
  const url = new URL(`https://api.github.com/repos/${repo}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: githubHeaders() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub ${endpoint} lookup failed`);
  return Array.isArray(body) ? body : [];
}

async function fetchGitHubUserEvents(username, params = {}) {
  const url = new URL(`https://api.github.com/users/${username}/events/public`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: githubHeaders() });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body.message || "GitHub user activity lookup failed");
  return Array.isArray(body) ? body : [];
}

async function fetchGitHubUserEventPages(username, pages = 3) {
  const pageNumbers = Array.from({ length: pages }, (_, index) => index + 1);
  const results = await Promise.allSettled(
    pageNumbers.map(page => fetchGitHubUserEvents(username, { per_page: 100, page }))
  );
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}

async function fetchGitHubUserRepos(username, params = {}) {
  const url = new URL(`https://api.github.com/users/${username}/repos`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: githubHeaders() });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body.message || "GitHub repository list lookup failed");
  return Array.isArray(body) ? body : [];
}

async function fetchGitHubGraphQL(query, variables = {}) {
  if (!GITHUB_TOKEN) throw new Error("GitHub token is required for contribution graph lookup.");

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message || body.message || "GitHub contribution graph lookup failed");
  }
  return body.data;
}

function inRange(value, range) {
  if (!value) return false;
  const date = new Date(value);
  return date >= range.start && date <= range.end;
}

function simplifyPullRequest(item) {
  return {
    number: item.number,
    title: item.title,
    author: item.user?.login || "unknown",
    mergedAt: item.merged_at,
    url: item.html_url,
    labels: (item.labels || []).map(label => label.name),
    body: String(item.body || "").slice(0, 280)
  };
}

function simplifyCommit(item) {
  const message = item.commit?.message || "";
  return {
    sha: String(item.sha || "").slice(0, 7),
    title: message.split("\n")[0],
    author: item.author?.login || item.commit?.author?.name || "unknown",
    committedAt: item.commit?.author?.date,
    url: item.html_url
  };
}

function simplifyIssue(item) {
  return {
    number: item.number,
    title: item.title,
    author: item.user?.login || "unknown",
    state: item.state,
    createdAt: item.created_at,
    closedAt: item.closed_at,
    url: item.html_url,
    labels: (item.labels || []).map(label => label.name)
  };
}

function simplifyPersonalEvent(event) {
  const repo = event.repo?.name || "unknown/repo";
  const payload = event.payload || {};
  const createdAt = event.created_at;

  if (event.type === "PushEvent") {
    return (payload.commits || []).slice(0, 3).map(commit => ({
      type: "commit",
      repo,
      sha: String(commit.sha || "").slice(0, 7),
      title: commit.message?.split("\n")[0] || "Commit",
      author: event.actor?.login || "unknown",
      committedAt: createdAt,
      url: `https://github.com/${repo}/commit/${commit.sha}`,
      createdAt
    }));
  }

  if (event.type === "PullRequestEvent") {
    const pr = payload.pull_request || {};
    return [{
      type: payload.action === "closed" && pr.merged ? "merged_pr" : "pull_request",
      repo,
      number: pr.number,
      title: pr.title || "Pull request",
      author: event.actor?.login || "unknown",
      action: payload.action,
      url: pr.html_url || `https://github.com/${repo}/pulls`,
      createdAt
    }];
  }

  if (event.type === "IssuesEvent") {
    const issue = payload.issue || {};
    return [{
      type: "issue",
      repo,
      number: issue.number,
      title: issue.title || "Issue",
      author: event.actor?.login || "unknown",
      action: payload.action,
      url: issue.html_url || `https://github.com/${repo}/issues`,
      createdAt,
      closedAt: payload.action === "closed" ? createdAt : null
    }];
  }

  if (event.type === "CreateEvent" && payload.ref_type === "repository") {
    return [{
      type: "repository",
      repo,
      title: `Created repository ${repo}`,
      author: event.actor?.login || "unknown",
      action: "created",
      url: `https://github.com/${repo}`,
      createdAt
    }];
  }

  return [];
}

async function fetchGitHubWeeklyActivity(repo, input = {}) {
  const range = resolveDateRange(input);
  const [repoInfo, pulls, commits, issues] = await Promise.all([
    fetchGitHubRepo(repo),
    fetchGitHubEndpoint(repo, "pulls", { state: "closed", sort: "updated", direction: "desc", per_page: 50 }),
    fetchGitHubEndpoint(repo, "commits", { since: range.start.toISOString(), until: range.end.toISOString(), per_page: 50 }),
    fetchGitHubEndpoint(repo, "issues", { state: "all", since: range.start.toISOString(), per_page: 50 })
  ]);

  const issueOnly = issues.filter(item => !item.pull_request);
  return {
    repo,
    ok: true,
    range: {
      label: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    repoInfo,
    mergedPulls: pulls.filter(item => inRange(item.merged_at, range)).slice(0, 12).map(simplifyPullRequest),
    commits: commits.filter(item => inRange(item.commit?.author?.date, range)).slice(0, 16).map(simplifyCommit),
    closedIssues: issueOnly.filter(item => inRange(item.closed_at, range)).slice(0, 12).map(simplifyIssue),
    openedIssues: issueOnly.filter(item => inRange(item.created_at, range)).slice(0, 12).map(simplifyIssue)
  };
}

async function fetchOwnedRepoCommitsForUser(username, range) {
  const repos = await fetchGitHubUserRepos(username, { type: "owner", sort: "pushed", direction: "desc", per_page: 25 });
  const recentlyPushedRepos = repos
    .filter(repo => inRange(repo.pushed_at, range))
    .slice(0, 10);
  const results = await Promise.allSettled(
    recentlyPushedRepos.map(repo =>
      fetchGitHubEndpoint(repo.full_name, "commits", {
        author: username,
        since: range.start.toISOString(),
        until: range.end.toISOString(),
        per_page: 20
      }).then(commits => commits.map(commit => ({ ...simplifyCommit(commit), repo: repo.full_name, type: "commit" })))
    )
  );
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}

function contributionRepoName(group) {
  return group?.repository?.nameWithOwner || "unknown/repo";
}

async function fetchGitHubContributionActivity(username, input = {}) {
  const range = resolveDateRange(input);
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername || /\s/.test(cleanUsername)) {
    throw new Error("Enter a GitHub username for personal reports.");
  }

  const query = `
    query FlowGuardContributions($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 25) {
            repository { nameWithOwner url }
            contributions(first: 100) {
              nodes { occurredAt commitCount url }
            }
          }
          pullRequestContributionsByRepository(maxRepositories: 25) {
            repository { nameWithOwner }
            contributions(first: 50) {
              nodes {
                occurredAt
                pullRequest { number title url merged mergedAt author { login } }
              }
            }
          }
          issueContributionsByRepository(maxRepositories: 25) {
            repository { nameWithOwner }
            contributions(first: 50) {
              nodes {
                occurredAt
                issue { number title url closed closedAt author { login } }
              }
            }
          }
        }
      }
    }
  `;

  const data = await fetchGitHubGraphQL(query, {
    login: cleanUsername,
    from: range.start.toISOString(),
    to: range.end.toISOString()
  });
  const collection = data?.user?.contributionsCollection;
  if (!collection) throw new Error("GitHub user not found.");

  const commitGroups = collection.commitContributionsByRepository || [];
  const commits = commitGroups.flatMap(group =>
    (group.contributions?.nodes || []).map(node => {
      const count = Number(node.commitCount || 1);
      return {
        type: "commit",
        repo: contributionRepoName(group),
        sha: count === 1 ? "commit" : `${count} commits`,
        title: count === 1 ? "Created 1 commit" : `Created ${count} commits`,
        author: cleanUsername,
        committedAt: node.occurredAt,
        createdAt: node.occurredAt,
        url: node.url || group.repository?.url,
        commitCount: count
      };
    })
  );

  const mergedPulls = (collection.pullRequestContributionsByRepository || []).flatMap(group =>
    (group.contributions?.nodes || [])
      .map(node => node.pullRequest ? ({ node, pr: node.pullRequest, repo: contributionRepoName(group) }) : null)
      .filter(Boolean)
      .filter(item => item.pr.merged)
      .map(item => ({
        type: "merged_pr",
        repo: item.repo,
        number: item.pr.number,
        title: item.pr.title,
        author: item.pr.author?.login || cleanUsername,
        action: "merged",
        url: item.pr.url,
        createdAt: item.pr.mergedAt || item.node.occurredAt
      }))
  );

  const issues = (collection.issueContributionsByRepository || []).flatMap(group =>
    (group.contributions?.nodes || [])
      .map(node => node.issue ? ({ node, issue: node.issue, repo: contributionRepoName(group) }) : null)
      .filter(Boolean)
      .map(item => ({
        type: "issue",
        repo: item.repo,
        number: item.issue.number,
        title: item.issue.title,
        author: item.issue.author?.login || cleanUsername,
        action: item.issue.closed ? "closed" : "opened",
        url: item.issue.url,
        createdAt: item.node.occurredAt,
        closedAt: item.issue.closedAt
      }))
  );

  const allItems = [...commits, ...mergedPulls, ...issues];
  return {
    repo: `@${cleanUsername}`,
    scope: "personal",
    username: cleanUsername,
    ok: true,
    range: {
      label: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    repoInfo: null,
    mergedPulls: mergedPulls.slice(0, 12),
    commits: commits.slice(0, 16),
    commitCount: commits.reduce((sum, commit) => sum + Number(commit.commitCount || 1), 0),
    closedIssues: issues.filter(item => item.action === "closed").slice(0, 12),
    openedIssues: issues.filter(item => item.action === "opened").slice(0, 12),
    createdRepositories: [],
    repositories: [...new Set(allItems.map(item => item.repo))].sort().slice(0, 12),
    eventCount: allItems.length,
    source: {
      contributionGraph: true,
      publicEvents: 0,
      ownedRepoCommits: 0
    }
  };
}

async function fetchGitHubPersonalActivity(username, input = {}) {
  const range = resolveDateRange(input);
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername || /\s/.test(cleanUsername)) {
    throw new Error("Enter a GitHub username for personal reports.");
  }

  if (GITHUB_TOKEN) {
    try {
      const contributionActivity = await fetchGitHubContributionActivity(cleanUsername, input);
      if (contributionActivity.eventCount || contributionActivity.commitCount) return contributionActivity;
    } catch {
      // Fall back to public REST endpoints below.
    }
  }

  const events = await fetchGitHubUserEventPages(cleanUsername, 3);
  const eventItems = events
    .filter(event => inRange(event.created_at, range))
    .flatMap(simplifyPersonalEvent);
  const ownedRepoCommits = await fetchOwnedRepoCommitsForUser(cleanUsername, range).catch(() => []);
  const commitIds = new Set();
  const dedupedCommits = [...eventItems.filter(item => item.type === "commit"), ...ownedRepoCommits]
    .filter(commit => {
      const key = `${commit.repo}:${commit.sha}`;
      if (commitIds.has(key)) return false;
      commitIds.add(key);
      return true;
    });
  const items = [
    ...eventItems.filter(item => item.type !== "commit"),
    ...dedupedCommits
  ].sort((a, b) => new Date(b.createdAt || b.committedAt || 0) - new Date(a.createdAt || a.committedAt || 0));

  return {
    repo: `@${cleanUsername}`,
    scope: "personal",
    username: cleanUsername,
    ok: true,
    range: {
      label: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    repoInfo: null,
    mergedPulls: items.filter(item => item.type === "merged_pr").slice(0, 12),
    commits: items.filter(item => item.type === "commit").slice(0, 16),
    commitCount: items.filter(item => item.type === "commit").length,
    closedIssues: items.filter(item => item.type === "issue" && item.action === "closed").slice(0, 12),
    openedIssues: items.filter(item => item.type === "issue" && item.action === "opened").slice(0, 12),
    createdRepositories: items.filter(item => item.type === "repository").slice(0, 8),
    repositories: [...new Set(items.map(item => item.repo))].sort().slice(0, 12),
    eventCount: items.length,
    source: {
      contributionGraph: false,
      publicEvents: events.length,
      ownedRepoCommits: ownedRepoCommits.length
    }
  };
}

function compactList(items, formatter, emptyText) {
  if (!items?.length) return [`- ${emptyText}`];
  return items.slice(0, 6).map(formatter);
}

function createWeeklyReportArtifacts(workflow, input = {}) {
  const repo = input.repo || workflow.inputs?.repo || "owner/repo";
  const reportScope = input.reportScope || workflow.inputs?.reportScope || "repo";
  const githubUser = String(input.githubUser || workflow.inputs?.githubUser || "").trim();
  const reportSubject = reportScope === "personal" ? `@${githubUser || "github-user"}` : repo;
  const channel = input.slackChannel || workflow.inputs?.slackChannel || "#weekly-report";
  const audience = input.audience || workflow.inputs?.audience || "team";
  const destination = input.channel || workflow.inputs?.channel || "Slack";
  const activity = input.githubActivity;
  const editInstructions = input.editInstructions || [];
  const completedNotes = input.completedNotes || "";
  const blockerNotes = input.blockerNotes || "";
  const nextStepNotes = input.nextStepNotes || "";
  const range = activity?.range?.label || input.dateRange || "this week";

  if (!activity?.ok) {
    return {
      prSummary: `Weekly report draft for ${reportSubject}: waiting for GitHub activity collection.`,
      slackMessage: `Weekly report for ${reportSubject} is ready to draft once GitHub activity is available.`,
      failure: null,
      weeklyReport: {
        repo: reportSubject,
        reportScope,
        githubUser,
        audience,
        destination,
        channel,
        ok: false,
        error: activity?.error || null,
        reportText: "",
        activity: null,
        delivery: null
      }
    };
  }

  const commitCount = Number(activity.commitCount ?? activity.commits.length);
  const completed = [
    ...compactList(activity.mergedPulls, pr => `- Merged ${pr.repo ? `${pr.repo} ` : ""}#${pr.number}: ${pr.title} (${pr.author})`, "No merged PRs found in this range."),
    ...compactList(activity.closedIssues, issue => `- Closed ${issue.repo ? `${issue.repo} ` : ""}#${issue.number}: ${issue.title}`, "No closed issues found in this range."),
    ...(reportScope === "personal" ? compactList(activity.createdRepositories, item => `- Created ${item.repo}`, "No created repositories found in this range.") : [])
  ];
  const inProgress = compactList(activity.commits, commit => `- ${commit.repo ? `${commit.repo} ` : ""}${commit.sha}: ${commit.title} (${commit.author})`, "No commits found in this range.");
  const newWork = compactList(activity.openedIssues, issue => `- Opened ${issue.repo ? `${issue.repo} ` : ""}#${issue.number}: ${issue.title}`, "No newly opened issues found in this range.");
  const repoCoverage = activity.repositories?.length
    ? ["", "Repositories covered", ...activity.repositories.map(item => `- ${item}`)]
    : [];
  const personalVisibilityNote = reportScope === "personal" && !activity.eventCount
    ? ["- No public GitHub activity was found for this range. Private commits or very recent activity may not appear in GitHub's public events feed."]
    : [];
  const blockers = blockerNotes
    ? blockerNotes.split("\n").filter(Boolean).map(line => `- ${line}`)
    : ["- None reported."];
  const nextSteps = nextStepNotes
    ? nextStepNotes.split("\n").filter(Boolean).map(line => `- ${line}`)
    : ["- Review open PRs and keep closing the highest-priority issues."];
  const extras = completedNotes
    ? ["", "Extra completed notes", ...completedNotes.split("\n").filter(Boolean).map(line => `- ${line}`)]
    : [];
  const edits = editInstructions.length
    ? ["", "Reviewer edits", ...editInstructions.map(line => `- ${line}`)]
    : [];

  const reportText = [
    `Weekly report for ${reportSubject} (${range})`,
    `Audience: ${audience}`,
    "",
    "Summary",
    `- ${activity.mergedPulls.length} merged PRs, ${commitCount} commits, ${activity.closedIssues.length} closed issues, ${activity.openedIssues.length} opened issues.`,
    ...(reportScope === "personal" ? [`- ${activity.repositories?.length || 0} repositories with public activity.`] : []),
    ...personalVisibilityNote,
    ...repoCoverage,
    "",
    "Completed this week",
    ...completed,
    ...extras,
    "",
    "In progress",
    ...inProgress,
    "",
    "Blockers",
    ...blockers,
    "",
    "Next steps",
    ...nextSteps,
    "",
    "New / changed work to watch",
    ...newWork,
    ...edits
  ].join("\n");

  return {
    prSummary: `Weekly report for ${reportSubject}: ${activity.mergedPulls.length} merged PRs, ${commitCount} commits, ${activity.closedIssues.length} closed issues.`,
    slackMessage: destination.toLowerCase() === "slack"
      ? `Ready to send weekly report to ${channel}.`
      : "Ready to use as an email/update draft.",
    failure: null,
    weeklyReport: {
      repo: reportSubject,
      reportScope,
      githubUser,
      audience,
      destination,
      channel,
      ok: true,
      reportText,
      activity,
      delivery: null
    }
  };
}

async function enrichExecutionArtifacts(execution, workflow) {
  if (isWeeklyReportWorkflow(workflow)) {
    const reportScope = execution.input?.reportScope || workflow.inputs?.reportScope || "repo";
    const repo = execution.input?.repo || repoFromWorkflow(workflow);
    const githubUser = execution.input?.githubUser || workflow.inputs?.githubUser || "";

    try {
      execution.input.githubActivity = reportScope === "personal"
        ? await fetchGitHubPersonalActivity(githubUser, execution.input)
        : await fetchGitHubWeeklyActivity(repo, execution.input);
      execution.artifacts = createExecutionArtifacts(workflow, execution.input);
      execution.artifacts.github = execution.input.githubActivity.repoInfo || null;
      return execution;
    } catch (error) {
      execution.input.githubActivity = {
        repo: reportScope === "personal" ? `@${githubUser || "github-user"}` : repo,
        scope: reportScope,
        ok: false,
        error: error.message
      };
      execution.artifacts = createExecutionArtifacts(workflow, execution.input);
      execution.artifacts.github = { repo: execution.input.githubActivity.repo, ok: false, error: error.message };
      return execution;
    }
  }

  const repo = execution.input?.repo || repoFromWorkflow(workflow);
  if (!repo) return execution;

  try {
    execution.artifacts.github = await fetchGitHubRepo(repo);
    if (execution.artifacts.github?.ok) {
      execution.artifacts.prSummary = `PR draft package for ${repo}: replay workflow changes against ${execution.artifacts.github.defaultBranch}, then request checkpoint approval before publishing.`;
    }
  } catch (error) {
    execution.artifacts.github = { repo, ok: false, error: error.message };
  }

  return execution;
}

async function deliverWeeklyReportIfReady(execution, workflow) {
  if (!isWeeklyReportWorkflow(workflow) || execution.status !== "complete" || !execution.artifacts?.weeklyReport) return;
  const report = execution.artifacts.weeklyReport;
  if (report.delivery) return;

  if (!report.ok || !report.reportText) {
    report.delivery = {
      status: "drafted",
      message: "GitHub activity was unavailable, so FlowGuard did not send automatically.",
      deliveredAt: new Date().toISOString()
    };
    return;
  }

  if (report.destination.toLowerCase() !== "slack") {
    report.delivery = {
      status: "drafted",
      message: "Email/update draft is ready after approval.",
      deliveredAt: new Date().toISOString()
    };
    return;
  }

  if (!SLACK_WEBHOOK_URL) {
    report.delivery = {
      status: "drafted",
      message: "Slack webhook is not configured, so FlowGuard kept this as a send-ready draft.",
      deliveredAt: new Date().toISOString()
    };
    return;
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: report.reportText })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    report.delivery = {
      status: "failed",
      message: text || "Slack webhook request failed.",
      deliveredAt: new Date().toISOString()
    };
    return;
  }

  report.delivery = {
    status: "sent",
    message: `Posted approved weekly report to ${report.channel}.`,
    deliveredAt: new Date().toISOString()
  };
}

function buildMemoryStats(db) {
  const decisions = db.executions.flatMap(execution =>
    (execution.decisions || []).map(decision => ({
      ...decision,
      executionId: execution.id,
      workflowId: execution.workflowId
    }))
  );
  const sortedDecisions = decisions.sort((a, b) => new Date(b.decidedAt || 0) - new Date(a.decidedAt || 0));
  const sortedExecutions = [...db.executions].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));

  return {
    storage: storageMode,
    database: storageMode === "mongodb" ? MONGODB_DB : "local-json",
    atlasActive: storageMode === "mongodb",
    workflows: db.workflows.length,
    traces: db.traces.length,
    executions: db.executions.length,
    decisions: decisions.length,
    approvals: decisions.filter(decision => decision.decision === "approved").length,
    rejections: decisions.filter(decision => decision.decision === "rejected").length,
    lastDecision: sortedDecisions[0] || null,
    lastExecution: sortedExecutions[0] || null
  };
}

function memoryStatsForWorkspace(db, workspaceId) {
  return buildMemoryStats({
    ...db,
    workflows: scopedItems(db.workflows, workspaceId),
    traces: scopedItems(db.traces, workspaceId),
    executions: scopedItems(db.executions, workspaceId)
  });
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function classifyTraceEvent(event) {
  const text = `${event.type || ""} ${event.label || ""} ${event.url || ""} ${event.note || ""}`.toLowerCase();
  const isHigh = ["send", "slack", "deploy", "publish", "email", "merge", "production"].some(word => text.includes(word));
  if (event.type === "page_view" && !isHigh) return "low";
  const isMedium = isHigh || ["github", "pull", "pr", "commit", "save", "submit", "delete", "jira", "linear"].some(word => text.includes(word));
  return isHigh ? "high" : isMedium ? "medium" : "low";
}

function summarizeTraceEvent(event, index) {
  const app = event.app || hostnameFromUrl(event.url);
  if (event.type === "page_view") return `Open ${titleCase(app)}`;
  if (event.type === "click") return `Click ${event.label || "important control"} in ${titleCase(app)}`;
  if (event.type === "form_change") return `Fill ${event.label || "a form field"} in ${titleCase(app)}`;
  if (event.type === "note") return `Human note: ${event.note || event.label || "judgment needed"}`;
  return event.label || `Recorded action ${index + 1}`;
}

function collapseTraceEvents(events) {
  const seen = new Set();
  const steps = [];

  for (const event of events) {
    if (!event || !event.type) continue;
    const title = summarizeTraceEvent(event, steps.length);
    const key = `${event.type}:${title}:${hostnameFromUrl(event.url)}`;
    if (seen.has(key) && event.type !== "note") continue;
    seen.add(key);

    const risk = classifyTraceEvent(event);
    steps.push({
      title,
      detail: event.note
        || event.selector
        || event.url
        || `Captured by FlowGuard Recorder at ${event.timestamp || "unknown time"}.`,
      risk,
      sourceEvent: event
    });

    if (steps.length >= 8) break;
  }

  return steps.length ? steps : [
    {
      title: "Review captured browser context",
      detail: "Recorder trace did not include enough events, so FlowGuard created a review step.",
      risk: "low",
      sourceEvent: {}
    }
  ];
}

function createWorkflowFromTrace(trace) {
  const events = Array.isArray(trace.events) ? trace.events : [];
  const steps = collapseTraceEvents(events);
  const checkpoints = steps
    .map((step, index) => {
      if (step.risk === "low" && index < steps.length - 1) return null;
      return {
        id: `trace-cp-${index + 1}`,
        action: step.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        title: `Approve: ${step.title}`,
        risk: step.risk === "high" ? "high" : "medium",
        requiresApproval: true,
        reason: step.risk === "high"
          ? "The recorded action may affect teammates, customers, production, or external communication."
          : "The recorded action changes shared work and should be reviewed before replay.",
        proposedAction: step.title
      };
    })
    .filter(Boolean);

  const workflowName = trace.name || `${titleCase(hostnameFromUrl(events[0]?.url))} Recorded Workflow`;

  return {
    id: `trace-workflow-${Date.now()}`,
    name: workflowName,
    tagline: "Generated from a real browser recorder trace.",
    status: "ready",
    owner: trace.owner || "Recorded by extension",
    lastRun: null,
    template: "Browser recorder trace",
    goal: trace.goal || "Replay this captured team workflow with safety checkpoints.",
    inputs: {
      traceId: trace.id,
      source: "FlowGuard Chrome Recorder",
      eventCount: events.length,
      repo: events.map(event => repoFromGitHubUrl(event.url)).find(Boolean) || undefined
    },
    agents: seedData.workflows[0].agents,
    recordedSteps: steps.map((step, index) => ({
      id: `trace-step-${index + 1}`,
      source: "Browser trace",
      title: step.title,
      detail: step.detail,
      risk: step.risk,
      judgment: riskScore(step.risk) >= 2
    })),
    plan: steps.map((step, index) => {
      const checkpoint = checkpoints.find(item => item.proposedAction === step.title);
      return {
        id: `trace-plan-${index + 1}`,
        agent: checkpoint ? "checkpoint" : index === 0 ? "planner" : "executor",
        title: step.title,
        status: checkpoint ? "blocked" : "pending",
        detail: `Replay recorder event: ${step.detail}`,
        risk: checkpoint?.risk || step.risk,
        checkpointId: checkpoint?.id
      };
    }),
    checkpoints
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.method === "GET" && pathname === "/api/recorder/session") {
    return sendJson(res, 200, { session: recorderSession });
  }

  if (req.method === "POST" && pathname === "/api/recorder/session") {
    const body = await readBody(req);
    recorderSession = normalizeRecorderSession(body.session);
    return sendJson(res, 200, { session: recorderSession });
  }

  const db = await readDb();
  const workspaceId = getWorkspaceId(req);

  if (req.method === "POST" && pathname === "/api/auth/signup") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const workspaceName = String(body.workspaceName || "").trim();

    if (!name || !email || !password || !workspaceName) {
      return sendJson(res, 400, { error: "Name, email, password, and workspace are required." });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: "Password must be at least 6 characters." });
    }
    if (db.users.some(user => user.email === email)) {
      return sendJson(res, 409, { error: "An account with this email already exists. Sign in instead." });
    }

    const workspaceSlug = slugify(workspaceName);
    let workspace = db.workspaces.find(item => item.slug === workspaceSlug);
    if (!workspace) {
      workspace = {
        id: `ws-${workspaceSlug}`,
        slug: workspaceSlug,
        name: workspaceName,
        createdBy: email,
        createdAt: new Date().toISOString()
      };
      db.workspaces.push(workspace);
    }

    const passwordRecord = hashPassword(password);
    const user = {
      id: `user-${crypto.randomUUID()}`,
      name,
      email,
      workspaceId: workspace.id,
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);

    ensureWorkspaceSeedWorkflows(db, { ...workspace, createdBy: user.email });
    await writeDb(db);
    return sendJson(res, 201, { user: publicUser(user), workspace });
  }

  if (req.method === "POST" && pathname === "/api/auth/signin") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = db.users.find(item => item.email === email);
    if (!user || !verifyPassword(password, user)) {
      return sendJson(res, 401, { error: "Invalid email or password." });
    }

    const workspace = db.workspaces.find(item => item.id === user.workspaceId);
    if (!workspace) {
      return sendJson(res, 404, { error: "Workspace not found for this account." });
    }

    ensureWorkspaceSeedWorkflows(db, { ...workspace, createdBy: user.email });
    await writeDb(db);
    return sendJson(res, 200, { user: publicUser(user), workspace });
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      storage: storageMode,
      database: storageMode === "mongodb" ? MONGODB_DB : "local-json",
      llmPlanner: Boolean(OPENAI_API_KEY),
      llmPlannerHealthy: Boolean(OPENAI_API_KEY) && !lastPlannerError,
      plannerLastError: lastPlannerError,
      model: OPENAI_API_KEY ? OPENAI_MODEL : null,
      githubIntegration: true,
      githubAuthenticated: Boolean(GITHUB_TOKEN),
      slackConfigured: Boolean(SLACK_WEBHOOK_URL),
      allowDemoReset: ALLOW_DEMO_RESET
    });
  }

  if (req.method === "POST" && pathname === "/api/admin/reset-demo") {
    if (!ALLOW_DEMO_RESET) {
      return sendJson(res, 403, { error: "Demo reset is disabled. Set ALLOW_DEMO_RESET=true to enable it." });
    }
    const resetDb = workspaceId
      ? {
          ...db,
          workflows: db.workflows.filter(item => item.workspaceId !== workspaceId),
          traces: db.traces.filter(item => item.workspaceId !== workspaceId),
          executions: db.executions.filter(item => item.workspaceId !== workspaceId)
        }
      : freshSeedData();
    if (workspaceId) {
      const workspace = db.workspaces.find(item => item.id === workspaceId);
      if (workspace) ensureWorkspaceSeedWorkflows(resetDb, workspace);
    }
    await writeDb(resetDb);
    return sendJson(res, 200, {
      ok: true,
      storage: storageMode,
      workflows: scopedItems(resetDb.workflows, workspaceId).length,
      traces: scopedItems(resetDb.traces, workspaceId).length,
      executions: scopedItems(resetDb.executions, workspaceId).length
    });
  }

  if (req.method === "POST" && pathname === "/api/admin/clear-test-auth") {
    if (!ALLOW_DEMO_RESET) {
      return sendJson(res, 403, { error: "Test auth cleanup is disabled. Set ALLOW_DEMO_RESET=true to enable it." });
    }
    const emails = ["auth-tester@flowguard.dev", "clean-auth@flowguard.dev", "approver@flowguard.dev", "yutong@flowguard.dev"];
    const workspaces = ["ws-auth-demo", "ws-clean-auth-demo", "ws-demo-workspace", "ws-flowguard-team"];
    db.users = db.users.filter(user => !emails.includes(user.email));
    db.workspaces = db.workspaces.filter(workspace => !workspaces.includes(workspace.id));
    db.workflows = db.workflows.filter(workflow => !workspaces.includes(workflow.workspaceId));
    db.executions = db.executions.filter(execution => !workspaces.includes(execution.workspaceId));
    db.traces = db.traces.filter(trace => !workspaces.includes(trace.workspaceId));
    await writeDb(db);
    return sendJson(res, 200, { ok: true, removedEmails: emails.length, removedWorkspaces: workspaces.length });
  }

  if (req.method === "GET" && pathname === "/api/memory") {
    return sendJson(res, 200, memoryStatsForWorkspace(db, workspaceId));
  }

  if (req.method === "GET" && pathname === "/api/workflows") {
    return sendJson(res, 200, scopedItems(db.workflows, workspaceId));
  }

  const workflowMatch = pathname.match(/^\/api\/workflows\/([^/]+)$/);
  if (req.method === "GET" && workflowMatch) {
    const workflow = scopedItems(db.workflows, workspaceId).find(item => item.id === workflowMatch[1]);
    return workflow ? sendJson(res, 200, workflow) : sendJson(res, 404, { error: "Workflow not found" });
  }

  if (req.method === "POST" && pathname === "/api/workflows") {
    const body = await readBody(req);
    const baseWorkflow = createWorkflowFromTeach(body);
    const workflow = await enhanceWorkflowWithLlm(baseWorkflow, {
      source: "manual_teach_form",
      name: body.name,
      goal: body.goal,
      steps: body.steps || []
    }, "LLM planner");
    workflow.workspaceId = workspaceId || body.workspaceId || null;
    workflow.createdBy = req.headers["x-user-email"] || body.createdBy || null;
    db.workflows.unshift(workflow);
    await writeDb(db);
    return sendJson(res, 201, workflow);
  }

  if (req.method === "PUT" && workflowMatch) {
    const body = await readBody(req);
    const index = db.workflows.findIndex(item => item.id === workflowMatch[1] && (!workspaceId || !item.workspaceId || item.workspaceId === workspaceId));
    if (index === -1) return sendJson(res, 404, { error: "Workflow not found" });

    const baseWorkflow = rebuildWorkflowFromEdit(db.workflows[index], body);
    const workflow = await enhanceWorkflowWithLlm(baseWorkflow, {
      source: "workflow_edit",
      name: body.name || baseWorkflow.name,
      goal: body.goal || baseWorkflow.goal,
      steps: body.steps || baseWorkflow.recordedSteps.map(step => step.title)
    }, "LLM planner");
    db.workflows[index] = workflow;
    db.executions = db.executions.filter(execution => execution.workflowId !== workflow.id);
    await writeDb(db);
    return sendJson(res, 200, workflow);
  }

  if (req.method === "DELETE" && workflowMatch) {
    const index = db.workflows.findIndex(item => item.id === workflowMatch[1] && (!workspaceId || !item.workspaceId || item.workspaceId === workspaceId));
    if (index === -1) return sendJson(res, 404, { error: "Workflow not found" });

    const [deleted] = db.workflows.splice(index, 1);
    db.executions = db.executions.filter(execution => execution.workflowId !== deleted.id);
    db.traces = db.traces.map(trace => trace.workflowId === deleted.id ? { ...trace, workflowId: null } : trace);
    await writeDb(db);
    return sendJson(res, 200, { deleted });
  }

  if (req.method === "GET" && pathname === "/api/traces") {
    return sendJson(res, 200, scopedItems(db.traces, workspaceId));
  }

  if (req.method === "POST" && pathname === "/api/traces") {
    const body = await readBody(req);
    const trace = {
      id: body.id || crypto.randomUUID(),
      name: body.name || "Recorded Browser Workflow",
      goal: body.goal || "",
      owner: body.owner || "FlowGuard Recorder",
      createdAt: body.createdAt || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      workspaceId: workspaceId || body.workspaceId || null,
      events: Array.isArray(body.events) ? body.events.slice(0, 200) : []
    };
    const baseWorkflow = createWorkflowFromTrace(trace);
    const workflow = body.useLlm === false ? baseWorkflow : await enhanceWorkflowWithLlm(baseWorkflow, {
      source: "browser_recorder_trace",
      name: trace.name,
      goal: trace.goal,
      events: trace.events
    }, "LLM planner");
    workflow.workspaceId = trace.workspaceId;
    workflow.createdBy = req.headers["x-user-email"] || body.createdBy || null;
    trace.workflowId = workflow.id;
    db.traces.unshift(trace);
    db.workflows.unshift(workflow);
    await writeDb(db);
    return sendJson(res, 201, { trace, workflow });
  }

  const runMatch = pathname.match(/^\/api\/workflows\/([^/]+)\/runs$/);
  if (req.method === "POST" && runMatch) {
    const body = await readBody(req);
    const workflow = scopedItems(db.workflows, workspaceId).find(item => item.id === runMatch[1]);
    if (!workflow) return sendJson(res, 404, { error: "Workflow not found" });

    const execution = await enrichExecutionArtifacts(createExecution(workflow, body.input), workflow);
    execution.workspaceId = workspaceId || workflow.workspaceId || null;
    db.executions.unshift(execution);
    workflow.lastRun = execution.startedAt;
    await writeDb(db);
    return sendJson(res, 201, execution);
  }

  const executionMatch = pathname.match(/^\/api\/executions\/([^/]+)$/);
  if (req.method === "GET" && executionMatch) {
    const execution = scopedItems(db.executions, workspaceId).find(item => item.id === executionMatch[1]);
    return execution ? sendJson(res, 200, execution) : sendJson(res, 404, { error: "Execution not found" });
  }

  const decisionMatch = pathname.match(/^\/api\/executions\/([^/]+)\/decisions$/);
  if (req.method === "POST" && decisionMatch) {
    const body = await readBody(req);
    const execution = scopedItems(db.executions, workspaceId).find(item => item.id === decisionMatch[1]);
    if (!execution) return sendJson(res, 404, { error: "Execution not found" });

    const workflow = db.workflows.find(item => item.id === execution.workflowId);
    if (!workflow) return sendJson(res, 404, { error: "Workflow not found" });

    execution.decisions.push({
      id: crypto.randomUUID(),
      checkpointId: body.checkpointId,
      decision: body.decision,
      instruction: body.instruction || "",
      decidedAt: new Date().toISOString()
    });

    if (body.instruction) {
      execution.input.editInstructions ||= [];
      execution.input.editInstructions.push(body.instruction);
      execution.artifacts = {
        ...createExecutionArtifacts(workflow, execution.input),
        github: execution.artifacts.github || null,
        failure: execution.artifacts.failure || null
      };
    }

    if (body.decision === "rejected") {
      execution.status = "failed";
      execution.artifacts.failure = {
        step: workflow.checkpoints.find(item => item.id === body.checkpointId)?.title || "Checkpoint",
        why: "Human rejected the planned action because it needed a safer instruction.",
        fix: body.instruction || "Edit the plan, narrow the blast radius, then rerun this checkpoint."
      };
    } else {
      advanceExecution(workflow, execution);
      await deliverWeeklyReportIfReady(execution, workflow);
    }

    await writeDb(db);
    return sendJson(res, 200, execution);
  }

  return sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }

    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

async function start() {
  await connectStorage();
  const listenHosts = HOST === "0.0.0.0" || HOST === "::" ? [HOST, "127.0.0.1"] : [HOST, "127.0.0.1"];

  for (const host of listenHosts) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(PORT, host);
      });

      const origin = host === "0.0.0.0" || host === "::" ? "localhost" : host;
      console.log(`FlowGuard running at http://${origin}:${PORT}`);
      console.log(`Storage: ${storageMode}${storageMode === "mongodb" ? ` (${MONGODB_DB})` : ""}`);
      return;
    } catch (error) {
      const retryable = ["EACCES", "EPERM"].includes(error.code);
      if (!retryable || host === "127.0.0.1") {
        throw error;
      }
      console.warn(`Unable to listen on ${host}:${PORT}, retrying on 127.0.0.1: ${error.message}`);
    }
  }
}

process.on("SIGINT", async () => {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});

start().catch(error => {
  console.error("Failed to start FlowGuard:", error);
  process.exit(1);
});
