"""
FlowGuard Agentverse/uAgents scaffold.

This file is intentionally a wrapper, not a required part of the local demo.
Use it when the team is ready to register or host a FlowGuard-compatible agent.

Install later:
    pip install uagents requests

Run later:
    FLOWGUARD_API_URL=http://localhost:5173 python flowguard_agent.py
"""

import os
from typing import Any, Dict, List

import requests
from uagents import Agent, Context, Model


FLOWGUARD_API_URL = os.getenv("FLOWGUARD_API_URL", "http://localhost:5173")


class TraceEvent(Model):
    type: str
    app: str = ""
    url: str = ""
    title: str = ""
    label: str = ""
    selector: str = ""
    note: str = ""
    redacted: bool = True


class PlanWorkflow(Model):
    name: str
    goal: str
    events: List[TraceEvent]


class RunWorkflow(Model):
    workflow_id: str
    input: Dict[str, Any] = {}


class CheckpointDecision(Model):
    execution_id: str
    checkpoint_id: str
    decision: str
    instruction: str = ""


flowguard_agent = Agent(
    name="flowguard_workflow_executor",
    seed=os.getenv("FLOWGUARD_AGENT_SEED", "flowguard-demo-seed"),
    port=int(os.getenv("FLOWGUARD_AGENT_PORT", "8001")),
    endpoint=[os.getenv("FLOWGUARD_AGENT_ENDPOINT", "http://localhost:8001/submit")],
)


@flowguard_agent.on_message(model=PlanWorkflow)
async def plan_workflow(ctx: Context, sender: str, msg: PlanWorkflow):
    response = requests.post(
        f"{FLOWGUARD_API_URL}/api/traces",
        json={
            "name": msg.name,
            "goal": msg.goal,
            "events": [event.dict() for event in msg.events],
        },
        timeout=20,
    )
    response.raise_for_status()
    ctx.logger.info("Planned workflow for %s: %s", sender, response.json()["workflow"]["id"])


@flowguard_agent.on_message(model=RunWorkflow)
async def run_workflow(ctx: Context, sender: str, msg: RunWorkflow):
    response = requests.post(
        f"{FLOWGUARD_API_URL}/api/workflows/{msg.workflow_id}/runs",
        json={"input": msg.input},
        timeout=20,
    )
    response.raise_for_status()
    ctx.logger.info("Started execution for %s: %s", sender, response.json()["id"])


@flowguard_agent.on_message(model=CheckpointDecision)
async def decide_checkpoint(ctx: Context, sender: str, msg: CheckpointDecision):
    response = requests.post(
        f"{FLOWGUARD_API_URL}/api/executions/{msg.execution_id}/decisions",
        json={
            "checkpointId": msg.checkpoint_id,
            "decision": msg.decision,
            "instruction": msg.instruction,
        },
        timeout=20,
    )
    response.raise_for_status()
    ctx.logger.info("Checkpoint decision from %s: %s", sender, msg.decision)


if __name__ == "__main__":
    flowguard_agent.run()
