#!/usr/bin/env python3
"""Build Finly's captioned judge film from original, claim-locked scenes.

The script uses a free neural voice when `.venv-media/bin/edge-tts` is present,
then renders original SVG scenes with FFmpeg. It never calls a broker or reads
credentials. The resulting film is an explanatory artifact, not evidence of
execution or performance.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import math
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp" / "video_build"
OUTPUT = ROOT / "public" / "judge" / "Finly_Demo_Video.mp4"
SUBTITLE_OUTPUT = ROOT / "public" / "judge" / "Finly_Demo_Video.srt"
CLAIMS_PATH = ROOT / "public" / "data" / "submission_claims_lock.json"
CHART_PATH = ROOT / "public" / "figures" / "g4_wealth_drawdown.png"
VOICE = "en-US-AndrewMultilingualNeural"
VOICE_RATE = "+8%"

NAVY = "#0b2c46"
NAVY_2 = "#102f4f"
GREEN = "#2d7159"
GREEN_DARK = "#1d5543"
PAPER = "#f4f0e7"
PAPER_BRIGHT = "#fbfaf6"
INK = "#152630"
STONE = "#727a78"
RULE = "#bbbdb7"
RED = "#93463e"
RED_PALE = "#ead8d3"
WHITE = "#ffffff"


@dataclass(frozen=True)
class Scene:
    slug: str
    narration: str


SCENES = [
    Scene("familiar-chart", "Most trading demos begin with a chart going up and to the right. Ours does too. The difference is what happens next."),
    Scene("attractive-result", "Finly's strongest retrospective nonproduction shadow combined a QQQ core with rotating sector momentum. In the consumed ETF replay from 2 January 2013 through 27 August 2026, with a modeled five-basis-point one-way turnover cost, it recorded an 18.97 percent annualized return against 15.11 percent for SPY, with a shallower maximum drawdown."),
    Scene("refusal", "Finly still refused to promote it. Its Deflated Sharpe probability was 3.75 percent, the worst adjusted familywise p-value was 0.3718, and the growth-control and source-overlap gates failed."),
    Scene("authority", "That refusal is the product. AI may assess bounded evidence and explain a view. Code still owns direction, horizon, spread construction, maximum loss, and every Alpaca field. The llama does not get the keys."),
    Scene("challenge", "Code removes evidence families, perturbs market inputs, and recomputes the order. If the conclusion changes, Finly fails closed. A plausible rationale is not permission."),
    Scene("two-fixtures", "Two synthetic receipts make the boundary visible. With aligned evidence, four source removals and thirty-two perturbations preserved the decision. With conflicting evidence, removing one source changed it, so the compiler returned no trade."),
    Scene("options-compiler", "When a fixture survives, code constructs a defined-risk bear-put spread and calculates the payoff. Here, maximum loss is 366 dollars and maximum gain is 634. The Alpaca-shaped payload is compiled but never transmitted."),
    Scene("research-ledger", "The chart is an ETF replay, not options profit and loss. The 113-item ledger includes controls, invalidated runs, and reruns—not 113 independent strategies. Seven later challengers promoted none. Reporting the limits is part of the result."),
    Scene("forward-test", "G4 is not the production book. Production Finly is the lower-risk time-series-momentum volatility ensemble. In its now-consumed fixed holdout, it returned 11.13 percent annualized against 19.19 percent for SPY, with annualized volatility of 8.31 percent against 17.33 percent, and a maximum drawdown of minus 5.79 percent against minus 18.76 percent. Forward Trial One remains at zero of 252 settlements, so there is no next-month inference. Broker authority and performance inference remain disabled."),
    Scene("closing", "Finly's contribution is not a bigger forecast. It is a smaller trust boundary: evidence may inform a trade, but verified authority must permit it. The bull has horns. The llama still does not get the keys."),
]


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def capture(*args: str) -> str:
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def image_data(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    mime = "image/png" if path.suffix.lower() == ".png" else "image/svg+xml"
    return f"data:{mime};base64,{encoded}"


def text_lines(lines: list[str], x: int, y: int, size: int, *, fill: str = INK,
               weight: int = 500, family: str = "Georgia", line_height: float = 1.08,
               anchor: str = "start", letter_spacing: float = 0) -> str:
    tspans = []
    for index, line in enumerate(lines):
        dy = 0 if index == 0 else int(size * line_height)
        tspans.append(f'<tspan x="{x}" dy="{dy}">{esc(line)}</tspan>')
    return (
        f'<text x="{x}" y="{y}" fill="{fill}" font-family="{family}" '
        f'font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" '
        f'letter-spacing="{letter_spacing}">{"".join(tspans)}</text>'
    )


def small_label(text: str, x: int, y: int, *, fill: str = GREEN) -> str:
    return text_lines([text.upper()], x, y, 20, fill=fill, weight=700,
                      family="Helvetica Neue", letter_spacing=2.4)


def finly_mark(x: int, y: int, size: int, *, light: bool = False) -> str:
    scale = size / 64
    horn_fill = "#dce5dc" if not light else "#f4f0e7"
    stroke = "#102f4f" if not light else "#ffffff"
    body = "#39745d" if not light else "#78a68f"
    return f'''
    <g transform="translate({x} {y}) scale({scale})">
      <path d="M8 9c8 2 14 8 18 18-8-3-13-8-15-15-2 5-2 10 0 16-5-5-6-12-3-19Z" fill="{horn_fill}" stroke="{stroke}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M56 9c-8 2-14 8-18 18 8-3 13-8 15-15 2 5 2 10 0 16 5-5 6-12 3-19Z" fill="{horn_fill}" stroke="{stroke}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M20 25c3-5 7-7 12-7s9 2 12 7l-2 20c-3 7-6 10-10 12-4-2-7-5-10-12l-2-20Z" fill="{body}" stroke="{stroke}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M27 27h12v4h-7v6h6v4h-6v10h-5V27Z" fill="#f7f6f2"/>
    </g>'''


def frame(body: str, *, background: str = PAPER, footer: str = "FINLY · CONTROLLED-DELEGATION TRADING RESEARCH") -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect width="1920" height="1080" fill="{background}"/>
      {body}
      <line x1="92" y1="1002" x2="1828" y2="1002" stroke="{RULE if background == PAPER else '#527087'}" stroke-width="2"/>
      {text_lines([footer], 92, 1042, 17, fill=STONE if background == PAPER else '#9ab0b6', weight=700, family='Helvetica Neue', letter_spacing=1.8)}
      {text_lines(['BRUCE WEN · 2026'], 1828, 1042, 17, fill=STONE if background == PAPER else '#9ab0b6', weight=700, family='Helvetica Neue', anchor='end', letter_spacing=1.8)}
    </svg>'''


def scene_one() -> str:
    body = f'''
      {finly_mark(104, 86, 70)}
      {small_label('A message from the bot that said no', 214, 125)}
      {text_lines(['Most trading demos', 'begin with this.'], 104, 315, 92, fill=NAVY, weight=500)}
      <path d="M102 824 C260 792, 310 724, 432 744 S632 650, 742 677 S923 526, 1053 574 S1240 420, 1380 462 S1570 275, 1812 198" fill="none" stroke="{GREEN}" stroke-width="15" stroke-linecap="round"/>
      <circle cx="1812" cy="198" r="18" fill="{GREEN}"/>
      {text_lines(['The difference is what happens next.'], 106, 805, 32, fill=INK, family='Georgia')}
    '''
    return frame(body)


def scene_two(chart_uri: str) -> str:
    body = f'''
      <image x="780" y="116" width="1050" height="660" preserveAspectRatio="xMidYMid slice" opacity="0.96" xlink:href="{chart_uri}"/>
      <rect x="0" y="0" width="860" height="1000" fill="{PAPER}"/>
      {small_label('The attractive result', 104, 137)}
      {text_lines(['G4 looked', 'good enough to', 'test harder.'], 104, 292, 92, fill=NAVY)}
      <line x1="104" y1="642" x2="690" y2="642" stroke="{RULE}" stroke-width="2"/>
      {text_lines(['18.97%'], 104, 747, 82, fill=GREEN, weight=650, family='Helvetica Neue')}
      {text_lines(['annualized return'], 108, 790, 22, fill=STONE, weight=600, family='Helvetica Neue')}
      {text_lines(['SPY 15.11%'], 108, 850, 27, fill=NAVY, weight=650, family='Helvetica Neue')}
      {text_lines(['2013-01-02–2026-08-27 · modeled 5 bp one-way turnover cost'], 780, 832, 18, fill=STONE, family='Helvetica Neue')}
      {text_lines(['Consumed ETF replay · selected after history was viewed'], 780, 862, 18, fill=STONE, family='Helvetica Neue')}
    '''
    return frame(body)


def scene_three() -> str:
    rows = [
        ("Deflated Sharpe probability", "3.75%", "≥95%"),
        ("Worst adjusted familywise p-value", "0.3718", "≤0.05"),
        ("Static growth-control independence", "Unsupported", "Supported"),
        ("Authenticated source overlap", "Not passed", "Passed"),
    ]
    row_svg = []
    for i, (gate, observed, required) in enumerate(rows):
        y = 460 + i * 103
        row_svg.append(f'<line x1="108" y1="{y+50}" x2="1812" y2="{y+50}" stroke="{RULE}" stroke-width="1"/>')
        row_svg.append(text_lines([gate], 108, y, 25, fill=INK, weight=600, family="Helvetica Neue"))
        row_svg.append(text_lines([observed], 1270, y, 25, fill=RED, weight=700, family="Helvetica Neue"))
        row_svg.append(text_lines([required], 1740, y, 25, fill=STONE, weight=600, family="Helvetica Neue", anchor="end"))
        row_svg.append(text_lines(["FAILED"], 1812, y, 16, fill=RED, weight=800, family="Helvetica Neue", anchor="end", letter_spacing=1.4))
    body = f'''
      {small_label('The refusal', 108, 133, fill=RED)}
      {text_lines(['Finly still refused', 'to promote it.'], 108, 274, 82, fill=NAVY)}
      <g transform="translate(1340 132) rotate(-3)"><rect width="470" height="150" rx="4" fill="none" stroke="{RED}" stroke-width="9"/>{text_lines(['NOT PROMOTED'], 235, 95, 42, fill=RED, weight=800, family='Helvetica Neue', anchor='middle', letter_spacing=2)}</g>
      {''.join(row_svg)}
    '''
    return frame(body)


def scene_four() -> str:
    stages = [
        ("AI", "assesses evidence", GREEN),
        ("CODE", "derives intent", NAVY_2),
        ("CODE", "constructs spread", NAVY_2),
        ("CODE", "checks exact loss", NAVY_2),
        ("GATE", "permits or refuses", GREEN_DARK),
    ]
    blocks = []
    for i, (owner, label, color) in enumerate(stages):
        x = 106 + i * 344
        blocks.append(f'<rect x="{x}" y="493" width="290" height="185" fill="none" stroke="{color}" stroke-width="3"/>')
        blocks.append(text_lines([owner], x + 28, 541, 18, fill=color, weight=800, family="Helvetica Neue", letter_spacing=2))
        blocks.append(text_lines(label.split(" "), x + 28, 599, 28, fill=INK, weight=600, family="Helvetica Neue", line_height=1.1))
        if i < len(stages) - 1:
            blocks.append(f'<path d="M{x+302} 585h30" stroke="{STONE}" stroke-width="3"/><path d="M{x+328} 577l10 8-10 8" fill="none" stroke="{STONE}" stroke-width="3"/>')
    body = f'''
      {small_label('The authority boundary', 108, 132)}
      {text_lines(['That refusal', 'is the product.'], 108, 278, 86, fill=NAVY)}
      {''.join(blocks)}
      <rect x="107" y="700" width="1704" height="120" fill="{NAVY}"/>
      {text_lines(['In plain English: the llama does not get the keys.'], 959, 776, 42, fill=WHITE, weight=500, anchor='middle')}
    '''
    return frame(body)


def scene_five() -> str:
    sources = [("MARKET", GREEN), ("OPTIONS", NAVY), ("EVENTS", RED), ("PREDICTION", "#9b865b")]
    source_svg = []
    for i, (label, color) in enumerate(sources):
        x = 106 + i * 249
        source_svg.append(f'<rect x="{x}" y="455" width="212" height="100" fill="{PAPER_BRIGHT}" stroke="{color}" stroke-width="3"/>')
        source_svg.append(text_lines([label], x + 106, 515, 18, fill=color, weight=750, family="Helvetica Neue", anchor="middle", letter_spacing=1.3))
    body = f'''
      {small_label('The challenge', 106, 134)}
      {text_lines(['A proposal must survive', 'attempts to break it.'], 106, 280, 78, fill=NAVY)}
      {''.join(source_svg)}
      <path d="M1090 506h170" stroke="{STONE}" stroke-width="4"/><path d="M1248 494l18 12-18 12" fill="none" stroke="{STONE}" stroke-width="4"/>
      <rect x="1298" y="410" width="514" height="288" fill="{NAVY}"/>
      {text_lines(['REMOVE ONE SOURCE'], 1340, 464, 18, fill='#9ab0b6', weight=700, family='Helvetica Neue', letter_spacing=1.7)}
      {text_lines(['recompute', 'perturb', 'compare'], 1340, 536, 44, fill=WHITE, weight=500, line_height=1.15)}
      <rect x="107" y="700" width="1705" height="112" fill="{RED_PALE}"/>
      {text_lines(['If the conclusion changes, the system fails closed.'], 959, 772, 38, fill=RED, weight=600, anchor='middle')}
    '''
    return frame(body)


def scene_six() -> str:
    def panel(x: int, title: str, subtitle: str, color: str, decision: str, detail: str) -> str:
        return f'''
          <rect x="{x}" y="360" width="786" height="470" fill="{PAPER_BRIGHT}" stroke="{RULE}" stroke-width="2"/>
          <rect x="{x}" y="360" width="786" height="12" fill="{color}"/>
          {text_lines([title], x+42, 435, 35, fill=NAVY, weight=650, family='Helvetica Neue')}
          {text_lines([subtitle], x+42, 474, 19, fill=STONE, family='Georgia')}
          <line x1="{x+42}" y1="510" x2="{x+744}" y2="510" stroke="{RULE}" stroke-width="1"/>
          {text_lines(['4/4'], x+42, 619, 76, fill=color, weight=700, family='Helvetica Neue')}
          {text_lines(['SOURCE REMOVALS'], x+218, 605, 18, fill=STONE, weight=700, family='Helvetica Neue', letter_spacing=1.2)}
          {text_lines([detail], x+42, 693, 25, fill=INK, weight=600, family='Helvetica Neue')}
          <rect x="{x+42}" y="749" width="702" height="78" fill="{color}"/>
          {text_lines([decision], x+393, 800, 26, fill=WHITE, weight=750, family='Helvetica Neue', anchor='middle', letter_spacing=1.4)}
        '''
    body = f'''
      {small_label('Two recorded synthetic fixtures', 106, 134)}
      {text_lines(['Same pipeline.', 'Different authority.'], 106, 256, 66, fill=NAVY)}
      {panel(106, 'Aligned evidence', 'The order-level decision survives challenge.', GREEN, 'BOUNDED PROPOSAL', '32/32 perturbations survived')}
      {panel(1028, 'Conflicting evidence', 'The decision changes when evidence is removed.', RED, 'NO_TRADE', 'No option structure or payload')}
    '''
    return frame(body)


def scene_seven() -> str:
    body = f'''
      {small_label('The options compiler', 106, 132)}
      {text_lines(['The payoff is bounded', 'before the payload exists.'], 106, 275, 74, fill=NAVY)}
      <rect x="108" y="490" width="520" height="332" fill="{NAVY}"/>
      {text_lines(['SPY 560 / 550'], 150, 556, 25, fill='#9ab0b6', weight=700, family='Helvetica Neue', letter_spacing=1.2)}
      {text_lines(['bear-put', 'debit spread'], 150, 643, 52, fill=WHITE, weight=500, line_height=1.02)}
      {text_lines(['ONE CONTRACT · SYNTHETIC FIXTURE'], 150, 783, 16, fill='#9ab0b6', weight=700, family='Helvetica Neue', letter_spacing=1.1)}
      <path d="M735 770L1010 770L1270 490L1694 490" fill="none" stroke="{GREEN}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="735" y1="630" x2="1740" y2="630" stroke="{RULE}" stroke-width="2" stroke-dasharray="10 10"/>
      {text_lines(['MAX LOSS'], 744, 772, 17, fill=STONE, weight=700, family='Helvetica Neue', letter_spacing=1.2)}
      {text_lines(['$366'], 744, 830, 56, fill=RED, weight=700, family='Helvetica Neue')}
      {text_lines(['MAX GAIN'], 1430, 425, 17, fill=STONE, weight=700, family='Helvetica Neue', letter_spacing=1.2)}
      {text_lines(['$634'], 1430, 476, 50, fill=GREEN, weight=700, family='Helvetica Neue')}
      <rect x="1176" y="748" width="564" height="74" fill="{RED_PALE}"/>
      {text_lines(['PAYLOAD COMPILED · NOT TRANSMITTED'], 1458, 795, 18, fill=RED, weight=750, family='Helvetica Neue', anchor='middle', letter_spacing=1.1)}
    '''
    return frame(body)


def scene_eight() -> str:
    facts = [
        ("113", "mixed research items", "controls, invalidated runs and reruns included"),
        ("0 / 7", "G6 challengers promoted", "hash-frozen but fully retrospective"),
        ("NOT", "historical options P&L", "G4 remains an ETF allocation replay"),
    ]
    columns = []
    for i, (value, label, note) in enumerate(facts):
        x = 108 + i * 570
        columns.append(f'<rect x="{x}" y="450" width="510" height="360" fill="{PAPER_BRIGHT}" stroke="{RULE}" stroke-width="2"/>')
        columns.append(text_lines([value], x+38, 575, 76, fill=NAVY if i < 2 else RED, weight=700, family="Helvetica Neue"))
        columns.append(text_lines([label], x+38, 636, 25, fill=INK, weight=650, family="Helvetica Neue"))
        columns.append(text_lines([note], x+38, 704, 19, fill=STONE, family="Georgia"))
    body = f'''
      {small_label('The research ledger', 108, 134)}
      {text_lines(['The limitations are part', 'of the result.'], 108, 280, 82, fill=NAVY)}
      {''.join(columns)}
      {text_lines(['Reporting the limits is part of the result.'], 960, 830, 30, fill=GREEN_DARK, weight=600, anchor='middle')}
    '''
    return frame(body)


def scene_nine() -> str:
    body = f'''
      {small_label('Production is not G4', 108, 134)}
      {text_lines(['Lower historical risk.', 'Zero forward proof.'], 108, 272, 72, fill=NAVY)}
      <rect x="108" y="420" width="840" height="410" fill="{PAPER_BRIGHT}" stroke="{RULE}" stroke-width="2"/>
      {text_lines(['PRODUCTION POLICY'], 150, 470, 17, fill=GREEN, weight=750, family='Helvetica Neue', letter_spacing=1.5)}
      {text_lines(['TSMOM_ENSEMBLE_VOL'], 904, 470, 17, fill=NAVY, weight=750, family='Helvetica Neue', anchor='end', letter_spacing=1.1)}
      <line x1="150" y1="500" x2="904" y2="500" stroke="{RULE}" stroke-width="1"/>
      {text_lines(['FINLY'], 718, 535, 15, fill=STONE, weight=700, family='Helvetica Neue', anchor='end', letter_spacing=1.1)}
      {text_lines(['SPY'], 886, 535, 15, fill=STONE, weight=700, family='Helvetica Neue', anchor='end', letter_spacing=1.1)}
      {text_lines(['Annualized return'], 150, 594, 20, fill=INK, weight=600, family='Helvetica Neue')}
      {text_lines(['11.13%'], 718, 596, 31, fill=NAVY, weight=700, family='Helvetica Neue', anchor='end')}
      {text_lines(['19.19%'], 886, 596, 31, fill=STONE, weight=700, family='Helvetica Neue', anchor='end')}
      {text_lines(['Annualized volatility'], 150, 663, 20, fill=INK, weight=600, family='Helvetica Neue')}
      {text_lines(['8.31%'], 718, 665, 31, fill=GREEN, weight=700, family='Helvetica Neue', anchor='end')}
      {text_lines(['17.33%'], 886, 665, 31, fill=STONE, weight=700, family='Helvetica Neue', anchor='end')}
      {text_lines(['Maximum drawdown'], 150, 732, 20, fill=INK, weight=600, family='Helvetica Neue')}
      {text_lines(['−5.79%'], 718, 734, 31, fill=GREEN, weight=700, family='Helvetica Neue', anchor='end')}
      {text_lines(['−18.76%'], 886, 734, 31, fill=STONE, weight=700, family='Helvetica Neue', anchor='end')}
      <line x1="150" y1="764" x2="904" y2="764" stroke="{RULE}" stroke-width="1"/>
      {text_lines(['Fixed 2025-01-02–2026-08-28 holdout · now consumed'], 150, 801, 17, fill=STONE, family='Georgia')}
      <rect x="1000" y="420" width="812" height="410" fill="{NAVY}"/>
      {text_lines(['FORWARD TRIAL ONE'], 1048, 472, 18, fill='#9ab0b6', weight=700, family='Helvetica Neue', letter_spacing=1.5)}
      {text_lines(['0'], 1050, 662, 176, fill=WHITE, weight=500, family='Helvetica Neue')}
      {text_lines(['/ 252 settlements'], 1280, 624, 32, fill='#9ab0b6', weight=650, family='Helvetica Neue')}
      <line x1="1048" y1="700" x2="1762" y2="700" stroke="#527087" stroke-width="1"/>
      {text_lines(['NO NEXT-MONTH INFERENCE'], 1048, 751, 18, fill='#d7b0a9', weight=750, family='Helvetica Neue', letter_spacing=1.2)}
      {text_lines(['BROKER AUTHORITY · NONE    INFERENCE · DISABLED'], 1048, 796, 16, fill='#9ab0b6', weight=700, family='Helvetica Neue', letter_spacing=1.0)}
    '''
    return frame(body)


def scene_ten() -> str:
    body = f'''
      {finly_mark(838, 102, 244, light=True)}
      {text_lines(['Finly'], 960, 440, 90, fill=WHITE, weight=600, family='Helvetica Neue', anchor='middle')}
      {text_lines(["Not a bigger forecast."], 960, 550, 43, fill='#a8c6b9', weight=600, anchor='middle')}
      {text_lines(['A smaller trust boundary.'], 960, 625, 62, fill=WHITE, weight=500, anchor='middle')}
      <line x1="650" y1="700" x2="1270" y2="700" stroke="#527087" stroke-width="2"/>
      {text_lines(['The bull has horns. The llama still does not get the keys.'], 960, 777, 27, fill='#d6e0dc', family='Georgia', anchor='middle')}
      {text_lines(['owlsowo.github.io/finly-bot'], 960, 830, 22, fill='#a8c6b9', weight=700, family='Helvetica Neue', anchor='middle', letter_spacing=1)}
    '''
    return frame(body, background=NAVY, footer="FINLY · EDUCATIONAL PAPER-TRADING RESEARCH PROTOTYPE")


def scene_svgs() -> list[str]:
    chart_uri = image_data(CHART_PATH)
    return [
        scene_one(), scene_two(chart_uri), scene_three(), scene_four(), scene_five(),
        scene_six(), scene_seven(), scene_eight(), scene_nine(), scene_ten(),
    ]


def duration(path: Path) -> float:
    return float(capture("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)))


def srt_time(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def caption_chunks(text: str, limit: int = 70) -> list[str]:
    clauses = [part.strip() for part in re.split(r"(?<=[.!?;:])\s+|(?<=,)\s+", text) if part.strip()]
    chunks: list[str] = []
    current = ""
    for clause in clauses:
        candidate = f"{current} {clause}".strip()
        if current and len(candidate) > limit:
            chunks.append(current)
            current = clause
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def caption_svg(caption: str) -> str:
    words = caption.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > 54:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > 2:
        midpoint = math.ceil(len(words) / 2)
        lines = [" ".join(words[:midpoint]), " ".join(words[midpoint:])]
    first_y = 75 if len(lines) == 1 else 58
    line_height = 1.28
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="180" viewBox="0 0 1920 180">
      <rect x="276" y="14" width="1368" height="142" rx="12" fill="{INK}" opacity="0.92"/>
      {text_lines(lines, 960, first_y, 34, fill=WHITE, weight=600, family='Helvetica Neue', line_height=line_height, anchor='middle')}
    </svg>'''


def verify_claims() -> None:
    claims = json.loads(CLAIMS_PATH.read_text())
    result = claims["retrospective_result"]
    falsification = claims["falsification"]
    forward = claims["forward_trial"]
    expected = {
        "candidate_annualized_return": 0.1897,
        "spy_annualized_return": 0.1511,
        "candidate_maximum_drawdown": -0.2899,
        "spy_maximum_drawdown": -0.3372,
    }
    for key, value in expected.items():
        if not math.isclose(round(result[key], 4), value, abs_tol=1e-9):
            raise RuntimeError(f"Claim lock changed: {key}={result[key]!r}")
    if result["window"] != {"start": "2013-01-02", "end": "2026-08-27"}:
        raise RuntimeError("Claim lock changed: retrospective replay window")
    if result["one_way_cost_bps"] != 5:
        raise RuntimeError("Claim lock changed: modeled one-way turnover cost")
    if not math.isclose(round(falsification["deflated_sharpe_probability"], 4), 0.0375, abs_tol=1e-9):
        raise RuntimeError("Claim lock changed: deflated Sharpe probability")
    if not math.isclose(round(falsification["worst_familywise_adjusted_p_value"], 4), 0.3718, abs_tol=1e-9):
        raise RuntimeError("Claim lock changed: adjusted familywise p-value")
    if falsification["growth_control_independence_supported"] is not False:
        raise RuntimeError("Claim lock changed: growth-control gate")
    if falsification["authenticated_source_overlap_passed"] is not False:
        raise RuntimeError("Claim lock changed: source-overlap gate")
    production = claims["production_policy"]
    if production["policy_id"] != "tsmom_ensemble_vol" or production["distinct_from_g4_shadow"] is not True:
        raise RuntimeError("Claim lock changed: production policy identity")
    if production["window"] != {"start": "2025-01-02", "end": "2026-08-28", "observations": 415}:
        raise RuntimeError("Claim lock changed: production fixed holdout")
    production_expected = {
        "candidate": {
            "annualized_return": 0.1113,
            "annualized_volatility": 0.0831,
            "maximum_drawdown": -0.0579,
        },
        "spy": {
            "annualized_return": 0.1919,
            "annualized_volatility": 0.1733,
            "maximum_drawdown": -0.1876,
        },
    }
    for owner, metrics in production_expected.items():
        for key, value in metrics.items():
            observed = round(production[owner][key], 4)
            if not math.isclose(observed, value, abs_tol=1e-9):
                raise RuntimeError(f"Claim lock changed: production {owner} {key}={observed!r}")
    if (forward["settlements"], forward["minimum_settlements_for_primary_calculation"]) != (0, 252):
        raise RuntimeError("Claim lock changed: Forward Trial 1 genesis")
    if forward["broker_authority"] is not False or forward["performance_inference_enabled"] is not False:
        raise RuntimeError("Claim lock changed: forward authority or inference state")


def build(keep_work: bool) -> None:
    verify_claims()
    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "scenes").mkdir(parents=True)
    (WORK / "audio").mkdir()
    (WORK / "segments").mkdir()

    tts = ROOT / ".venv-media" / "bin" / "edge-tts"
    if not tts.exists():
        raise RuntimeError("Install the free media voice first: python3 -m venv .venv-media && .venv-media/bin/pip install edge-tts==7.2.3")

    scene_files: list[Path] = []
    audio_files: list[Path] = []
    durations: list[float] = []
    srt_entries: list[tuple[float, float, str]] = []
    cursor = 0.0

    for index, (scene, svg) in enumerate(zip(SCENES, scene_svgs()), start=1):
        svg_path = WORK / "scenes" / f"{index:02d}-{scene.slug}.svg"
        png_path = WORK / "scenes" / f"{index:02d}-{scene.slug}.png"
        raw_audio = WORK / "audio" / f"{index:02d}-{scene.slug}.mp3"
        audio_path = WORK / "audio" / f"{index:02d}-{scene.slug}.wav"
        segment_path = WORK / "segments" / f"{index:02d}-{scene.slug}.mp4"
        svg_path.write_text(svg)
        run("node", str(ROOT / "scripts" / "render_svg.mjs"), str(svg_path), str(png_path))
        run(str(tts), "--voice", VOICE, "--rate", VOICE_RATE, "--text", scene.narration, "--write-media", str(raw_audio))
        raw_duration = duration(raw_audio)
        pause = 0.42 if index < len(SCENES) else 0.85
        scene_duration = raw_duration + pause
        run("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw_audio),
            "-af", f"apad=pad_dur={pause}", "-t", f"{scene_duration:.3f}", "-ar", "48000", "-ac", "2", str(audio_path))
        frame_count = max(1, int(round(scene_duration * 30)))
        fade_out = max(0.0, scene_duration - 0.32)
        run("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", str(png_path), "-i", str(audio_path),
            "-filter_complex",
            f"[0:v]scale=1980:1114,zoompan=z='min(zoom+0.00010,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frame_count}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.28,fade=t=out:st={fade_out:.3f}:d=0.32,format=yuv420p[v]",
            "-map", "[v]", "-map", "1:a", "-t", f"{scene_duration:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(segment_path))

        chunks = caption_chunks(scene.narration)
        total_words = sum(len(chunk.split()) for chunk in chunks)
        local_cursor = cursor
        for chunk in chunks:
            share = raw_duration * len(chunk.split()) / max(1, total_words)
            srt_entries.append((local_cursor, local_cursor + share, chunk))
            local_cursor += share
        cursor += scene_duration
        scene_files.append(segment_path)
        audio_files.append(audio_path)
        durations.append(scene_duration)

    concat_path = WORK / "segments.txt"
    concat_path.write_text("".join(f"file '{path.as_posix()}'\n" for path in scene_files))
    joined_path = WORK / "Finly_Demo_Video_uncaptioned.mp4"
    run("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat_path),
        "-c", "copy", "-movflags", "+faststart", str(joined_path))

    srt_text = []
    for index, (start, end, caption) in enumerate(srt_entries, start=1):
        srt_text.extend([str(index), f"{srt_time(start)} --> {srt_time(end)}", caption, ""])
    SUBTITLE_OUTPUT.write_text("\n".join(srt_text))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    caption_inputs: list[Path] = []
    for index, (_, _, caption) in enumerate(srt_entries, start=1):
        svg_path = WORK / "scenes" / f"caption-{index:02d}.svg"
        png_path = WORK / "scenes" / f"caption-{index:02d}.png"
        svg_path.write_text(caption_svg(caption))
        run("node", str(ROOT / "scripts" / "render_svg.mjs"), str(svg_path), str(png_path))
        caption_inputs.append(png_path)

    ffmpeg_args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(joined_path)]
    for path in caption_inputs:
        ffmpeg_args.extend(["-i", str(path)])
    filters: list[str] = ["[0:v]format=yuv420p[base]"]
    previous = "base"
    for index, (start, end, _) in enumerate(srt_entries, start=1):
        output_label = f"captioned{index}"
        filters.append(
            f"[{previous}][{index}:v]overlay=x=0:y=842:"
            f"enable='between(t,{start:.3f},{end:.3f})'[{output_label}]"
        )
        previous = output_label
    filters.append("[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[audio]")
    ffmpeg_args.extend([
        "-filter_complex", ";".join(filters), "-map", f"[{previous}]", "-map", "[audio]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart", str(OUTPUT),
    ])
    run(*ffmpeg_args)

    final_duration = duration(OUTPUT)
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    if final_duration > 300:
        raise RuntimeError(f"Video exceeds five minutes: {final_duration:.2f}s")
    if size_mb >= 300:
        raise RuntimeError(f"Video exceeds 300 MB: {size_mb:.2f} MB")
    print(f"Built {OUTPUT.relative_to(ROOT)}: {final_duration:.2f}s, {size_mb:.2f} MB, 1920x1080, captions burned in")
    print("Scene durations: " + ", ".join(f"{value:.1f}s" for value in durations))
    if not keep_work:
        shutil.rmtree(WORK)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-work", action="store_true", help="Retain rendered scene files under tmp/video_build")
    args = parser.parse_args()
    build(args.keep_work)


if __name__ == "__main__":
    main()
