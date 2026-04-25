# FlowGuard Agent Wrapper

This folder makes the multi-agent architecture visible for Fetch/Agentverse judging without forcing deployment before the product demo is polished.

## Agents

- **Planner Agent:** converts a recorded trace into a workflow plan.
- **Executor Agent:** starts workflow runs and advances safe steps.
- **Checkpoint Agent:** decides when human approval is required.

## Current Integration

The running FlowGuard app already exposes the agent actions through HTTP:

```text
POST /api/traces
POST /api/workflows/:id/runs
POST /api/executions/:id/decisions
```

The `agentverse/flowguard_agent.py` file is a uAgents-style wrapper scaffold that can call those endpoints once the team is ready to register or host it.

## Why This Exists

Fetch.ai's Agentverse is a platform for hosting, discovering, and connecting agents, while uAgents provides a message-based framework for agent communication. FlowGuard maps naturally onto that model because Planner, Executor, and Checkpoint are separate responsibilities in a multi-agent workflow.
