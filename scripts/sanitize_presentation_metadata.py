#!/usr/bin/env python3
"""Replace exporter-default PPTX metadata with Finly's release metadata."""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


CORE_REPLACEMENTS = {
    "dc:title": "Finly: Proof Before Authority",
    "dc:subject": "Alpaca AI Trading Agents Hackathon presentation",
    "dc:creator": "Bruce Wen",
    "lastModifiedBy": "Bruce Wen",
    "keywords": "Finly, Alpaca, trading agent, controlled delegation",
    "dc:description": "Finly judge presentation prepared by Bruce Wen.",
}


def replace_element(xml: str, tag: str, value: str) -> str:
    pattern = rf"(<{re.escape(tag)}(?:\s[^>]*)?>).*?(</{re.escape(tag)}>)"
    if re.search(pattern, xml, flags=re.DOTALL):
        return re.sub(pattern, rf"\g<1>{value}\g<2>", xml, flags=re.DOTALL)
    closing = "</coreProperties>" if "</coreProperties>" in xml else "</cp:coreProperties>"
    if closing not in xml:
        raise ValueError(f"cannot insert {tag}: core properties root is absent")
    return xml.replace(closing, f"<{tag}>{value}</{tag}>{closing}")


def sanitize(path: Path) -> None:
    if path.suffix.lower() != ".pptx" or not path.is_file():
        raise ValueError("expected an existing .pptx file")
    temporary = path.with_suffix(".pptx.metadata.tmp")
    with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(temporary, "w") as target:
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename == "docProps/core.xml":
                xml = payload.decode("utf-8")
                for tag, value in CORE_REPLACEMENTS.items():
                    xml = replace_element(xml, tag, value)
                xml = replace_element(xml, "dcterms:created", "2026-08-29T12:00:00Z")
                xml = replace_element(xml, "dcterms:modified", "2026-08-29T12:00:00Z")
                payload = xml.encode("utf-8")
            elif info.filename == "docProps/app.xml":
                xml = payload.decode("utf-8")
                xml = re.sub(r"<(?:ap:)?Application>.*?</(?:ap:)?Application>",
                             "<ap:Application>Finly Presentation Builder</ap:Application>", xml)
                xml = re.sub(r"<(?:ap:)?PresentationFormat>.*?</(?:ap:)?PresentationFormat>",
                             "<ap:PresentationFormat>On-screen Show (16:9)</ap:PresentationFormat>", xml)
                xml = re.sub(r"<(?:ap:)?Slides>.*?</(?:ap:)?Slides>", "<ap:Slides>9</ap:Slides>", xml)
                xml = re.sub(r"<(?:ap:)?Notes>.*?</(?:ap:)?Notes>", "<ap:Notes>9</ap:Notes>", xml)
                payload = xml.encode("utf-8")
            elif info.filename.startswith("ppt/") and "/theme" in info.filename and info.filename.endswith(".xml"):
                payload = payload.replace(b'name="ChatGPT"', b'name="Finly"')
            target.writestr(info, payload)
    temporary.replace(path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: sanitize_presentation_metadata.py PATH.pptx")
    sanitize(Path(sys.argv[1]).resolve())
