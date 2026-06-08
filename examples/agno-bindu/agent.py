"""Lex Korea — the agent definition.

This module defines the agent and how it should be launched. It does not
start any server by itself. The agent is consumed in two ways:

- `cli.py` imports it for one-shot command-line questions.
- `bindu_agent.py` imports it and exposes it over the A2A protocol as a
  Bindu microservice. This is the primary entry point for the example.

The Model Context Protocol (MCP) server lives in this repository — it is the
Node/TypeScript `korean-law-mcp` server. We launch its built entry point
(`build/index.js`) as a child process over stdio, so no global npm install of
`korean-law-mcp` is required; a local `npm install && npm run build` at the
repo root is enough.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).parent.resolve()
REPO_ROOT = HERE.parent.parent.resolve()  # examples/agno-bindu → repo root

# Load this example's .env deterministically, regardless of the current
# working directory (so `cli.py` run from the repo root still picks it up).
load_dotenv(HERE / ".env")

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.openrouter import OpenRouter
from mcp import StdioServerParameters
from mcp.client.stdio import get_default_environment

from prompts import AGENT_DESCRIPTION, AGENT_NAME, SYSTEM_PROMPT

DB_PATH = HERE / "tmp" / "lex_korea.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# The built Node entry point. `npm run build` (tsc) emits this from src/index.ts.
MCP_ENTRY = REPO_ROOT / "build" / "index.js"


def _mcp_server_params() -> StdioServerParameters:
    """Build the launch command for the local Korean-law MCP server.

    Runs the repo's built Node entry point in its default stdio mode. The
    upstream server reads its 법제처 open-API key from `LAW_OC` in its own
    process environment — and the MCP stdio client does NOT inherit arbitrary
    parent env vars, only a small safe set (PATH, HOME, …). So we merge
    `LAW_OC` (and the optional `LAW_API_PROTOCOL`) into the child env
    explicitly; otherwise every upstream API call comes back unauthenticated.
    """
    if not MCP_ENTRY.exists():
        raise RuntimeError(
            f"Korean-law MCP server is not built: {MCP_ENTRY} is missing. "
            "Run `npm install && npm run build` at the repo root first "
            "(see examples/agno-bindu/README.md → Setup)."
        )

    law_oc = os.getenv("LAW_OC") or os.getenv("KOREAN_LAW_API_KEY")
    if not law_oc:
        raise RuntimeError(
            "LAW_OC is not set. The korean-law-mcp server needs a 법제처 "
            "(국가법령정보) open-API key to answer. Issue one at "
            "https://open.law.go.kr/ and add LAW_OC to your .env "
            "(see .env.example)."
        )

    child_env = {
        **get_default_environment(),
        "LAW_OC": law_oc,
        "LAW_API_PROTOCOL": os.getenv("LAW_API_PROTOCOL", "https"),
    }
    return StdioServerParameters(
        command="node",
        args=[str(MCP_ENTRY)],
        cwd=str(REPO_ROOT),
        env=child_env,
    )


def _build_model():
    """Select the language model used by the agent.

    OpenRouter is used as a single endpoint that gives access to many
    providers. The default is `anthropic/claude-sonnet-4.5`, which we have
    found to perform well on both tool use and Korean. The model can be
    changed by setting the `BINDU_AGENT_MODEL` environment variable to any
    model identifier supported by OpenRouter.
    """
    model_id = os.getenv("BINDU_AGENT_MODEL", "anthropic/claude-sonnet-4.5")
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. Add it to your .env file "
            "(see .env.example for the expected layout)."
        )
    return OpenRouter(
        id=model_id,
        api_key=api_key,
        max_tokens=int(os.getenv("BINDU_AGENT_MAX_TOKENS", "4096")),
    )


def build_agent() -> Agent:
    """Create the agent. Tools are attached when the MCP connection opens."""
    return Agent(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        instructions=SYSTEM_PROMPT,
        model=_build_model(),
        db=SqliteDb(db_file=str(DB_PATH)),
        add_history_to_context=True,
        num_history_runs=3,
        add_datetime_to_context=True,
        markdown=True,
    )


# Module-level instance so `cli.py` and `bindu_agent.py` can import it.
agent: Agent = build_agent()
