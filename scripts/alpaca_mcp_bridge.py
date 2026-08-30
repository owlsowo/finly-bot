"""Minimal pinned bridge from Finly's Node agent to Alpaca's official MCP server.

The bridge reads one already-validated multi-leg order projection from stdin,
starts ``alpaca-mcp-server==2.2.1`` in explicit paper mode, verifies the live
tool schema, and invokes only ``place_option_order``. It deliberately returns
an acknowledgement shape rather than the raw broker response; Finly performs
an independent REST read-back by client order ID and treats that read-back as
the source of truth.

Credentials are loaded from process environment or the ignored ``.env.local``
file. They are never accepted on the command line or written to stdout.
"""

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
EXPECTED_TOOL = "place_option_order"
EXPECTED_SCHEMA_HASH = "sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55"
MUTATION_ACK = "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT"
TOP_LEVEL_KEYS = {
    "client_order_id",
    "legs",
    "limit_price",
    "order_class",
    "qty",
    "time_in_force",
    "type",
}
LEG_KEYS = {"position_intent", "ratio_qty", "side", "symbol"}
OCC_PATTERN = re.compile(r"^[A-Z]{1,6}\d{6}[CP]\d{8}$")
ENTRY_CLIENT_ID_PATTERN = re.compile(r"^finly-[a-f0-9]{20}$")
EXIT_CLIENT_ID_PATTERN = re.compile(r"^finly-exit-[a-f0-9]{20}$")


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
        raise ValueError("MCP projection contains missing or unknown top-level fields")
    if value["order_class"] != "mleg" or value["type"] != "limit" or value["time_in_force"] != "day":
        raise ValueError("MCP projection violates the pinned multi-leg limit-order policy")
    if not isinstance(value["qty"], str) or not value["qty"].isdigit() or not 1 <= int(value["qty"]) <= 4:
        raise ValueError("MCP projection quantity is outside policy")
    legs = value.get("legs")
    if not isinstance(legs, list) or len(legs) != 2:
        raise ValueError("MCP projection must contain exactly two legs")
    for leg in legs:
        if not isinstance(leg, dict) or set(leg) != LEG_KEYS:
            raise ValueError("MCP projection leg contains missing or unknown fields")
        if leg["ratio_qty"] != "1" or leg["side"] not in {"buy", "sell"}:
            raise ValueError("MCP projection leg ratio or side is invalid")
        if not OCC_PATTERN.fullmatch(str(leg["symbol"])):
            raise ValueError("MCP projection contains an invalid OCC symbol")
    is_entry = ENTRY_CLIENT_ID_PATTERN.fullmatch(str(value["client_order_id"])) is not None
    is_exit = EXIT_CLIENT_ID_PATTERN.fullmatch(str(value["client_order_id"])) is not None
    if is_entry:
        if not isinstance(value["limit_price"], str) or not re.fullmatch(r"\d+\.\d{2}", value["limit_price"]):
            raise ValueError("MCP entry projection requires a positive two-decimal debit limit")
        expected = {("buy", "buy_to_open"), ("sell", "sell_to_open")}
        if {(leg["side"], leg["position_intent"]) for leg in legs} != expected:
            raise ValueError("MCP projection must open one long and one short option leg")
    elif is_exit:
        if not isinstance(value["limit_price"], str) or not re.fullmatch(r"-\d+\.\d{2}", value["limit_price"]):
            raise ValueError("MCP exit projection requires a negative two-decimal credit limit")
        expected = {("sell", "sell_to_close"), ("buy", "buy_to_close")}
        if {(leg["side"], leg["position_intent"]) for leg in legs} != expected:
            raise ValueError("MCP projection must close one long and one short option leg")
    else:
        raise ValueError("MCP projection has an invalid Finly idempotency key")
    return value


def read_projection() -> dict[str, Any]:
    raw = os.read(0, 16_385)
    if len(raw) > 16_384:
        raise ValueError("MCP projection exceeds the bounded input size")
    try:
        return validate_projection(json.loads(raw.decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("MCP projection is not valid UTF-8 JSON") from error


def safe_content_types(result: Any) -> list[dict[str, str]]:
    allowed = {"audio", "image", "resource", "resource_link", "text"}
    types = sorted({getattr(block, "type", None) for block in result.content})
    return [{"type": item} for item in types if item in allowed]


async def invoke(server_command: str, projection: dict[str, Any]) -> dict[str, Any]:
    local = local_configuration()
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

    inherited_names = {
        "PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE", "NO_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
    }
    server_env = {name: value for name, value in os.environ.items() if name in inherited_names}
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
                read_stream,
                write_stream,
                read_timeout_seconds=timedelta(seconds=30),
            ) as session:
                await session.initialize()
                tools = await session.list_tools()
                tool = next((item for item in tools.tools if item.name == EXPECTED_TOOL), None)
                if tool is None or canonical_sha256(tool.inputSchema) != EXPECTED_SCHEMA_HASH:
                    raise RuntimeError("pinned Alpaca MCP tool schema drifted")
                result = await session.call_tool(EXPECTED_TOOL, projection)
    if result.isError:
        raise RuntimeError("Alpaca MCP paper mutation returned an error")
    return {
        "schema_version": "alpaca_mcp_mutation_ack.v1",
        "isError": False,
        "content": safe_content_types(result),
        "structuredContent": {} if result.structuredContent is not None else None,
        "server": EXPECTED_PACKAGE,
        "version": EXPECTED_VERSION,
        "tool": EXPECTED_TOOL,
        "schema_sha256": EXPECTED_SCHEMA_HASH,
        "raw_response_retained": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-command", required=True)
    args = parser.parse_args()
    command = Path(args.server_command)
    if not command.is_file() or not os.access(command, os.X_OK):
        raise RuntimeError("pinned Alpaca MCP server executable is unavailable")
    projection = read_projection()
    result = asyncio.run(invoke(str(command.resolve()), projection))
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Stdio/server exceptions are untrusted and may echo configuration.
        # Preserve only a fixed category across the subprocess boundary.
        print(
            json.dumps(
                {"status": "ERROR", "error": "paper mutation bridge rejected the request"},
                sort_keys=True,
            ),
            file=os.sys.stderr,
        )
        raise SystemExit(1)
