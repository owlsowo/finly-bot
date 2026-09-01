#!/usr/bin/env python3
"""Build Finly's short, proof-led, captioned product launch.

The film uses the final deck plus project-owned site captures. Every render
requires licensed human or ElevenLabs scene audio through --audio-dir. There is
no system-voice path. The builder never reads credentials or calls a broker.
"""

from __future__ import annotations

import argparse
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
DIST_OUTPUT = ROOT / "dist" / "judge" / "Finly_Demo_Video.mp4"
DIST_SUBTITLE_OUTPUT = ROOT / "dist" / "judge" / "Finly_Demo_Video.srt"
DECK_PDF = ROOT / "public" / "judge" / "Finly_Consulting_Deck.pdf"
GATE_PATH = ROOT / "research" / "output" / "quantitative_release_gate.json"
EXTERNAL_REPLAY_PATH = ROOT / "public" / "data" / "attempt150_public_evidence.json"
RECEIPT_PATH = ROOT / "public" / "data" / "latest_receipt.json"
LIVE_ACCOUNT_PATH = ROOT / "public" / "data" / "competition_live.json"
FIRST_CLOSE_PATH = ROOT / "public" / "data" / "competition_forward_profit_2026_08_31.json"

INK = "#152630"
WHITE = "#ffffff"
INTER_SCENE_PAUSE = 0.20
FINAL_PAUSE = 0.55
MIN_FINAL_SECONDS = 75.0
MAX_FINAL_SECONDS = 90.0
SUPPLIED_AUDIO_TEMPO = 1.27
FIRST_CLOSE_AUDIO_TEMPO = 1.27


@dataclass(frozen=True)
class Scene:
    slug: str
    source: str
    target_seconds: float
    narration: str


SCENES = [
    Scene(
        "hook",
        "slide:2",
        7.0,
        "A I can sound certain and still be wrong. Finly does not give it the account keys.",
    ),
    Scene(
        "product",
        "slide:3",
        12.0,
        "Finly is a trading bot that uses real market prices and virtual money. A I studies the market and explains a trade. Fixed code caps the loss and decides what reaches Alpaca.",
    ),
    Scene(
        "approve",
        "asset:public/judge/video-controls-aligned.jpg",
        8.0,
        "When signals agree, Finly builds the paper order. A I explains it; only rules can approve it.",
    ),
    Scene(
        "refuse",
        "asset:public/judge/video-controls-conflict.jpg",
        7.0,
        "When signals conflict, Finly does nothing. It shows why and stops before the account.",
    ),
    Scene(
        "receipt",
        "slide:6",
        10.0,
        "Every decision carries a receipt: the proposed position, dollars at risk, and checks passed. This checked S and P 500 options example risked at most $366—below Finly's $500 limit. It was a test case, not a live fill.",
    ),
    Scene(
        "live-result",
        "slide:7",
        11.0,
        "Finly's separate rules-based base portfolio then ran during live market hours. At the first close, it gained $95.32 while S P Y lost $57.99—a $153.31 advantage from the same $100,000 start.",
    ),
    Scene(
        "historical-result",
        "slide:4",
        10.0,
        "We also replayed that base-portfolio rule from 2013 to 2026. $10,000 became $106,711 with Finly—$38,629 more than S P Y after modeled trading costs.",
    ),
    Scene(
        "older-market-test",
        "slide:5",
        10.0,
        "A simpler version of the portfolio was tested on a separate 80-year market record. It returned 13.37% a year versus 9.48% for the market and stayed ahead at every tested rebalance date.",
    ),
    Scene(
        "technical-handoff",
        "slide:9",
        8.0,
        "Judges can open the decision, rerun tests, inspect the Alpaca order, and verify every number in the public repository.",
    ),
]


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def capture(*args: str) -> str:
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def duration(path: Path) -> float:
    return float(capture(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path),
    ))


def supplied_audio_tempo(scene: Scene) -> float:
    return FIRST_CLOSE_AUDIO_TEMPO if scene.slug == "live-result" else SUPPLIED_AUDIO_TEMPO


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
    replacements = {
        "A I": "AI",
        "S and P 500": "S&P 500",
        "S P Y": "SPY",
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
        if current and len(candidate) > 55:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > 2:
        midpoint = math.ceil(len(words) / 2)
        lines = [" ".join(words[:midpoint]), " ".join(words[midpoint:])]
    first_y = 72 if len(lines) == 1 else 52
    tspans = []
    for index, line in enumerate(lines):
        dy = 0 if index == 0 else 40
        tspans.append(f'<tspan x="960" dy="{dy}">{html.escape(line)}</tspan>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="150" viewBox="0 0 1920 150">
      <rect x="250" y="10" width="1420" height="126" rx="10" fill="{INK}" opacity="0.94"/>
      <text x="960" y="{first_y}" fill="{WHITE}" font-family="Helvetica Neue" font-size="31" font-weight="600" text-anchor="middle">{"".join(tspans)}</text>
    </svg>'''


def verify_claims() -> None:
    gate = json.loads(GATE_PATH.read_text())
    if gate["artifact_sha256"] != "sha256:1550d4fa7956138074dd08b98b8836811e6bd9adfd635e1378598efd81d0d5f1":
        raise RuntimeError("Quantitative release gate hash changed")
    if gate["release_decision"]["status"] != "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP":
        raise RuntimeError("Quantitative release decision changed")

    g4 = gate["conclusions"]["g4_rejected_post_selection"]
    if not math.isclose(g4["g4_total_return"], 9.6710597833, abs_tol=1e-10):
        raise RuntimeError("2013–2026 Finly return changed")
    if not math.isclose(g4["spy_total_return"], 5.8081746189, abs_tol=1e-10):
        raise RuntimeError("2013–2026 SPY return changed")
    finly_ending_wealth = round(10_000 * (1 + g4["g4_total_return"]))
    spy_ending_wealth = round(10_000 * (1 + g4["spy_total_return"]))
    if (finly_ending_wealth, spy_ending_wealth, finly_ending_wealth - spy_ending_wealth) != (106_711, 68_082, 38_629):
        raise RuntimeError("Historical ending-wealth calculation changed")

    external = json.loads(EXTERNAL_REPLAY_PATH.read_text())
    if external["evidence_class"] != "PRE_SPECIFIED_OUT_OF_ERA_EXTERNAL_REPLAY":
        raise RuntimeError("External replay evidence class changed")
    if external["primary_window"] != {
        "start_date": "1927-05-07",
        "end_date": "2007-05-29",
        "observations": 21218,
        "modeled_one_way_cost_bps": 5,
    }:
        raise RuntimeError("External replay window changed")
    headline = external["headline"]
    if not math.isclose(headline["finly_annualized_return"], 0.13373047164258, abs_tol=1e-12):
        raise RuntimeError("External replay Finly return changed")
    if not math.isclose(headline["market_annualized_return"], 0.09479210440508279, abs_tol=1e-12):
        raise RuntimeError("External replay market return changed")
    robustness = external["robustness"]
    if (robustness["positive_rebalance_anchors"], robustness["tested_rebalance_anchors"]) != (21, 21):
        raise RuntimeError("External replay anchor result changed")

    receipt = json.loads(RECEIPT_PATH.read_text())
    selected = receipt["compilation"]["selected"]
    if (selected["underlying"], selected["max_loss"], selected["max_gain"]) != ("SPY", 366, 634):
        raise RuntimeError("Checked SPY spread changed")
    if len(receipt["source_removal"]["variants"]) != 4 or receipt["source_removal"]["passed"] is not True:
        raise RuntimeError("Source-removal checks changed")
    if receipt["perturbations"]["count"] != 32 or receipt["perturbations"]["passed"] is not True:
        raise RuntimeError("Input-shock checks changed")
    if receipt["alpaca_payload"]["order_class"] != "mleg" or receipt["certificate"]["certified"] is not True:
        raise RuntimeError("Paper-order payload or certificate changed")

    live = json.loads(LIVE_ACCOUNT_PATH.read_text())
    if live["account"]["equity"] != 100_000:
        raise RuntimeError("Paper-account equity changed")
    if live["integrity"] != {
        "paper_account": True,
        "account_verified": True,
        "sanitized": True,
        "source": "Alpaca paper account",
    }:
        raise RuntimeError("Paper-account verification changed")

    first_close = json.loads(FIRST_CLOSE_PATH.read_text())
    if first_close["common_valued_at"] != "2026-08-31T20:00:00.000Z":
        raise RuntimeError("First-close common timestamp changed")
    if first_close["primary_kpi"]["net_pnl_dollars"] != 95.32:
        raise RuntimeError("First-close Finly P&L changed")
    if first_close["benchmark"]["ending_value_on_same_baseline_dollars"] != 99_942.01:
        raise RuntimeError("First-close SPY benchmark changed")
    if first_close["secondary_kpi"]["excess_pnl_dollars"] != 153.31:
        raise RuntimeError("First-close advantage changed")
    if first_close["drivers"]["fill_event_count"] != 15:
        raise RuntimeError("First-close fill count changed")
    if first_close["drivers"]["external_cashflow_event_count"] != 0:
        raise RuntimeError("First-close external cashflows changed")
    if first_close["integrity"]["claim_publishable"] is not True:
        raise RuntimeError("First-close measurement is not publishable")

    narration = " ".join(scene.narration for scene in SCENES)
    required = [
        "does not give it the account keys", "uses real market prices and virtual money",
        "Fixed code caps the loss", "only rules can approve it",
        "signals conflict", "Every decision carries a receipt",
        "$366", "$500 limit", "during live market hours",
        "$10,000", "$106,711", "$38,629", "13.37%", "9.48%",
        "$100,000 start", "$95.32", "$57.99", "$153.31",
        "Judges can open the decision", "public repository",
    ]
    for phrase in required:
        if phrase.lower() not in narration.lower():
            raise RuntimeError(f"Narration is missing required launch phrase: {phrase}")

    banned = [
        "consumed", "deflated sharpe", "familywise", "proof ladder",
        "authority boundary", "falsifiable", "refused to trade", "denied promotion",
    ]
    for phrase in banned:
        if phrase in narration.lower():
            raise RuntimeError(f"Narration contains rejected jargon: {phrase}")


def supplied_audio(audio_dir: Path, index: int, scene: Scene) -> Path:
    stem = f"{index:02d}-{scene.slug}"
    candidates = [audio_dir / f"{stem}{suffix}" for suffix in (".wav", ".mp3", ".m4a", ".flac")]
    found = [path for path in candidates if path.is_file()]
    if len(found) != 1:
        raise RuntimeError(f"Expected exactly one supplied narration file for {stem}; found {len(found)}")
    return found[0]


def source_path(scene: Scene, deck_frames: list[Path] | None = None) -> Path:
    if scene.source.startswith("slide:"):
        slide_number = int(scene.source.removeprefix("slide:"))
        if not 1 <= slide_number <= 9:
            raise RuntimeError(f"Invalid deck slide for {scene.slug}: {slide_number}")
        if deck_frames is None:
            return DECK_PDF
        return deck_frames[slide_number - 1]
    if scene.source.startswith("asset:"):
        path = ROOT / scene.source.removeprefix("asset:")
        if not path.is_file():
            raise RuntimeError(f"Missing scene asset for {scene.slug}: {path.relative_to(ROOT)}")
        return path
    raise RuntimeError(f"Unknown scene source for {scene.slug}: {scene.source}")


def structural_check(audio_dir: Path | None = None) -> None:
    verify_claims()
    if not DECK_PDF.is_file():
        raise RuntimeError("Build public/judge/Finly_Consulting_Deck.pdf before the film")
    page_match = re.search(r"^Pages:\s+(\d+)$", capture("pdfinfo", str(DECK_PDF)), flags=re.MULTILINE)
    if page_match is None or int(page_match.group(1)) != 9:
        raise RuntimeError("The final deck must contain exactly nine slides")
    for scene in SCENES:
        source_path(scene)

    target_duration = sum(scene.target_seconds for scene in SCENES)
    if not MIN_FINAL_SECONDS <= target_duration <= MAX_FINAL_SECONDS:
        raise RuntimeError(f"Storyboard target is outside 75–90 seconds: {target_duration:.1f}s")

    word_count = sum(len(re.findall(r"\b[\w'-]+\b", scene.narration)) for scene in SCENES)
    print(f"Structural check passed: {len(SCENES)} scenes, {word_count} written tokens, {target_duration:.1f}s target")
    for index, scene in enumerate(SCENES, start=1):
        print(f"  {index:02d}-{scene.slug}: {scene.target_seconds:.1f}s · {scene.source}")

    if audio_dir is not None:
        resolved_audio_dir = audio_dir.expanduser().resolve()
        if not resolved_audio_dir.is_dir():
            raise RuntimeError(f"Supplied narration directory does not exist: {resolved_audio_dir}")
        audio_seconds = sum(
            duration(supplied_audio(resolved_audio_dir, index, scene)) / supplied_audio_tempo(scene)
            for index, scene in enumerate(SCENES, start=1)
        )
        actual_with_pauses = audio_seconds + INTER_SCENE_PAUSE * (len(SCENES) - 1) + FINAL_PAUSE
        if not MIN_FINAL_SECONDS <= actual_with_pauses <= MAX_FINAL_SECONDS:
            raise RuntimeError(
            f"Supplied narration would produce a {actual_with_pauses:.1f}s cut; final must be {MIN_FINAL_SECONDS:.0f}–{MAX_FINAL_SECONDS:.0f}s"
            )
        print(f"Supplied narration check passed: {actual_with_pauses:.1f}s including pauses")


def render_deck_frames() -> list[Path]:
    if not DECK_PDF.is_file():
        raise RuntimeError("Build public/judge/Finly_Consulting_Deck.pdf before the film")
    prefix = WORK / "frames" / "slide"
    run("pdftoppm", "-png", "-r", "150", str(DECK_PDF), str(prefix))
    frames = sorted((WORK / "frames").glob("slide-*.png"))
    if len(frames) != 9:
        raise RuntimeError(f"Expected nine rendered deck slides; found {len(frames)}")
    return frames


def build(keep_work: bool, audio_dir: Path | None) -> None:
    if audio_dir is None:
        raise RuntimeError("Builds require --audio-dir with licensed human or ElevenLabs narration")
    structural_check(audio_dir)

    output = OUTPUT
    subtitle_output = SUBTITLE_OUTPUT
    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "frames").mkdir(parents=True)
    (WORK / "audio").mkdir()
    (WORK / "segments").mkdir()
    (WORK / "captions").mkdir()

    frames = render_deck_frames()
    audio_dir = audio_dir.expanduser().resolve()
    if not audio_dir.is_dir():
        raise RuntimeError(f"Supplied narration directory does not exist: {audio_dir}")

    scene_files: list[Path] = []
    scene_durations: list[float] = []
    srt_entries: list[tuple[float, float, str]] = []
    cursor = 0.0
    motion = [
        ("iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
        ("0", "ih/2-(ih/zoom/2)"),
        ("iw-(iw/zoom)", "ih/2-(ih/zoom/2)"),
        ("iw/2-(iw/zoom/2)", "0"),
        ("iw/2-(iw/zoom/2)", "ih-(ih/zoom)"),
    ]

    for index, scene in enumerate(SCENES, start=1):
        audio_path = WORK / "audio" / f"{index:02d}-{scene.slug}.wav"
        segment_path = WORK / "segments" / f"{index:02d}-{scene.slug}.mp4"
        frame_path = source_path(scene, frames)

        raw_audio = supplied_audio(audio_dir, index, scene)

        source_audio_duration = duration(raw_audio)
        audio_tempo = supplied_audio_tempo(scene)
        raw_duration = source_audio_duration / audio_tempo
        pause = INTER_SCENE_PAUSE if index < len(SCENES) else FINAL_PAUSE
        scene_duration = raw_duration + pause
        audio_filter = f"atempo={audio_tempo},apad=pad_dur={pause}"
        run(
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw_audio),
            "-af", audio_filter, "-t", f"{scene_duration:.3f}",
            "-ar", "48000", "-ac", "2", str(audio_path),
        )

        frame_count = max(1, int(round(scene_duration * 30)))
        fade_out = max(0.0, scene_duration - 0.24)
        x_expr, y_expr = motion[(index - 1) % len(motion)]
        video_filter = (
            f"[0:v]scale=2000:1125,"
            f"zoompan=z='min(zoom+0.00008,1.018)':x='{x_expr}':y='{y_expr}':"
            f"d={frame_count}:s=1920x1080:fps=30,"
            f"fade=t=in:st=0:d=0.20,fade=t=out:st={fade_out:.3f}:d=0.24,format=yuv420p[v]"
        )
        run(
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1",
            "-i", str(frame_path), "-i", str(audio_path), "-filter_complex", video_filter,
            "-map", "[v]", "-map", "1:a", "-t", f"{scene_duration:.3f}",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(segment_path),
        )

        chunks = caption_chunks(display_narration(scene.narration))
        total_words = sum(len(chunk.split()) for chunk in chunks)
        local_cursor = cursor
        for chunk in chunks:
            share = raw_duration * len(chunk.split()) / max(1, total_words)
            srt_entries.append((local_cursor, local_cursor + share, chunk))
            local_cursor += share
        cursor += scene_duration
        scene_files.append(segment_path)
        scene_durations.append(scene_duration)

    concat_path = WORK / "segments.txt"
    concat_path.write_text("".join(f"file '{path.as_posix()}'\n" for path in scene_files))
    joined_path = WORK / "Finly_Demo_Video_uncaptioned.mp4"
    run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(concat_path), "-c", "copy", "-movflags", "+faststart", str(joined_path),
    )

    srt_lines: list[str] = []
    for index, (start, end, caption) in enumerate(srt_entries, start=1):
        srt_lines.extend([str(index), f"{srt_time(start)} --> {srt_time(end)}", caption, ""])
    subtitle_output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_output.write_text("\n".join(srt_lines))

    caption_inputs: list[Path] = []
    for index, (_, _, caption) in enumerate(srt_entries, start=1):
        svg_path = WORK / "captions" / f"caption-{index:02d}.svg"
        png_path = WORK / "captions" / f"caption-{index:02d}.png"
        svg_path.write_text(caption_svg(caption))
        run("node", str(ROOT / "scripts" / "render_svg.mjs"), str(svg_path), str(png_path))
        caption_inputs.append(png_path)

    ffmpeg_args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(joined_path)]
    for caption_path in caption_inputs:
        # Keep every caption image alive for the whole timeline. Without an
        # explicit loop, later overlay inputs can reach EOF before their
        # enable window and silently disappear from the rendered film.
        ffmpeg_args.extend(["-loop", "1", "-framerate", "1", "-i", str(caption_path)])
    filters: list[str] = ["[0:v]format=yuv420p[base]"]
    previous = "base"
    for index, (start, end, _) in enumerate(srt_entries, start=1):
        output_label = f"captioned{index}"
        filters.append(
            f"[{previous}][{index}:v]overlay=x=0:y=930:"
            f"enable='between(t,{start:.3f},{end:.3f})'[{output_label}]"
        )
        previous = output_label
    filters.append("[0:a]loudnorm=I=-16:TP=-1.5:LRA=8[audio]")
    ffmpeg_args.extend([
        "-filter_complex", ";".join(filters), "-map", f"[{previous}]", "-map", "[audio]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
        "-ar", "48000", "-t", f"{cursor:.3f}", "-movflags", "+faststart", str(output),
    ])
    run(*ffmpeg_args)

    final_duration = duration(output)
    if not MIN_FINAL_SECONDS <= final_duration <= MAX_FINAL_SECONDS:
        raise RuntimeError(
            f"Video duration is outside the {MIN_FINAL_SECONDS:.0f}–{MAX_FINAL_SECONDS:.0f} second launch window: {final_duration:.2f}s"
        )
    if output.stat().st_size >= 300 * 1024 * 1024:
        raise RuntimeError("Video exceeds 300 MB")

    probe = json.loads(capture(
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_name,width,height,sample_rate,channels:format=duration,size",
        "-of", "json", str(output),
    ))
    video_stream = next(stream for stream in probe["streams"] if stream.get("width"))
    audio_stream = next(stream for stream in probe["streams"] if stream.get("codec_name") == "aac")
    if (video_stream["codec_name"], video_stream["width"], video_stream["height"]) != ("h264", 1920, 1080):
        raise RuntimeError("Video codec or dimensions changed")
    if audio_stream.get("sample_rate") != "48000" or audio_stream.get("channels") != 2:
        raise RuntimeError("Audio must be 48 kHz stereo AAC")

    DIST_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output, DIST_OUTPUT)
    shutil.copy2(subtitle_output, DIST_SUBTITLE_OUTPUT)
    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"Built {output.relative_to(ROOT)}: {final_duration:.2f}s, {size_mb:.2f} MB, H.264/AAC 1920x1080")
    print("Scene durations: " + ", ".join(f"{value:.1f}s" for value in scene_durations))
    print("Voice: supplied licensed narration; copied to public/ and dist/")
    if not keep_work:
        shutil.rmtree(WORK)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-work", action="store_true", help="Retain rendered frames, audio, captions, and segments")
    parser.add_argument("--audio-dir", type=Path, help="Licensed human/ElevenLabs files named 01-hook.wav/mp3/... through 09-technical-handoff")
    parser.add_argument("--check", action="store_true", help="Validate claims, sources, audio filenames, and runtime without rendering")
    args = parser.parse_args()
    if args.check:
        structural_check(args.audio_dir)
        return
    build(args.keep_work, args.audio_dir)


if __name__ == "__main__":
    main()
