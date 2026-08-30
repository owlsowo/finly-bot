"""Run one authenticated, read-only call through Alpaca's official MCP server.

This script writes a deliberately redacted evidence trace. It verifies the
expected paper account in memory but never serializes credentials, account
identifiers, buying power, or the raw broker response.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
import shutil
from contextlib import redirect_stderr
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


REPO = Path(__file__).resolve().parents[1]
DEFAULT_TRACE = REPO / "evidence" / "alpaca_mcp_read_trace.json"
EXPECTED_PACKAGE = "alpaca-mcp-server"
EXPECTED_VERSION = "2.2.1"
READ_ONLY_TOOL = "get_account_info"


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def first_named(value: Any, names: set[str]) -> Any | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in names:
                return item
        for item in value.values():
            found = first_named(item, names)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = first_named(item, names)
            if found is not None:
                return found
    return None


def key_paths(value: Any, prefix: str = "") -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            paths.append(path)
            paths.extend(key_paths(item, path))
    elif isinstance(value, list):
        for index, item in enumerate(value[:3]):
            paths.extend(key_paths(item, f"{prefix}[{index}]"))
    return paths


def normalize_result(result: Any) -> Any:
    if result.structuredContent is not None:
        return result.structuredContent
    for block in result.content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                continue
    raise RuntimeError("Alpaca MCP response did not contain structured JSON")


def credential(name: str, aliases: tuple[str, ...], local: dict[str, str | None]) -> str:
    for alias in aliases:
        value = os.environ.get(alias) or local.get(alias)
        if value and len(value) >= 12 and "REPLACE" not in value:
            return value
    raise RuntimeError(f"Missing local {name}; use environment variables or ignored .env.local")


async def run(args: argparse.Namespace) -> dict[str, Any]:
    local = dotenv_values(REPO / ".env.local") if (REPO / ".env.local").exists() else {}
    api_key = credential("API key", ("ALPACA_API_KEY", "APCA_API_KEY_ID"), local)
    secret_key = credential("secret key", ("ALPACA_SECRET_KEY", "APCA_API_SECRET_KEY"), local)

    command = args.server_command or shutil.which("alpaca-mcp-server")
    if not command:
        raise RuntimeError("alpaca-mcp-server is not installed; pass --server-command")

    package_version = importlib.metadata.version(EXPECTED_PACKAGE)
    if package_version != EXPECTED_VERSION:
        raise RuntimeError(f"Expected {EXPECTED_PACKAGE} {EXPECTED_VERSION}, found {package_version}")

    inherited_names = {
        "PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE", "NO_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
    }
    server_env = {name: value for name, value in os.environ.items() if name in inherited_names}
    server_env.update({
        "ALPACA_API_KEY": api_key,
        "ALPACA_SECRET_KEY": secret_key,
        "ALPACA_PAPER_TRADE": "true",
        "ALPACA_TOOLSETS": "account",
    })
    parameters = StdioServerParameters(command=command, env=server_env, cwd=REPO)

    with open(os.devnull, "w", encoding="utf-8") as devnull, redirect_stderr(devnull):
        async with stdio_client(parameters, errlog=devnull) as (read_stream, write_stream):
            async with ClientSession(
                read_stream,
                write_stream,
                read_timeout_seconds=timedelta(seconds=30),
            ) as session:
                initialize_result = await session.initialize()
                tools = await session.list_tools()
                tool = next((item for item in tools.tools if item.name == READ_ONLY_TOOL), None)
                if tool is None:
                    raise RuntimeError(f"Official server did not expose {READ_ONLY_TOOL}")
                result = await session.call_tool(READ_ONLY_TOOL, {})

    if result.isError:
        raise RuntimeError("Authenticated Alpaca MCP read returned an error")
    raw = normalize_result(result)

    account_id = first_named(raw, {"account_number", "account_id"})
    status = first_named(raw, {"status"})
    account_blocked = first_named(raw, {"account_blocked", "blocked"})
    trading_blocked = first_named(raw, {"trading_blocked"})
    options_approved_level = first_named(raw, {"options_approved_level"})
    options_trading_level = first_named(raw, {"options_trading_level"})
    portfolio_value = first_named(raw, {"portfolio_value", "equity"})

    if str(account_id) != args.expected_account_id:
        safe_paths = [path for path in key_paths(raw) if any(token in path.lower() for token in ("account", "status", ".id"))]
        raise RuntimeError(
            "Authenticated MCP response did not match the dedicated hackathon account; "
            f"available safe key paths: {safe_paths}"
        )

    try:
        starting_balance_matches = abs(float(portfolio_value) - 100_000.0) < 0.01
    except (TypeError, ValueError):
        starting_balance_matches = False

    trace = {
        "status": "AUTHENTICATED_MCP_READ_SUCCEEDED",
        "checked_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "server": EXPECTED_PACKAGE,
        "server_version": package_version,
        "protocol_transport": "stdio",
        "mcp_protocol_version": getattr(initialize_result, "protocolVersion", None),
        "tool": READ_ONLY_TOOL,
        "paper": True,
        "authenticated_network_call": True,
        "mutation_requested": False,
        "account_id_redacted": True,
        "safe_account_summary": {
            "status": status,
            "account_blocked": account_blocked,
            "trading_blocked": trading_blocked,
            "options_approved_level": options_approved_level,
            "options_trading_level": options_trading_level,
            "required_starting_balance_matches": starting_balance_matches,
        },
        "tool_schema_sha256": canonical_sha256(tool.inputSchema),
        "raw_response_sha256": canonical_sha256(raw),
        "redaction": "Raw response, account identifiers, balances, buying power, and credentials are not serialized.",
    }
    return trace


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-account-id", required=True)
    parser.add_argument("--server-command")
    parser.add_argument("--output", type=Path, default=DEFAULT_TRACE)
    args = parser.parse_args()
    trace = asyncio.run(run(args))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(trace, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": trace["status"],
        "server": trace["server"],
        "server_version": trace["server_version"],
        "protocol_transport": trace["protocol_transport"],
        "tool": trace["tool"],
        "mutation_requested": trace["mutation_requested"],
        "output": str(args.output),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
