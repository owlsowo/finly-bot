"""Offline runtime introspection for the pinned official Alpaca MCP package."""

import asyncio
import hashlib
import importlib.metadata
import json
import os

os.environ.setdefault("ALPACA_API_KEY", "schema-introspection-dummy-key")
os.environ.setdefault("ALPACA_SECRET_KEY", "schema-introspection-dummy-secret")
os.environ["ALPACA_PAPER_TRADE"] = "true"
os.environ["ALPACA_TOOLSETS"] = "trading"

from alpaca_mcp_server.server import build_server  # noqa: E402

EXPECTED_VERSION = "2.2.1"
EXPECTED_SCHEMA_HASH = "sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55"


async def main() -> None:
    package_version = importlib.metadata.version("alpaca-mcp-server")
    server = build_server()
    tools = await server.list_tools()
    tool = next(item for item in tools if item.name == "place_option_order")
    canonical = json.dumps(tool.parameters, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    schema_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    if package_version != EXPECTED_VERSION or schema_hash != EXPECTED_SCHEMA_HASH:
        raise SystemExit("pinned Alpaca MCP runtime schema drifted; mutation must remain disabled")
    print(json.dumps({
        "status": "RUNTIME_SCHEMA_MATCH",
        "package": "alpaca-mcp-server",
        "version": package_version,
        "tool": tool.name,
        "schema_sha256": schema_hash,
        "paper": os.environ["ALPACA_PAPER_TRADE"] == "true",
        "network_call_made": False,
    }, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(main())
