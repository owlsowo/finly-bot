"""Offline runtime introspection for the pinned official Alpaca MCP package."""

import asyncio
import hashlib
import importlib.metadata
import json
import os

os.environ["ALPACA_API_KEY"] = "schema-introspection-dummy-key"
os.environ["ALPACA_SECRET_KEY"] = "schema-introspection-dummy-secret"
os.environ["APCA_API_KEY_ID"] = "schema-introspection-dummy-key"
os.environ["APCA_API_SECRET_KEY"] = "schema-introspection-dummy-secret"
os.environ["ALPACA_PAPER_TRADE"] = "true"
os.environ["ALPACA_TOOLSETS"] = "trading"

from alpaca_mcp_server.server import build_server  # noqa: E402

EXPECTED_VERSION = "2.2.1"
EXPECTED_SCHEMAS = {
    "place_option_order": "sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55",
    "place_stock_order": "sha256:3826d0d06bf6c48e77897fa2a833431a42287b34c4bb9a3a303db7b726759288",
}


async def main() -> None:
    package_version = importlib.metadata.version("alpaca-mcp-server")
    server = build_server()
    tools = await server.list_tools()
    observed = []
    for tool_name, expected_hash in EXPECTED_SCHEMAS.items():
        tool = next((item for item in tools if item.name == tool_name), None)
        if tool is None:
            raise SystemExit("pinned Alpaca MCP runtime tool is absent; mutation must remain disabled")
        canonical = json.dumps(tool.parameters, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        schema_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
        if schema_hash != expected_hash:
            raise SystemExit("pinned Alpaca MCP runtime schema drifted; mutation must remain disabled")
        observed.append({"tool": tool_name, "schema_sha256": schema_hash})
    if package_version != EXPECTED_VERSION:
        raise SystemExit("pinned Alpaca MCP runtime schema drifted; mutation must remain disabled")
    print(json.dumps({
        "status": "RUNTIME_SCHEMAS_MATCH",
        "package": "alpaca-mcp-server",
        "version": package_version,
        "tools": observed,
        "paper": os.environ["ALPACA_PAPER_TRADE"] == "true",
        "network_call_made": False,
    }, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(main())
