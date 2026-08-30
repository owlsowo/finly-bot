#!/usr/bin/env python3
"""Build Finly's claim-locked, captioned judge film.

The film narrates the final consulting deck. It accepts human or ElevenLabs
scene audio through --audio-dir; otherwise it uses a free neural voice. The
builder never reads credentials, calls a broker, or treats the film as market
evidence.
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

VOICE = "en-US-AndrewMultilingualNeural"
VOICE_RATE = "-5%"
VOICE_PITCH = "-2Hz"

INK = "#152630"
WHITE = "#ffffff"


@dataclass(frozen=True)
class Scene:
    slug: str
    slide: int
    narration: str


SCENES = [
    Scene(
        "hook",
        1,
        "Finly found a 967.11 percent consumed return and refused to trade it. That sentence is the product in miniature: a trading agent should be judged not only by what it finds, but by what it is willing to reject.",
    ),
    Scene(
        "tempting-result",
        2,
        "In the consumed replay from January second, twenty thirteen through August twenty-seventh, twenty twenty-six, G four returned 967.11 percent, versus 580.82 percent for S P Y, after modeled five-basis-point one-way costs. The result was tempting. It was also selected after the history was visible.",
    ),
    Scene(
        "rejection",
        3,
        "Finly denied promotion. The Deflated Sharpe probability was 3.75 percent, and the worst familywise-adjusted p-value was 37.18 percent. The chart remains visible, but it never received authority and cannot support a forecast.",
    ),
    Scene(
        "production",
        4,
        "Production version one is the deliberately boring answer. In the consumed next-open study, it returned 15.39 percent at five basis points per traded leg, and 10.56 percent at twenty-five basis points. S P Y returned 33.52 percent. At five basis points, Finly's annualized volatility was 8.12 percent and maximum drawdown was minus 5.45 percent. It was positive and risk-controlled. It did not beat S P Y.",
    ),
    Scene(
        "authority",
        5,
        "That restraint is architectural. The model may interpret bounded evidence, explain uncertainty, or veto. Deterministic code owns exposure, order fields, maximum loss, and the final permit decision. A disagreement returns no trade; the model never writes the Alpaca payload.",
    ),
    Scene(
        "product",
        6,
        "The interface keeps those evidence classes visible. Judges can inspect a positive production ledger, a rejected retrospective strategy, and two zero-outcome future tests on the same page. Finly does not hide the hard sentence in a footnote.",
    ),
    Scene(
        "proof-ladder",
        7,
        "Claims move from past to future only through a new test. A larger backtest never upgrades its own evidence class, and a prettier chart does not create authority.",
    ),
    Scene(
        "future-tests",
        8,
        "Attempts 115 and 116 are publicly registered future-only tests. As of August thirtieth, twenty twenty-six, each has zero observed outcomes; neither supports a performance claim. Registration makes the next claim falsifiable. It does not manufacture a result.",
    ),
    Scene(
        "close",
        9,
        "That is Finly: publish the tempting result, reject what has not earned authority, and make the next claim falsifiable. Let A I interpret more and authorize less. The bull has horns; the llama still does not get the keys.",
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
        "S P Y": "SPY",
        "G four": "G4",
        "A I": "AI",
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
    expected_g4 = {
        "g4_total_return": 9.6710597833,
        "spy_total_return": 5.8081746189,
        "deflated_sharpe_probability": 0.037478432287,
        "worst_familywise_adjusted_p_value": 0.371814092954,
    }
    for key, value in expected_g4.items():
        if not math.isclose(g4[key], value, abs_tol=1e-10):
            raise RuntimeError(f"G4 gate changed: {key}")
    if g4["disposition"] != "REJECTED_NOT_PROMOTED":
        raise RuntimeError("G4 disposition changed")

    v1 = gate["conclusions"]["production_v1_execution_realism"]
    expected_v1 = {
        "total_return_at_5bp_per_leg": 0.1538759778,
        "total_return_at_25bp_per_leg": 0.1055891073,
        "spy_total_return": 0.3352366407,
        "annualized_volatility_at_5bp": 0.0812194739,
        "maximum_drawdown_at_5bp": -0.0544710489,
    }
    for key, value in expected_v1.items():
        if not math.isclose(v1[key], value, abs_tol=1e-10):
            raise RuntimeError(f"Production-v1 gate changed: {key}")
    if v1["market_beating_on_total_return"] is not False or v1["broker_fill_replay"] is not False:
        raise RuntimeError("Production-v1 boundary changed")

    future = gate["conclusions"]["registered_future_only_tests"]
    if [item["attempt_number"] for item in future] != [115, 116]:
        raise RuntimeError("Future-only attempt identities changed")
    if any(item["observed_outcome_count"] != 0 or item["performance_claim_authorized"] is not False for item in future):
        raise RuntimeError("Future-only outcome boundary changed")

    narration = " ".join(scene.narration for scene in SCENES)
    required = [
        "967.11 percent", "580.82 percent", "3.75 percent", "37.18 percent",
        "15.39 percent", "10.56 percent", "33.52 percent",
        "Attempts 115 and 116", "zero observed outcomes",
        "llama still does not get the keys",
    ]
    for phrase in required:
        if phrase.lower() not in narration.lower():
            raise RuntimeError(f"Narration is missing required release-gated phrase: {phrase}")


def supplied_audio(audio_dir: Path, index: int, scene: Scene) -> Path:
    stem = f"{index:02d}-{scene.slug}"
    candidates = [audio_dir / f"{stem}{suffix}" for suffix in (".wav", ".mp3", ".m4a", ".flac")]
    found = [path for path in candidates if path.is_file()]
    if len(found) != 1:
        raise RuntimeError(f"Expected exactly one supplied narration file for {stem}; found {len(found)}")
    return found[0]


def render_deck_frames() -> list[Path]:
    if not DECK_PDF.is_file():
        raise RuntimeError("Build public/judge/Finly_Consulting_Deck.pdf before the film")
    prefix = WORK / "frames" / "slide"
    run("pdftoppm", "-png", "-r", "150", str(DECK_PDF), str(prefix))
    frames = sorted((WORK / "frames").glob("slide-*.png"))
    if len(frames) != 9:
        raise RuntimeError(f"Expected nine rendered deck slides; found {len(frames)}")
    return frames


def build(keep_work: bool, audio_dir: Path | None, voice: str) -> None:
    verify_claims()
    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "frames").mkdir(parents=True)
    (WORK / "audio").mkdir()
    (WORK / "segments").mkdir()
    (WORK / "captions").mkdir()

    frames = render_deck_frames()
    tts = ROOT / ".venv-media" / "bin" / "edge-tts"
    if audio_dir is not None:
        audio_dir = audio_dir.expanduser().resolve()
        if not audio_dir.is_dir():
            raise RuntimeError(f"Supplied narration directory does not exist: {audio_dir}")
    elif not tts.exists():
        raise RuntimeError("Provide --audio-dir or install the pinned free neural voice in .venv-media")

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
        generated_audio = WORK / "audio" / f"{index:02d}-{scene.slug}.mp3"
        audio_path = WORK / "audio" / f"{index:02d}-{scene.slug}.wav"
        segment_path = WORK / "segments" / f"{index:02d}-{scene.slug}.mp4"
        frame_path = frames[scene.slide - 1]

        if audio_dir is not None:
            raw_audio = supplied_audio(audio_dir, index, scene)
        else:
            raw_audio = generated_audio
            run(
                str(tts), "--voice", voice, "--rate", VOICE_RATE,
                "--pitch", VOICE_PITCH, "--text", scene.narration,
                "--write-media", str(raw_audio),
            )

        raw_duration = duration(raw_audio)
        pause = 0.32 if index < len(SCENES) else 0.80
        scene_duration = raw_duration + pause
        run(
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw_audio),
            "-af", f"apad=pad_dur={pause}", "-t", f"{scene_duration:.3f}",
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
    SUBTITLE_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    SUBTITLE_OUTPUT.write_text("\n".join(srt_lines))

    caption_inputs: list[Path] = []
    for index, (_, _, caption) in enumerate(srt_entries, start=1):
        svg_path = WORK / "captions" / f"caption-{index:02d}.svg"
        png_path = WORK / "captions" / f"caption-{index:02d}.png"
        svg_path.write_text(caption_svg(caption))
        run("node", str(ROOT / "scripts" / "render_svg.mjs"), str(svg_path), str(png_path))
        caption_inputs.append(png_path)

    ffmpeg_args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(joined_path)]
    for caption_path in caption_inputs:
        ffmpeg_args.extend(["-i", str(caption_path)])
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
        "-ar", "48000", "-movflags", "+faststart", str(OUTPUT),
    ])
    run(*ffmpeg_args)

    final_duration = duration(OUTPUT)
    if not 60 < final_duration <= 300:
        raise RuntimeError(f"Video duration is outside the one-to-five-minute window: {final_duration:.2f}s")
    if OUTPUT.stat().st_size >= 300 * 1024 * 1024:
        raise RuntimeError("Video exceeds 300 MB")

    probe = json.loads(capture(
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_name,width,height,sample_rate,channels:format=duration,size",
        "-of", "json", str(OUTPUT),
    ))
    video_stream = next(stream for stream in probe["streams"] if stream.get("width"))
    audio_stream = next(stream for stream in probe["streams"] if stream.get("codec_name") == "aac")
    if (video_stream["codec_name"], video_stream["width"], video_stream["height"]) != ("h264", 1920, 1080):
        raise RuntimeError("Video codec or dimensions changed")
    if audio_stream.get("sample_rate") != "48000" or audio_stream.get("channels") != 2:
        raise RuntimeError("Audio must be 48 kHz stereo AAC")

    DIST_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUTPUT, DIST_OUTPUT)
    shutil.copy2(SUBTITLE_OUTPUT, DIST_SUBTITLE_OUTPUT)
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Built {OUTPUT.relative_to(ROOT)}: {final_duration:.2f}s, {size_mb:.2f} MB, H.264/AAC 1920x1080")
    print("Scene durations: " + ", ".join(f"{value:.1f}s" for value in scene_durations))
    print(f"Voice: supplied audio" if audio_dir is not None else f"Voice: {voice} at {VOICE_RATE}, pitch {VOICE_PITCH}")
    if not keep_work:
        shutil.rmtree(WORK)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-work", action="store_true", help="Retain rendered frames, audio, captions, and segments")
    parser.add_argument("--audio-dir", type=Path, help="Directory with one 01-slug.wav/mp3/... file per scene")
    parser.add_argument("--voice", default=VOICE, help="Edge neural voice used when --audio-dir is omitted")
    args = parser.parse_args()
    build(args.keep_work, args.audio_dir, args.voice)


if __name__ == "__main__":
    main()
