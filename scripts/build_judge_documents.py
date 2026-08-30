#!/usr/bin/env python3
"""Build Finly's judge-facing Word documents from the locked Markdown sources."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
ONE_PAGE_MD = ROOT / "docs/paper/one_page_writeup.md"
PAPER_MD = ROOT / "docs/paper/finly_technical_paper.md"
OUT_DIR = ROOT / "public/judge"
LOGO = ROOT / "public/brand/finly-bull-512.png"
CHART = ROOT / "docs/figures/g4_wealth_drawdown.png"

NAVY = "0D2B43"
GREEN = "2E6F5C"
RED = "8B3A3A"
INK = "263238"
STONE = "68706F"
RULE = "C8CCC7"
PALE = "F1F3EF"
WHITE = "FFFFFF"
DOCUMENT_TIMESTAMP = datetime(2026, 8, 30, 12, 0, 0, tzinfo=timezone.utc)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=70, start=90, bottom=70, end=90) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_table_borders(table, color=RULE, size=4) -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        node = borders.find(qn(tag))
        if node is None:
            node = OxmlElement(tag)
            borders.append(node)
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), str(size))
        node.set(qn("w:space"), "0")
        node.set(qn("w:color"), color)


def set_paragraph_rule(paragraph, color=GREEN, size=12, space=1) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    borders = p_pr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        p_pr.append(borders)
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)
    borders.append(bottom)


def set_run_font(run, name: str, size: float, color: str = INK, bold=False, italic=False) -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    run.bold = bold
    run.italic = italic


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, end])
    set_run_font(run, "Arial", 7.5, STONE)


INLINE = re.compile(r"(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)")


def add_hyperlink(paragraph, label: str, url: str, *, size: float, font: str, color=GREEN, bold=False) -> None:
    part = paragraph.part
    rel_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), rel_id)
    new_run = OxmlElement("w:r")
    r_pr = OxmlElement("w:rPr")
    r_fonts = OxmlElement("w:rFonts")
    r_fonts.set(qn("w:ascii"), font)
    r_fonts.set(qn("w:hAnsi"), font)
    color_node = OxmlElement("w:color")
    color_node.set(qn("w:val"), color)
    size_node = OxmlElement("w:sz")
    size_node.set(qn("w:val"), str(round(size * 2)))
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    r_pr.extend([r_fonts, color_node, size_node, underline])
    if bold:
        r_pr.append(OxmlElement("w:b"))
    new_run.append(r_pr)
    text = OxmlElement("w:t")
    text.text = label
    new_run.append(text)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def add_inline(paragraph, text: str, *, size: float, font="Times New Roman", color=INK, bold=False) -> None:
    cursor = 0
    for match in INLINE.finditer(text):
        if match.start() > cursor:
            run = paragraph.add_run(text[cursor:match.start()])
            set_run_font(run, font, size, color, bold=bold)
        token = match.group(0)
        if token.startswith("["):
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", token).groups()
            link_bold = bold
            if label.startswith("**") and label.endswith("**"):
                label = label[2:-2]
                link_bold = True
            if label.startswith("`") and label.endswith("`"):
                label = label[1:-1]
            add_hyperlink(paragraph, label, url, size=size, font=font, bold=link_bold)
        elif token.startswith("`"):
            run = paragraph.add_run(token[1:-1])
            set_run_font(run, "Menlo", max(6.8, size - 0.7), color, bold=bold)
            run.font.highlight_color = None
        elif token.startswith("**"):
            add_inline(paragraph, token[2:-2], size=size, font=font, color=color, bold=True)
        else:
            run = paragraph.add_run(token[1:-1])
            set_run_font(run, font, size, color, italic=True)
        cursor = match.end()
    if cursor < len(text):
        run = paragraph.add_run(text[cursor:])
        set_run_font(run, font, size, color, bold=bold)


def set_page(section, *, top, bottom, left, right) -> None:
    section.top_margin = Inches(top)
    section.bottom_margin = Inches(bottom)
    section.left_margin = Inches(left)
    section.right_margin = Inches(right)
    section.header_distance = Inches(0.22)
    section.footer_distance = Inches(0.24)


def add_doc_header(section, label: str) -> None:
    header = section.header
    header.is_linked_to_previous = False
    table = header.add_table(rows=1, cols=2, width=Inches(7.2))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Inches(4.8)
    table.columns[1].width = Inches(2.4)
    left = table.cell(0, 0)
    right = table.cell(0, 1)
    left.width = Inches(4.8)
    right.width = Inches(2.4)
    for cell in (left, right):
        set_cell_margins(cell, 0, 0, 50, 0)
    p = left.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    if LOGO.exists():
        p.add_run().add_picture(str(LOGO), width=Inches(0.25))
        p.add_run("  ")
    run = p.add_run(label.upper())
    set_run_font(run, "Arial", 7.7, GREEN, bold=True)
    p2 = right.paragraphs[0]
    p2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p2.add_run("30 AUGUST 2026")
    set_run_font(run, "Arial", 7.7, STONE, bold=True)
    set_table_borders(table, WHITE, 0)
    rule = header.add_paragraph()
    rule.paragraph_format.space_after = Pt(0)
    set_paragraph_rule(rule, NAVY, 5, 0)


def add_doc_footer(section, left_text: str) -> None:
    footer = section.footer
    footer.is_linked_to_previous = False
    table = footer.add_table(rows=1, cols=2, width=Inches(7.2))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Inches(6.2)
    table.columns[1].width = Inches(1.0)
    p = table.cell(0, 0).paragraphs[0]
    run = p.add_run(left_text)
    set_run_font(run, "Arial", 7.2, STONE)
    add_page_number(table.cell(0, 1).paragraphs[0])
    for cell in table.row_cells(0):
        set_cell_margins(cell, 30, 0, 0, 0)
    set_table_borders(table, WHITE, 0)


def configure_styles(doc: Document, body_size: float) -> None:
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
    normal.font.size = Pt(body_size)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.08
    normal.paragraph_format.widow_control = True


def split_blocks(lines: list[str], start: int) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    for raw in lines[start:]:
        line = raw.rstrip()
        if not line:
            if current:
                blocks.append(" ".join(current))
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(" ".join(current))
    return blocks


def build_one_page() -> Path:
    lines = ONE_PAGE_MD.read_text(encoding="utf-8").splitlines()
    title = lines[0].removeprefix("# ").strip()
    byline = lines[2].replace("[bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)", "bwen412@brandeis.edu")
    blocks = split_blocks(lines, 4)

    doc = Document()
    section = doc.sections[0]
    set_page(section, top=0.55, bottom=0.48, left=0.62, right=0.62)
    add_doc_header(section, "Finly / One-page judge proposal")
    add_doc_footer(section, "Controlled delegation: judgment may inform; deterministic code retains authority.")
    configure_styles(doc, 9.5)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(title)
    set_run_font(run, "Times New Roman", 20.5, NAVY, bold=True)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(7)
    run = p.add_run(byline)
    set_run_font(run, "Arial", 8, STONE, bold=True)
    set_paragraph_rule(p, GREEN, 9, 5)

    for index, block in enumerate(blocks):
        p = doc.add_paragraph()
        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.line_spacing = 1.04
        p.paragraph_format.space_after = Pt(3.8)
        p.paragraph_format.keep_together = False
        p.paragraph_format.widow_control = True
        if block.startswith("**References.**"):
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.left_indent = Inches(0.18)
            p.paragraph_format.first_line_indent = Inches(-0.18)
            p.paragraph_format.line_spacing = 1.0
            set_paragraph_rule(p, RULE, 4, 4)
            add_inline(p, block, size=7.45, font="Times New Roman", color=STONE)
        else:
            add_inline(p, block, size=9.5)

    doc.core_properties.title = title
    doc.core_properties.author = "Bruce Wen"
    doc.core_properties.last_modified_by = "Bruce Wen"
    doc.core_properties.subject = "Alpaca AI Trading Agents Hackathon — one-page proposal"
    doc.core_properties.comments = "Finly judge proposal prepared by Bruce Wen."
    doc.core_properties.keywords = "Finly, Alpaca, trading agent, controlled delegation"
    doc.core_properties.created = DOCUMENT_TIMESTAMP
    doc.core_properties.modified = DOCUMENT_TIMESTAMP
    output = OUT_DIR / "Finly_Judge_Proposal.docx"
    doc.save(output)
    return output


def flush_paragraph(doc: Document, buffer: list[str], *, abstract=False, reference=False) -> None:
    if not buffer:
        return
    text = " ".join(item.strip() for item in buffer).strip()
    buffer.clear()
    is_formula = not abstract and not reference and text.startswith("`") and text.endswith("`")
    if is_formula and doc.paragraphs:
        doc.paragraphs[-1].paragraph_format.keep_with_next = True
    p = doc.add_paragraph()
    p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER if is_formula else WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_before = Pt(2.5 if is_formula else 0)
    p.paragraph_format.space_after = Pt(2.5 if is_formula else (4.2 if not reference else 0.6))
    p.paragraph_format.line_spacing = 1.0 if is_formula else (1.05 if not reference else 0.88)
    p.paragraph_format.widow_control = True
    p.paragraph_format.keep_together = is_formula or text.startswith("The publication receipt has")
    p.paragraph_format.keep_with_next = is_formula
    if abstract:
        p.paragraph_format.left_indent = Inches(0.18)
        p.paragraph_format.right_indent = Inches(0.18)
    if reference:
        p.paragraph_format.left_indent = Inches(0.22)
        p.paragraph_format.first_line_indent = Inches(-0.22)
    add_inline(p, text, size=9.10 if not reference else 7.05, color=INK if not reference else STONE)


def parse_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    rows: list[list[str]] = []
    index = start
    while index < len(lines) and lines[index].lstrip().startswith("|"):
        cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            rows.append(cells)
        index += 1
    return rows, index


def add_data_table(doc: Document, rows: list[list[str]]) -> None:
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    set_table_borders(table, RULE, 4)
    for r_idx, source in enumerate(rows):
        row = table.rows[r_idx]
        if r_idx == 0:
            set_repeat_table_header(row)
        for c_idx, value in enumerate(source):
            cell = row.cells[c_idx]
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            if r_idx == 0:
                set_cell_shading(cell, NAVY)
            elif r_idx % 2 == 0:
                set_cell_shading(cell, PALE)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.0
            header = rows[0][c_idx].replace("**", "").replace("`", "")
            numeric_headers = {
                "G4",
                "SPY",
                "Observed",
                "Requirement",
                "Total return",
                "Annualized return",
                "Annualized volatility",
                "Maximum drawdown",
                "SPY total return",
            }
            if c_idx == 0 or header not in numeric_headers:
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            else:
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            cell_text = value
            cell_bold = r_idx == 0 or c_idx == 0
            if cell_text.startswith("**") and cell_text.endswith("**"):
                cell_text = cell_text[2:-2]
                cell_bold = True
            add_inline(
                p,
                cell_text,
                size=7.8,
                font="Arial",
                color=WHITE if r_idx == 0 else INK,
                bold=cell_bold,
            )
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(1)


def add_technical_heading(doc: Document, text: str, *, level: int) -> None:
    p = doc.add_paragraph()
    if level == 1:
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        set_run_font(run, "Arial", 13.5, NAVY, bold=True)
        set_paragraph_rule(p, GREEN, 8, 3)
    else:
        p.paragraph_format.space_before = Pt(5)
        p.paragraph_format.space_after = Pt(5)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        set_run_font(run, "Arial", 10.5, GREEN, bold=True)


def build_technical_paper() -> Path:
    lines = PAPER_MD.read_text(encoding="utf-8").splitlines()
    title = lines[0].removeprefix("# ").strip()
    subtitle = lines[2].removeprefix("## ").strip()
    byline = lines[4].replace("[bwen412@brandeis.edu](mailto:bwen412@brandeis.edu)", "bwen412@brandeis.edu").replace("  ", "")
    date_line = lines[5].replace("  ", "")

    doc = Document()
    section = doc.sections[0]
    set_page(section, top=0.68, bottom=0.50, left=0.72, right=0.72)
    add_doc_header(section, "Finly / Technical evidence paper")
    add_doc_footer(section, "Controlled delegation · execution realism · publicly frozen prospective evaluation.")
    configure_styles(doc, 9.10)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(5)
    run = p.add_run(title)
    set_run_font(run, "Times New Roman", 23, NAVY, bold=True)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(7)
    run = p.add_run(subtitle.upper())
    set_run_font(run, "Arial", 8.5, GREEN, bold=True)
    run = p.add_run("  /  " + byline + "  /  " + date_line)
    set_run_font(run, "Arial", 8.2, STONE)
    set_paragraph_rule(p, NAVY, 6, 5)

    i = 7
    buffer: list[str] = []
    in_abstract = False
    in_references = False
    chart_added = False
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            flush_paragraph(doc, buffer, abstract=in_abstract, reference=in_references)
            i += 1
            continue
        if line.startswith("## "):
            flush_paragraph(doc, buffer, abstract=in_abstract, reference=in_references)
            heading = line[3:].strip()
            in_abstract = heading == "Abstract"
            in_references = heading == "References"
            add_technical_heading(doc, heading, level=1)
            i += 1
            continue
        if line.lstrip().startswith("|"):
            flush_paragraph(doc, buffer, abstract=in_abstract, reference=in_references)
            rows, i = parse_table(lines, i)
            add_data_table(doc, rows)
            if not chart_added and rows and rows[0][0].startswith("Consumed replay") and CHART.exists():
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(5)
                p.paragraph_format.space_after = Pt(2)
                p.add_run().add_picture(str(CHART), width=Inches(6.65))
                cap = doc.add_paragraph()
                cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                cap.paragraph_format.space_after = Pt(5)
                run = cap.add_run("Figure 1. Consumed adjusted-close ETF replay. Selected after viewing history; descriptive only, not promoted, not options P&L, and not a forecast.")
                set_run_font(run, "Arial", 7.5, STONE, italic=True)
                chart_added = True
            continue
        buffer.append(line)
        i += 1
    flush_paragraph(doc, buffer, abstract=in_abstract, reference=in_references)

    doc.core_properties.title = title
    doc.core_properties.author = "Bruce Wen"
    doc.core_properties.last_modified_by = "Bruce Wen"
    doc.core_properties.subject = "Finly controlled-delegation architecture and quantitative evidence"
    doc.core_properties.comments = "Finly technical paper prepared by Bruce Wen."
    doc.core_properties.keywords = "Finly, Alpaca, trading agent, quantitative research, controlled delegation"
    doc.core_properties.created = DOCUMENT_TIMESTAMP
    doc.core_properties.modified = DOCUMENT_TIMESTAMP
    output = OUT_DIR / "Finly_Technical_Paper.docx"
    doc.save(output)
    return output


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(build_one_page())
    print(build_technical_paper())
