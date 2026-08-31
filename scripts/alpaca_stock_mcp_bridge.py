"""Pinned paper-only bridge for Finly's one-time G4 ETF allocation."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
import re
from contextlib import redirect_stderr
from datetime import timedelta
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

REPO = Path(__file__).resolve().parents[1]
EXPECTED_PACKAGE = "alpaca-mcp-server"
EXPECTED_VERSION = "2.2.1"
EXPECTED_TOOL = "place_stock_order"
EXPECTED_SCHEMA_HASH = "sha256:3826d0d06bf6c48e77897fa2a833431a42287b34c4bb9a3a303db7b726759288"
MUTATION_ACK = "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT"
TOP_LEVEL_KEYS = {"client_order_id", "notional", "side", "symbol", "time_in_force", "type"}
SYMBOLS = {"QQQ", "XLB", "XLE", "XLV"}
CLIENT_ID_PATTERN = re.compile(r"^finly-g4-[a-f0-9]{20}$")


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def local_configuration() -> dict[str, str | None]:
    return dotenv_values(REPO / ".env.local") if (REPO / ".env.local").exists() else {}


def configured(name: str, local: dict[str, str | None]) -> str | None:
    return os.environ.get(name) or local.get(name)


def credential(names: tuple[str, ...], local: dict[str, str | None], label: str) -> str:
    for name in names:
        value = configured(name, local)
        if value and len(value) >= 12 and "REPLACE" not in value:
            return value
    raise RuntimeError(f"missing local Alpaca paper {label}")


def validate_projection(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != TOP_LEVEL_KEYS:
        raise ValueError("stock MCP projection contains missing or unknown fields")
    if value["symbol"] not in SYMBOLS or value["side"] != "buy":
        raise ValueError("stock MCP projection violates the G4 allowlist")
    if value["type"] != "market" or value["time_in_force"] != "day":
        raise ValueError("stock MCP projection must be a market/day order")
    if not isinstance(value["notional"], str) or not re.fullmatch(r"\d{1,6}\.\d{2}", value["notional"]):
        raise ValueError("stock MCP projection requires a two-decimal notional")
    if not 0 < float(value["notional"]) <= 50_000:
        raise ValueError("stock MCP projection notional is outside policy")
    if CLIENT_ID_PATTERN.fullmatch(str(value["client_order_id"])) is None:
        raise ValueError("stock MCP projection has an invalid idempotency key")
    return value


def read_projection() -> dict[str, Any]:
    raw = os.read(0, 8_193)
    if len(raw) > 8_192:
        raise ValueError("stock MCP projection exceeds the bounded input size")
    try:
        return validate_projection(json.loads(raw.decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("stock MCP projection is not valid UTF-8 JSON") from error


async def invoke(server_command: str, projection: dict[str, Any]) -> dict[str, Any]:
    local = local_configuration()
    if configured("FINLY_G4_PRODUCTION_ENABLED", local) != "true":
        raise RuntimeError("G4 production mutation is not explicitly enabled")
    if configured("FINLY_EXECUTION_ENABLED", local) != "true":
        raise RuntimeError("paper mutation is not explicitly enabled")
    if configured("FINLY_EXECUTION_TRANSPORT", local) != "mcp":
        raise RuntimeError("paper mutation transport is not pinned to MCP")
    if configured("ALPACA_PAPER_TRADE", local) != "true":
        raise RuntimeError("Alpaca paper mode is not explicit")
    if configured("FINLY_PAPER_MUTATION_ACK", local) != MUTATION_ACK:
        raise RuntimeError("paper mutation acknowledgement is absent")

    api_key = credential(("ALPACA_API_KEY", "APCA_API_KEY_ID"), local, "API key")
    secret_key = credential(("ALPACA_SECRET_KEY", "APCA_API_SECRET_KEY"), local, "secret key")
    if importlib.metadata.version(EXPECTED_PACKAGE) != EXPECTED_VERSION:
        raise RuntimeError("pinned Alpaca MCP package version is unavailable")
    inherited = {
        "PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE", "NO_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
    }
    server_env = {name: value for name, value in os.environ.items() if name in inherited}
    server_env.update({
        "ALPACA_API_KEY": api_key,
        "ALPACA_SECRET_KEY": secret_key,
        "ALPACA_PAPER_TRADE": "true",
        "ALPACA_TOOLSETS": "trading",
    })
    parameters = StdioServerParameters(command=server_command, env=server_env, cwd=REPO)
    with open(os.devnull, "w", encoding="utf-8") as devnull, redirect_stderr(devnull):
        async with stdio_client(parameters, errlog=devnull) as (read_stream, write_stream):
            async with ClientSession(
                read_stream, write_stream, read_timeout_seconds=timedelta(seconds=30)
            ) as session:
                await session.initialize()
                tools = await session.list_tools()
                tool = next((item for item in tools.tools if item.name == EXPECTED_TOOL), None)
                if tool is None or canonical_sha256(tool.inputSchema) != EXPECTED_SCHEMA_HASH:
                    raise RuntimeError("pinned Alpaca stock MCP schema drifted")
                result = await session.call_tool(EXPECTED_TOOL, projection)
    if result.isError:
        raise RuntimeError("Alpaca MCP stock paper mutation returned an error")
    return {
        "schema_version": "alpaca_mcp_stock_mutation_ack.v1",
        "isError": False,
        "server": EXPECTED_PACKAGE,
        "version": EXPECTED_VERSION,
        "tool": EXPECTED_TOOL,
        "schema_sha256": EXPECTED_SCHEMA_HASH,
        "raw_response_retained": False,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-command", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    projection = read_projection()
    result = asyncio.run(invoke(args.server_command, projection))
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
