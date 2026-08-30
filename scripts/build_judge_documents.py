#!/usr/bin/env python3
"""Build Finly's restrained, essay-first judge documents from Markdown."""

from __future__ import annotations

import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
ONE_PAGE_MD = ROOT / "docs/paper/one_page_writeup.md"
PAPER_MD = ROOT / "docs/paper/finly_technical_paper.md"
PUBLIC_DIR = ROOT / "public/judge"
DIST_DIR = ROOT / "dist/judge"

SERIF = "Times New Roman"
SANS = "Arial"
MONO = "Menlo"
INK = "171717"
MUTED = "5F6368"
LINK = "1F5A4C"
RULE = "B8BBB8"
DOCUMENT_TIMESTAMP = datetime(2026, 8, 30, 12, 0, 0, tzinfo=timezone.utc)

INLINE = re.compile(r"(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)")


def set_run_font(run, name: str, size: float, color: str = INK, *, bold=False, italic=False) -> None:
    run.font.name = name
    r_pr = run._element.get_or_add_rPr()
    fonts = r_pr.rFonts
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        r_pr.insert(0, fonts)
    for key in ("ascii", "hAnsi", "eastAsia"):
        fonts.set(qn(f"w:{key}"), name)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    run.bold = bold
    run.italic = italic


def set_paragraph_rule(paragraph, *, color: str = RULE, size: int = 4, space: int = 2) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    borders = p_pr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        p_pr.append(borders)
    bottom = borders.find(qn("w:bottom"))
    if bottom is None:
        bottom = OxmlElement("w:bottom")
        borders.append(bottom)
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)


def add_hyperlink(paragraph, label: str, url: str, *, size: float, font: str, bold=False) -> None:
    relation_id = paragraph.part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relation_id)
    run = OxmlElement("w:r")
    run_properties = OxmlElement("w:rPr")
    run_fonts = OxmlElement("w:rFonts")
    run_fonts.set(qn("w:ascii"), font)
    run_fonts.set(qn("w:hAnsi"), font)
    color = OxmlElement("w:color")
    color.set(qn("w:val"), LINK)
    run_size = OxmlElement("w:sz")
    run_size.set(qn("w:val"), str(round(size * 2)))
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    run_properties.extend([run_fonts, color, run_size, underline])
    if bold:
        run_properties.append(OxmlElement("w:b"))
    run.append(run_properties)
    text = OxmlElement("w:t")
    text.text = label
    run.append(text)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def add_inline(paragraph, text: str, *, size: float, font: str = SERIF, color: str = INK, bold=False) -> None:
    cursor = 0
    for match in INLINE.finditer(text):
        if match.start() > cursor:
            run = paragraph.add_run(text[cursor:match.start()])
            set_run_font(run, font, size, color, bold=bold)
        token = match.group(0)
        if token.startswith("["):
            parsed = re.match(r"\[([^\]]+)\]\(([^)]+)\)", token)
            if parsed is None:
                run = paragraph.add_run(token)
                set_run_font(run, font, size, color, bold=bold)
            else:
                label, url = parsed.groups()
                add_hyperlink(paragraph, label, url, size=size, font=font, bold=bold)
        elif token.startswith("`"):
            run = paragraph.add_run(token[1:-1])
            set_run_font(run, MONO, max(7.0, size - 0.6), color, bold=bold)
        elif token.startswith("**"):
            add_inline(paragraph, token[2:-2], size=size, font=font, color=color, bold=True)
        else:
            run = paragraph.add_run(token[1:-1])
            set_run_font(run, font, size, color, bold=bold, italic=True)
        cursor = match.end()
    if cursor < len(text):
        run = paragraph.add_run(text[cursor:])
        set_run_font(run, font, size, color, bold=bold)


def add_page_number(paragraph) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    placeholder = OxmlElement("w:t")
    placeholder.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, placeholder, end])
    set_run_font(run, SERIF, 8.0, MUTED)


def set_letter_page(section, *, top: float, bottom: float, left: float, right: float) -> None:
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(top)
    section.bottom_margin = Inches(bottom)
    section.left_margin = Inches(left)
    section.right_margin = Inches(right)
    section.header_distance = Inches(0.30)
    section.footer_distance = Inches(0.30)


def configure_normal_style(doc: Document, *, size: float, line_spacing: float, after: float) -> None:
    normal = doc.styles["Normal"]
    normal.font.name = SERIF
    normal._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), SERIF)
    normal._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), SERIF)
    normal._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), SERIF)
    normal.font.size = Pt(size)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(after)
    normal.paragraph_format.line_spacing = line_spacing
    normal.paragraph_format.widow_control = True


def add_quiet_footer(section, *, first_page=False) -> None:
    footer = section.first_page_footer if first_page else section.footer
    footer.is_linked_to_previous = False
    paragraph = footer.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    add_page_number(paragraph)


def add_running_header(section) -> None:
    header = section.header
    header.is_linked_to_previous = False
    paragraph = header.paragraphs[0]
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(2)
    paragraph.paragraph_format.keep_with_next = True
    run = paragraph.add_run("FINLY  /  TAKING TRADING EVIDENCE SERIOUSLY")
    set_run_font(run, SANS, 7.4, MUTED)
    set_paragraph_rule(paragraph, color=RULE, size=3, space=2)


def split_blocks(lines: list[str], start: int) -> list[str]:
    blocks: list[str] = []
    buffer: list[str] = []
    for raw in lines[start:]:
        line = raw.strip()
        if line.startswith("## "):
            if buffer:
                blocks.append(" ".join(buffer))
                buffer.clear()
            blocks.append(line)
        elif not line:
            if buffer:
                blocks.append(" ".join(buffer))
                buffer.clear()
        else:
            buffer.append(line)
    if buffer:
        blocks.append(" ".join(buffer))
    return blocks


def set_metadata(doc: Document, *, title: str, subject: str) -> None:
    properties = doc.core_properties
    properties.title = title
    properties.author = "Bruce Wen"
    properties.last_modified_by = "Bruce Wen"
    properties.subject = subject
    properties.comments = "Prepared by Bruce Wen for the Alpaca AI Trading Agents Hackathon."
    properties.keywords = "Finly, Alpaca, trading agent, controlled delegation"
    properties.created = DOCUMENT_TIMESTAMP
    properties.modified = DOCUMENT_TIMESTAMP


def build_one_page() -> Path:
    lines = ONE_PAGE_MD.read_text(encoding="utf-8").splitlines()
    title = lines[0].removeprefix("# ").strip()
    byline = lines[2].replace("[bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)", "bwen412@brandeis.edu")
    scope = lines[4]
    blocks = split_blocks(lines, 6)

    doc = Document()
    section = doc.sections[0]
    set_letter_page(section, top=0.68, bottom=0.62, left=0.88, right=0.88)
    configure_normal_style(doc, size=11.0, line_spacing=1.15, after=7.0)
    add_quiet_footer(section)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(3)
    run = paragraph.add_run(title)
    set_run_font(run, SERIF, 18.5, INK, bold=True)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(1.5)
    run = paragraph.add_run(byline)
    set_run_font(run, SERIF, 9.2, INK)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(7)
    run = paragraph.add_run(scope)
    set_run_font(run, SERIF, 8.4, MUTED, italic=True)
    set_paragraph_rule(paragraph, color=RULE, size=3, space=4)

    in_references = False
    first_body = True
    for block in blocks:
        if block == "## References":
            in_references = True
            paragraph = doc.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(1)
            paragraph.paragraph_format.space_after = Pt(2)
            paragraph.paragraph_format.keep_with_next = True
            run = paragraph.add_run("References")
            set_run_font(run, SERIF, 8.8, INK, bold=True)
            continue

        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        paragraph.paragraph_format.widow_control = True
        paragraph.paragraph_format.keep_together = not in_references
        if in_references:
            paragraph.paragraph_format.left_indent = Inches(0.14)
            paragraph.paragraph_format.first_line_indent = Inches(-0.14)
            paragraph.paragraph_format.line_spacing = 1.0
            paragraph.paragraph_format.space_after = Pt(0)
            add_inline(paragraph, block, size=7.5, color=MUTED)
        else:
            paragraph.paragraph_format.first_line_indent = Inches(0 if first_body else 0.21)
            paragraph.paragraph_format.line_spacing = 1.15
            paragraph.paragraph_format.space_after = Pt(7.0)
            add_inline(paragraph, block, size=11.0)
            first_body = False

    set_metadata(doc, title=title, subject="One-page narrative proposal")
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    output = PUBLIC_DIR / "Finly_Judge_Proposal.docx"
    doc.save(output)
    shutil.copy2(output, DIST_DIR / output.name)
    return output


def markdown_blocks(lines: list[str], start: int) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            blocks.append(("paragraph", " ".join(buffer)))
            buffer.clear()

    for raw in lines[start:]:
        line = raw.strip()
        if line.startswith("### "):
            flush()
            blocks.append(("h2", line[4:].strip()))
        elif line.startswith("## "):
            flush()
            blocks.append(("h1", line[3:].strip()))
        elif not line:
            flush()
        else:
            buffer.append(line)
    flush()
    return blocks


def add_section_heading(doc: Document, text: str, *, level: int) -> None:
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.keep_with_next = True
    if level == 1:
        paragraph.paragraph_format.space_before = Pt(13)
        paragraph.paragraph_format.space_after = Pt(5)
        run = paragraph.add_run(text)
        set_run_font(run, SERIF, 13.5, INK, bold=True)
    else:
        paragraph.paragraph_format.space_before = Pt(8)
        paragraph.paragraph_format.space_after = Pt(4)
        run = paragraph.add_run(text)
        set_run_font(run, SERIF, 11.4, INK, bold=True, italic=True)


def build_technical_paper() -> Path:
    lines = PAPER_MD.read_text(encoding="utf-8").splitlines()
    title = lines[0].removeprefix("# ").strip()
    subtitle = lines[2].removeprefix("## ").strip()
    byline = lines[4].replace("[bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)", "bwen412@brandeis.edu")
    date_line = lines[6]
    blocks = markdown_blocks(lines, 8)

    doc = Document()
    section = doc.sections[0]
    set_letter_page(section, top=0.92, bottom=0.86, left=1.0, right=1.0)
    configure_normal_style(doc, size=11.0, line_spacing=1.15, after=6.0)
    section.different_first_page_header_footer = True
    add_running_header(section)
    add_quiet_footer(section)
    add_quiet_footer(section, first_page=True)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(8)
    paragraph.paragraph_format.space_after = Pt(4)
    run = paragraph.add_run(title)
    set_run_font(run, SERIF, 23.5, INK, bold=True)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(9)
    run = paragraph.add_run(subtitle)
    set_run_font(run, SERIF, 11.8, MUTED, italic=True)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(2)
    run = paragraph.add_run(byline)
    set_run_font(run, SERIF, 9.1, INK)

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(12)
    run = paragraph.add_run(date_line)
    set_run_font(run, SERIF, 8.3, MUTED)
    set_paragraph_rule(paragraph, color=RULE, size=3, space=5)

    in_abstract = False
    in_references = False
    first_after_heading = True
    for kind, value in blocks:
        if kind == "h1":
            add_section_heading(doc, value, level=1)
            in_abstract = value == "Abstract"
            in_references = value == "References"
            first_after_heading = True
            continue
        if kind == "h2":
            add_section_heading(doc, value, level=2)
            first_after_heading = True
            continue

        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        paragraph.paragraph_format.widow_control = True
        paragraph.paragraph_format.keep_together = not in_references
        if in_references:
            paragraph.paragraph_format.left_indent = Inches(0.24)
            paragraph.paragraph_format.first_line_indent = Inches(-0.24)
            paragraph.paragraph_format.line_spacing = 1.0
            paragraph.paragraph_format.space_after = Pt(2.1)
            add_inline(paragraph, value, size=8.65, color=MUTED)
        elif in_abstract:
            paragraph.paragraph_format.left_indent = Inches(0.18)
            paragraph.paragraph_format.right_indent = Inches(0.18)
            paragraph.paragraph_format.first_line_indent = Inches(0)
            paragraph.paragraph_format.line_spacing = 1.08
            paragraph.paragraph_format.space_after = Pt(5)
            add_inline(paragraph, value, size=10.25)
        else:
            paragraph.paragraph_format.first_line_indent = Inches(0 if first_after_heading else 0.24)
            paragraph.paragraph_format.line_spacing = 1.15
            paragraph.paragraph_format.space_after = Pt(6.0)
            add_inline(paragraph, value, size=11.0)
        first_after_heading = False

    set_metadata(doc, title=title, subject="Technical paper on controlled delegation and quantitative evidence")
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    output = PUBLIC_DIR / "Finly_Technical_Paper.docx"
    doc.save(output)
    shutil.copy2(output, DIST_DIR / output.name)
    return output


if __name__ == "__main__":
    print(build_one_page())
    print(build_technical_paper())
