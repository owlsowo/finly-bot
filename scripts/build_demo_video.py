#!/usr/bin/env python3
"""Build Finly's captioned judge film from claim-locked scenes.

The builder accepts pre-rendered narration (including ElevenLabs exports) or,
when none is supplied, uses a pinned free neural voice. It renders original SVG
scenes with FFmpeg, never calls a broker, and never reads credentials. The film
is an explanatory artifact, not evidence of execution or performance.
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
PRODUCT_PATH = ROOT / "public" / "judge" / "finly-product-home.png"
VOICE = "en-US-BrianMultilingualNeural"
VOICE_RATE = "-2%"

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
    Scene("hook", "Most trading demos begin with a chart going up and to the right. Finly asks what survives before that chart gets anywhere near a broker."),
    Scene("execution-realism", "We replaced the frozen S P Y and B I L policy's same-close assumption with next-session-open fills. Across 415 consumed sessions, after five basis points per traded-notional leg, it returned 15.39 percent with a 5.45 percent maximum drawdown. At 25 basis points, it still returned 10.56 percent. S P Y returned 33.52 percent. Finly did not beat it."),
    Scene("small-account", "At one basis point per traded leg, a three-hundred-dollar shadow ended at three hundred fifty-one dollars and eighty-eight cents. The preview enforced a one-dollar order minimum, skipped twelve sub-dollar adjustments, used nine-decimal fractional sizing, and charged a seventy-cent sell-fee proxy. That tests affordability and mechanics. It is not a broker fill."),
    Scene("authority", "The policy is deliberately boring. Three lagged S P Y minus B I L trend horizons set exposure, a ten-percent volatility target scales it, and B I L receives the rest. AI may interpret evidence and veto. Deterministic code owns exposure, order fields, maximum loss, and permission."),
    Scene("challenge", "The supportive synthetic fixture survived four of four source removals and thirty-two of thirty-two perturbations. In the conflicting fixture, removing one source changed the decision, so Finly returned no trade. A surviving fixture can compile a defined-risk S P Y spread, here with 366 dollars maximum loss and 634 dollars maximum gain, without transmitting it."),
    Scene("rejected-shadow", "Even the strongest backtest did not receive authority. G four turned a modeled one hundred thousand dollars into 1 million, 67 thousand, 106 dollars, versus 680 thousand, 817 dollars for S P Y. But it was selected after history was viewed and failed multiple-testing, growth-control, and source-overlap gates. Finly kept the chart, labeled it consumed, and rejected the strategy."),
    Scene("attempt-114", "Attempt 114 answers that hindsight problem. Before the first eligible signal, a public GitHub workflow verified 17 bound runtime files through 23 fixed public G E T checks. The protocol requires 254 consecutive timely commitment anchors and 252 reconciled settlements, with no skipped sessions, backfill, replacement windows, optional stopping, or second confirmatory try."),
    Scene("boundary", "That record is not an independent cryptographic timestamp, provider-origin proof, broker fill, or profitability result. Today there is no prospective performance inference and no broker mutation authority. Alpaca access remains read-only."),
    Scene("closing", "Finly is not a bigger forecast. It is a smaller, testable trust boundary: let AI interpret more, authorize less, and make correction, rejection, and no trade visible. The bull has horns. The llama still does not get the keys."),
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
      {small_label('Proof before authority', 214, 125)}
      {text_lines(['Before a trading view', 'becomes an order.'], 104, 320, 88, fill=NAVY, weight=500)}
      <path d="M106 790 C248 768, 332 700, 438 724 S630 616, 758 664 S940 500, 1072 550 S1272 390, 1402 444 S1608 260, 1812 190" fill="none" stroke="{GREEN}" stroke-width="14" stroke-linecap="round"/>
      <circle cx="1812" cy="190" r="18" fill="{GREEN}"/>
      <rect x="104" y="814" width="1090" height="88" fill="{NAVY}"/>
      {text_lines(['Finly tests execution, challenge, and permission—not just the chart.'], 148, 870, 27, fill=WHITE, family='Helvetica Neue', weight=600)}
    '''
    return frame(body)


def scene_two(product_uri: str) -> str:
    body = f'''
      {small_label('Execution realism', 104, 132)}
      {text_lines(['Positive after', 'next-open fills.', 'Honest about SPY.'], 104, 238, 58, fill=NAVY, line_height=1.0)}
      {text_lines(['+15.39%'], 104, 555, 82, fill=GREEN, weight=700, family='Helvetica Neue')}
      {text_lines(['5 BP PER TRADED-NOTIONAL LEG'], 108, 602, 18, fill=STONE, weight=700, family='Helvetica Neue', letter_spacing=1.1)}
      {text_lines(['+10.56%'], 104, 716, 58, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['AT 25 BP PER LEG'], 108, 756, 17, fill=STONE, weight=700, family='Helvetica Neue', letter_spacing=1.1)}
      <rect x="746" y="126" width="1074" height="672" fill="{WHITE}" stroke="{RULE}" stroke-width="2"/>
      <image x="764" y="144" width="1038" height="636" preserveAspectRatio="xMidYMid slice" xlink:href="{product_uri}"/>
      <rect x="746" y="814" width="1074" height="88" fill="{NAVY}"/>
      {text_lines(['SPY +33.52%  ·  POSITIVE ≠ ALPHA'], 1283, 869, 27, fill=WHITE, weight=700, family='Helvetica Neue', anchor='middle', letter_spacing=1.0)}
      {text_lines(['415 consumed sessions · adjusted OHLC', 'next-session-open assumption'], 104, 814, 17, fill=STONE, family='Georgia', line_height=1.15)}
    '''
    return frame(body)


def scene_three() -> str:
    body = f'''
      {small_label('Small-account feasibility', 108, 132)}
      {text_lines(['A realistic $300 shadow', 'did not invent tiny fills.'], 108, 270, 72, fill=NAVY)}
      <line x1="108" y1="440" x2="1812" y2="440" stroke="{RULE}" stroke-width="2"/>
      {text_lines(['$300.00'], 108, 588, 78, fill=STONE, weight=650, family='Helvetica Neue')}
      {text_lines(['→'], 566, 582, 76, fill=GREEN, weight=500, family='Helvetica Neue')}
      {text_lines(['$351.88'], 736, 588, 96, fill=GREEN, weight=700, family='Helvetica Neue')}
      {text_lines(['+17.29% MODELED TOTAL RETURN'], 742, 638, 20, fill=STONE, weight=700, family='Helvetica Neue', letter_spacing=1.1)}
      <line x1="108" y1="706" x2="1812" y2="706" stroke="{RULE}" stroke-width="2"/>
      {text_lines(['$1'], 108, 807, 48, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['minimum order'], 108, 850, 18, fill=STONE, weight=700, family='Helvetica Neue')}
      {text_lines(['12'], 598, 807, 48, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['sub-dollar orders skipped'], 598, 850, 18, fill=STONE, weight=700, family='Helvetica Neue')}
      {text_lines(['$0.70'], 1196, 807, 48, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['sell-day fee proxy'], 1196, 850, 18, fill=STONE, weight=700, family='Helvetica Neue')}
      {text_lines(['Affordability and mechanics—not a broker fill.'], 1812, 850, 20, fill=RED, weight=650, family='Georgia', anchor='end')}
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
      {text_lines(['The model can interpret.', 'Code decides whether capital moves.'], 108, 270, 68, fill=NAVY)}
      {''.join(blocks)}
      <rect x="107" y="700" width="1704" height="120" fill="{NAVY}"/>
      {text_lines(['Three trend horizons · 10% volatility target · residual capital in BIL'], 959, 760, 31, fill=WHITE, weight=600, family='Helvetica Neue', anchor='middle')}
      {text_lines(['AI may veto. It cannot size, compile, or transmit.'], 959, 804, 21, fill='#a8c6b9', weight=600, family='Georgia', anchor='middle')}
    '''
    return frame(body)


def scene_five() -> str:
    body = f'''
      {small_label('Challenge, then compile', 106, 132)}
      {text_lines(['A rationale is not permission.'], 106, 248, 72, fill=NAVY)}
      <rect x="106" y="358" width="786" height="306" fill="{PAPER_BRIGHT}" stroke="{GREEN}" stroke-width="3"/>
      {text_lines(['ALIGNED EVIDENCE'], 148, 410, 18, fill=GREEN, weight=800, family='Helvetica Neue', letter_spacing=1.5)}
      {text_lines(['4/4'], 148, 525, 76, fill=GREEN, weight=700, family='Helvetica Neue')}
      {text_lines(['source removals'], 340, 510, 21, fill=STONE, weight=700, family='Helvetica Neue')}
      {text_lines(['32/32'], 148, 614, 48, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['perturbations survived'], 340, 604, 21, fill=STONE, weight=700, family='Helvetica Neue')}
      <rect x="1026" y="358" width="786" height="306" fill="{RED_PALE}" stroke="{RED}" stroke-width="3"/>
      {text_lines(['CONFLICTING EVIDENCE'], 1068, 410, 18, fill=RED, weight=800, family='Helvetica Neue', letter_spacing=1.5)}
      {text_lines(['NO_TRADE'], 1068, 538, 70, fill=RED, weight=800, family='Helvetica Neue')}
      {text_lines(['One source removal changed the decision.'], 1068, 612, 23, fill=INK, weight=600, family='Georgia')}
      <rect x="106" y="712" width="1706" height="134" fill="{NAVY}"/>
      {text_lines(['DEFINED-RISK FIXTURE'], 148, 758, 16, fill='#9ab0b6', weight=800, family='Helvetica Neue', letter_spacing=1.4)}
      {text_lines(['$366 max loss'], 148, 817, 39, fill=WHITE, weight=700, family='Helvetica Neue')}
      {text_lines(['$634 max gain'], 650, 817, 39, fill='#a8c6b9', weight=700, family='Helvetica Neue')}
      {text_lines(['PAYLOAD COMPILED · NOT TRANSMITTED'], 1768, 817, 20, fill='#d7b0a9', weight=800, family='Helvetica Neue', anchor='end', letter_spacing=1.2)}
    '''
    return frame(body)


def scene_six(chart_uri: str) -> str:
    body = f'''
      <image x="724" y="112" width="1096" height="700" preserveAspectRatio="xMidYMid slice" opacity="0.95" xlink:href="{chart_uri}"/>
      <rect x="0" y="0" width="806" height="1000" fill="{PAPER}"/>
      {small_label('The tempting result', 104, 132, fill=RED)}
      {text_lines(['The best-looking', 'backtest was rejected.'], 104, 272, 76, fill=NAVY)}
      {text_lines(['$1,067,106'], 104, 585, 65, fill=GREEN, weight=700, family='Helvetica Neue')}
      {text_lines(['G4 ENDING VALUE'], 108, 626, 17, fill=STONE, weight=800, family='Helvetica Neue', letter_spacing=1.3)}
      {text_lines(['SPY $680,817'], 108, 685, 28, fill=NAVY, weight=700, family='Helvetica Neue')}
      <g transform="translate(124 742) rotate(-3)"><rect width="500" height="118" rx="4" fill="{PAPER}" stroke="{RED}" stroke-width="8"/>{text_lines(['NOT PROMOTED'], 250, 76, 38, fill=RED, weight=800, family='Helvetica Neue', anchor='middle', letter_spacing=2)}</g>
      {text_lines(['Post-selected · multiplicity failed · control independence unsupported'], 724, 828, 18, fill=STONE, family='Helvetica Neue')}
      {text_lines(['Consumed ETF replay—not options P&L or a forecast'], 724, 860, 18, fill=RED, weight=700, family='Helvetica Neue')}
    '''
    return frame(body)


def scene_seven() -> str:
    body = f'''
      {small_label('Prospective proof', 106, 132)}
      {text_lines(['Attempt 114 freezes the next claim', 'before the first eligible signal.'], 106, 256, 64, fill=NAVY)}
      <line x1="106" y1="430" x2="1812" y2="430" stroke="{RULE}" stroke-width="2"/>
      {text_lines(['17/17'], 106, 574, 72, fill=GREEN, weight=700, family='Helvetica Neue')}
      {text_lines(['runtime files bound'], 106, 616, 18, fill=STONE, weight=750, family='Helvetica Neue')}
      {text_lines(['23'], 548, 574, 72, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['fixed public GET checks'], 548, 616, 18, fill=STONE, weight=750, family='Helvetica Neue')}
      {text_lines(['254'], 1010, 574, 72, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['timely commitment anchors'], 1010, 616, 18, fill=STONE, weight=750, family='Helvetica Neue')}
      {text_lines(['252'], 1480, 574, 72, fill=NAVY, weight=700, family='Helvetica Neue')}
      {text_lines(['reconciled settlements'], 1480, 616, 18, fill=STONE, weight=750, family='Helvetica Neue')}
      <rect x="106" y="700" width="1706" height="136" fill="{NAVY}"/>
      {text_lines(['NO SKIPS · NO BACKFILL · NO REPLACEMENT WINDOW · NO OPTIONAL STOPPING · NO SECOND TRY'], 959, 764, 21, fill=WHITE, weight=750, family='Helvetica Neue', anchor='middle', letter_spacing=1.0)}
      {text_lines(['Public GitHub workflow verified before the exclusive first-signal deadline'], 959, 808, 20, fill='#a8c6b9', weight=600, family='Georgia', anchor='middle')}
    '''
    return frame(body)


def scene_eight() -> str:
    body = f'''
      {small_label('The boundary', 108, 132, fill='#8eb8a7')}
      {text_lines(['What the public record', 'does not prove.'], 108, 276, 78, fill=WHITE)}
      <line x1="108" y1="486" x2="1812" y2="486" stroke="#527087" stroke-width="2"/>
      {text_lines(['NOT AN INDEPENDENT', 'CRYPTOGRAPHIC TIMESTAMP'], 108, 570, 25, fill='#d7b0a9', weight=750, family='Helvetica Neue', line_height=1.25, letter_spacing=1.0)}
      {text_lines(['NOT PROVIDER-ORIGIN', 'PROOF'], 560, 570, 25, fill='#d7b0a9', weight=750, family='Helvetica Neue', line_height=1.25, letter_spacing=1.0)}
      {text_lines(['NOT A BROKER', 'FILL'], 1012, 570, 25, fill='#d7b0a9', weight=750, family='Helvetica Neue', line_height=1.25, letter_spacing=1.0)}
      {text_lines(['NOT A PROFITABILITY', 'RESULT'], 1464, 570, 25, fill='#d7b0a9', weight=750, family='Helvetica Neue', line_height=1.25, letter_spacing=1.0)}
      <rect x="108" y="718" width="1704" height="122" fill="#163b5a"/>
      {text_lines(['PERFORMANCE INFERENCE · DISABLED'], 160, 775, 21, fill=WHITE, weight=750, family='Helvetica Neue', letter_spacing=1.1)}
      {text_lines(['BROKER MUTATION · DISABLED'], 960, 775, 21, fill=WHITE, weight=750, family='Helvetica Neue', anchor='middle', letter_spacing=1.1)}
      {text_lines(['ALPACA ACCESS · READ-ONLY'], 1760, 775, 21, fill='#a8c6b9', weight=750, family='Helvetica Neue', anchor='end', letter_spacing=1.1)}
    '''
    return frame(body, background=NAVY, footer="FINLY · PUBLIC CLAIM BOUNDARY")


def scene_nine() -> str:
    body = f'''
      {finly_mark(838, 96, 244, light=True)}
      {text_lines(['Finly'], 960, 426, 90, fill=WHITE, weight=600, family='Helvetica Neue', anchor='middle')}
      {text_lines(['Not a bigger forecast.'], 960, 548, 42, fill='#a8c6b9', weight=600, anchor='middle')}
      {text_lines(['A smaller, testable trust boundary.'], 960, 630, 58, fill=WHITE, weight=500, anchor='middle')}
      <line x1="610" y1="710" x2="1310" y2="710" stroke="#527087" stroke-width="2"/>
      {text_lines(['Let AI interpret more. Authorize less. Make NO_TRADE visible.'], 960, 778, 28, fill='#d6e0dc', family='Georgia', anchor='middle')}
      {text_lines(['The bull has horns. The llama still does not get the keys.'], 960, 830, 23, fill='#a8c6b9', family='Georgia', anchor='middle')}
      {text_lines(['owlsowo.github.io/finly-bot'], 960, 852, 20, fill='#a8c6b9', weight=700, family='Helvetica Neue', anchor='middle', letter_spacing=1)}
    '''
    return frame(body, background=NAVY, footer="FINLY · EDUCATIONAL PAPER-TRADING RESEARCH PROTOTYPE")


def scene_svgs() -> list[str]:
    chart_uri = image_data(CHART_PATH)
    product_uri = image_data(PRODUCT_PATH)
    return [
        scene_one(), scene_two(product_uri), scene_three(), scene_four(), scene_five(),
        scene_six(chart_uri), scene_seven(), scene_eight(), scene_nine(),
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


def display_narration(text: str) -> str:
    """Keep pronunciation hints out of human-facing captions."""
    replacements = {
        "S P Y": "SPY",
        "B I L": "BIL",
        "G E T": "GET",
        "G four": "G4",
        "three-hundred-dollar": "$300",
        "three hundred fifty-one dollars and eighty-eight cents": "$351.88",
        "one-dollar": "$1",
        "seventy-cent": "$0.70",
        "366 dollars": "$366",
        "634 dollars": "$634",
        "one hundred thousand dollars": "$100,000",
        "1 million, 67 thousand, 106 dollars": "$1,067,106",
        "680 thousand, 817 dollars": "$680,817",
    }
    for spoken, displayed in replacements.items():
        text = text.replace(spoken, displayed)
    return text


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
    first_y = 64 if len(lines) == 1 else 48
    line_height = 1.22
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="150" viewBox="0 0 1920 150">
      <rect x="276" y="8" width="1368" height="128" rx="12" fill="{INK}" opacity="0.92"/>
      {text_lines(lines, 960, first_y, 31, fill=WHITE, weight=600, family='Helvetica Neue', line_height=line_height, anchor='middle')}
    </svg>'''


def verify_claims() -> None:
    claims = json.loads(CLAIMS_PATH.read_text())
    execution = claims["execution_realism"]
    if execution["evidence_class"] != "CONSUMED_RETROSPECTIVE_EXECUTION_REALISM":
        raise RuntimeError("Claim lock changed: execution-realism evidence class")
    if execution["policy_id"] != "tsmom_ensemble_vol":
        raise RuntimeError("Claim lock changed: production policy identity")
    if execution["window"] != {"start": "2025-01-02", "end": "2026-08-28", "observations": 415}:
        raise RuntimeError("Claim lock changed: execution-realism window")
    if "next session open t+1" not in execution["fill_assumption"]:
        raise RuntimeError("Claim lock changed: next-open fill assumption")
    cost_rows = {row["bps_per_leg"]: row for row in execution["next_open_cost_stress"]}
    expected_cost_rows = {
        1: (0.1637768834, -0.0537699288),
        5: (0.1538759778, -0.0544710489),
        25: (0.1055891073, -0.0579709322),
    }
    if set(cost_rows) != set(expected_cost_rows):
        raise RuntimeError("Claim lock changed: execution-realism cost grid")
    for bps, (expected_return, expected_drawdown) in expected_cost_rows.items():
        row = cost_rows[bps]
        if not math.isclose(row["total_return"], expected_return, abs_tol=1e-10):
            raise RuntimeError(f"Claim lock changed: {bps} bp return")
        if not math.isclose(row["maximum_drawdown"], expected_drawdown, abs_tol=1e-10):
            raise RuntimeError(f"Claim lock changed: {bps} bp drawdown")
        if not math.isclose(row["spy_total_return"], 0.3352366407, abs_tol=1e-10):
            raise RuntimeError(f"Claim lock changed: {bps} bp SPY comparator")
        if row["total_return"] >= row["spy_total_return"]:
            raise RuntimeError("Claim lock changed: production must not be narrated as beating SPY")
    small = execution["small_account_proxy"]
    expected_small = {
        "initial_equity_usd": 300,
        "ending_equity_usd": 351.88433421,
        "total_return": 0.1729477807,
        "minimum_order_notional_usd": 1,
        "quantity_decimals": 9,
        "sell_day_fees_total_usd": 0.7,
        "skipped_minimum_orders": 12,
    }
    for key, value in expected_small.items():
        if not math.isclose(float(small[key]), float(value), abs_tol=1e-10):
            raise RuntimeError(f"Claim lock changed: small-account {key}")
    if execution["assurance"]["future_profitability_proven"] is not False:
        raise RuntimeError("Claim lock changed: future profitability boundary")
    if execution["assurance"]["broker_fill_verified"] is not False:
        raise RuntimeError("Claim lock changed: broker-fill boundary")

    result = claims["retrospective_result"]
    if result["promotion_status"] != "NOT_PROMOTED_DESCRIPTIVE_ONLY":
        raise RuntimeError("Claim lock changed: G4 promotion boundary")
    if not math.isclose(100_000 * (1 + result["candidate_total_return"]), 1_067_105.97833, abs_tol=1e-5):
        raise RuntimeError("Claim lock changed: G4 ending value")
    if not math.isclose(100_000 * (1 + result["spy_total_return"]), 680_817.46189, abs_tol=1e-5):
        raise RuntimeError("Claim lock changed: G4 SPY ending value")
    falsification = claims["falsification"]
    if falsification["growth_control_independence_supported"] is not False:
        raise RuntimeError("Claim lock changed: growth-control gate")
    if falsification["authenticated_source_overlap_passed"] is not False:
        raise RuntimeError("Claim lock changed: source-overlap gate")
    if falsification["worst_familywise_adjusted_p_value"] <= 0.05:
        raise RuntimeError("Claim lock changed: multiplicity gate")

    attempt = claims["prospective_attempt114"]
    if attempt["attempt_number"] != 114:
        raise RuntimeError("Claim lock changed: prospective attempt number")
    if attempt["publication_status"] != "PUBLIC_PRE_DEADLINE_GITHUB_WORKFLOW_VERIFIED":
        raise RuntimeError("Claim lock changed: Attempt 114 publication status")
    expected_attempt = {
        "bound_runtime_source_count": 17,
        "public_get_count": 23,
        "required_signal_commitments": 254,
        "required_settlements": 252,
    }
    for key, value in expected_attempt.items():
        if attempt[key] != value:
            raise RuntimeError(f"Claim lock changed: Attempt 114 {key}")
    if attempt["assurance"]["independent_cryptographic_timestamp_verified"] is not False:
        raise RuntimeError("Claim lock changed: timestamp boundary")
    if attempt["assurance"]["performance_inference_permitted"] is not False:
        raise RuntimeError("Claim lock changed: prospective inference boundary")
    if attempt["assurance"]["broker_mutation_authorized"] is not False:
        raise RuntimeError("Claim lock changed: broker mutation boundary")
    if claims["options_and_broker_boundary"]["order_submitted_or_filled_as_evidence"] is not False:
        raise RuntimeError("Claim lock changed: order evidence boundary")


def supplied_audio(audio_dir: Path, index: int, scene: Scene) -> Path:
    stem = f"{index:02d}-{scene.slug}"
    matches = [audio_dir / f"{stem}{suffix}" for suffix in (".wav", ".mp3", ".m4a", ".flac")]
    found = [path for path in matches if path.is_file()]
    if len(found) != 1:
        raise RuntimeError(f"Expected exactly one supplied narration file for {stem}; found {len(found)}")
    return found[0]


def build(keep_work: bool, audio_dir: Path | None, voice: str) -> None:
    verify_claims()
    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "scenes").mkdir(parents=True)
    (WORK / "audio").mkdir()
    (WORK / "segments").mkdir()

    tts = ROOT / ".venv-media" / "bin" / "edge-tts"
    if audio_dir is not None:
        audio_dir = audio_dir.expanduser().resolve()
        if not audio_dir.is_dir():
            raise RuntimeError(f"Supplied narration directory does not exist: {audio_dir}")
    elif not tts.exists():
        raise RuntimeError("Provide --audio-dir or install the pinned free media voice in .venv-media")

    scene_files: list[Path] = []
    durations: list[float] = []
    srt_entries: list[tuple[float, float, str]] = []
    cursor = 0.0

    for index, (scene, svg) in enumerate(zip(SCENES, scene_svgs()), start=1):
        svg_path = WORK / "scenes" / f"{index:02d}-{scene.slug}.svg"
        png_path = WORK / "scenes" / f"{index:02d}-{scene.slug}.png"
        generated_audio = WORK / "audio" / f"{index:02d}-{scene.slug}.mp3"
        audio_path = WORK / "audio" / f"{index:02d}-{scene.slug}.wav"
        segment_path = WORK / "segments" / f"{index:02d}-{scene.slug}.mp4"
        svg_path.write_text(svg)
        run("node", str(ROOT / "scripts" / "render_svg.mjs"), str(svg_path), str(png_path))
        if audio_dir is not None:
            raw_audio = supplied_audio(audio_dir, index, scene)
        else:
            raw_audio = generated_audio
            run(str(tts), "--voice", voice, "--rate", VOICE_RATE, "--text", scene.narration, "--write-media", str(raw_audio))
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

        chunks = caption_chunks(display_narration(scene.narration))
        total_words = sum(len(chunk.split()) for chunk in chunks)
        local_cursor = cursor
        for chunk in chunks:
            share = raw_duration * len(chunk.split()) / max(1, total_words)
            srt_entries.append((local_cursor, local_cursor + share, chunk))
            local_cursor += share
        cursor += scene_duration
        scene_files.append(segment_path)
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
            f"[{previous}][{index}:v]overlay=x=0:y=872:"
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
    parser.add_argument("--audio-dir", type=Path,
                        help="Directory with 01-slug.wav/mp3/... narration files, including ElevenLabs exports")
    parser.add_argument("--voice", default=VOICE, help="Edge neural voice used when --audio-dir is omitted")
    args = parser.parse_args()
    build(args.keep_work, args.audio_dir, args.voice)


if __name__ == "__main__":
    main()
