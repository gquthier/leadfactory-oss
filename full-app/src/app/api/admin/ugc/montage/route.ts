import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";

const execFileAsync = promisify(execFile);

const SEGMENTS_DEFAULT = [
  {start:0,end:4,text:"VOTRE ACCROCHE"},
  {start:4,end:8,text:"LE PROBLÈME CLIENT"},
  {start:8,end:12,text:"VOTRE SOLUTION"},
  {start:12,end:16,text:"PREUVE AUTORISÉE"},
  {start:16,end:20,text:"APPEL À L’ACTION"},
];

async function runPythonCaptions(inputPath: string, outputPath: string, segments: typeof SEGMENTS_DEFAULT): Promise<void> {
  const scriptContent = `
import sys
from PIL import Image, ImageDraw, ImageFont
import subprocess
import os
import json
import tempfile

INPUT_VIDEO = ${JSON.stringify(inputPath)}
OUTPUT_VIDEO = ${JSON.stringify(outputPath)}
SEGMENTS = ${JSON.stringify(segments)}

def get_video_dimensions(video_path):
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', video_path],
        capture_output=True, text=True
    )
    import json as j
    data = j.loads(result.stdout)
    for s in data['streams']:
        if s.get('codec_type') == 'video':
            return s['width'], s['height']
    return 1080, 1920

W, H = get_video_dimensions(INPUT_VIDEO)

font_path = '/System/Library/Fonts/Supplemental/Impact.ttf'
if not os.path.exists(font_path):
    font_path = '/System/Library/Fonts/Helvetica.ttc'

tmp_dir = tempfile.mkdtemp()
frames = []

for i, seg in enumerate(SEGMENTS):
    lines = seg['text'].split('\\n')
    frame_path = os.path.join(tmp_dir, f'caption_{i}.png')

    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    font_size = int(H * 0.065)
    try:
        font = ImageFont.truetype(font_path, font_size)
    except:
        font = ImageFont.load_default()

    line_height = font_size + 10
    total_height = len(lines) * line_height
    y_start = int(H * 0.72) - total_height // 2

    for j, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (W - tw) // 2
        y = y_start + j * line_height
        # outline
        for dx, dy in [(-3,0),(3,0),(0,-3),(0,3),(-2,-2),(2,-2),(-2,2),(2,2)]:
            draw.text((x+dx, y+dy), line, font=font, fill=(0, 0, 0, 255))
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))

    img.save(frame_path)
    frames.append({'path': frame_path, 'start': seg['start'], 'end': seg['end']})

filter_lines = []
n = len(frames)
for i, f in enumerate(frames):
    filter_lines.append(f"[0:v][{i+1}:v] overlay=0:0:enable='between(t,{f['start']},{f['end']})' [v{i}]")

filter_content = ''
prev = '[0:v]'
for i, f in enumerate(frames):
    out = f'[v{i}]' if i < n - 1 else '[vout]'
    filter_content += f"{prev}[{i+1}:v] overlay=0:0:enable='between(t,{f['start']},{f['end']})' {out};\\n"
    prev = f'[v{i}]'

filter_file = os.path.join(tmp_dir, 'filter.txt')
filter_str = ''
prev_label = '[0:v]'
for i, f in enumerate(frames):
    next_label = '[vout]' if i == n - 1 else f'[tmp{i}]'
    filter_str += f"{prev_label}[{i+1}:v] overlay=0:0:enable='between(t,{f['start']},{f['end']})' {next_label};\\n"
    prev_label = next_label if i < n - 1 else '[vout]'

with open(filter_file, 'w') as fh:
    fh.write(filter_str.rstrip(';\\n'))

cmd = ['ffmpeg', '-y', '-i', INPUT_VIDEO]
for f in frames:
    cmd += ['-i', f['path']]
cmd += ['-filter_complex_script', filter_file, '-map', '[vout]', '-map', '0:a', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'fast', OUTPUT_VIDEO]

subprocess.run(cmd, check=True, capture_output=True)
print(f'Done: {OUTPUT_VIDEO}')

import shutil
shutil.rmtree(tmp_dir)
`;

  const scriptPath = join(tmpdir(), `montage_captions_${Date.now()}.py`);
  await writeFile(scriptPath, scriptContent);

  try {
    await execFileAsync("uv", ["run", "--with", "pillow", "python3", scriptPath], {
      timeout: 120000,
    });
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}

type Segment = { start: number; end: number; text: string };

function sanitizeSegments(input: unknown): Segment[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length === 0 || input.length > 50) return null;
  const out: Segment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const start = Number(r.start);
    const end = Number(r.end);
    const text = typeof r.text === "string" ? r.text : null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || end < 0 || end <= start || end > 600) return null;
    if (!text || text.length > 500) return null;
    out.push({ start, end, text });
  }
  return out;
}

async function assertAdmin(): Promise<NextResponse | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const denied = await assertAdmin();
  if (denied) return denied;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { segments: rawSegments } = (body ?? {}) as { segments?: unknown };

  let segments = SEGMENTS_DEFAULT;
  if (rawSegments !== undefined) {
    const sanitized = sanitizeSegments(rawSegments);
    if (!sanitized) {
      return NextResponse.json({ error: "segments invalides" }, { status: 400 });
    }
    segments = sanitized;
  }

  // Input path is server-determined — never trust client-supplied paths
  // (ffmpeg -i would happily read arbitrary local files / URLs).
  const inputPath = join(homedir(), "Desktop/ugc-montage/output/final-captions.mp4");
  const outputDir = join(homedir(), "Desktop/ugc-montage/output");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `montage-web-${Date.now()}.mp4`);

  try {
    await runPythonCaptions(inputPath, outputPath, segments);

    // Read the output file and return as base64 URL for preview
    const videoBuffer = await readFile(outputPath);
    const base64 = videoBuffer.toString("base64");

    return NextResponse.json({
      success: true,
      outputPath,
      videoData: `data:video/mp4;base64,${base64}`,
      size: videoBuffer.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const denied = await assertAdmin();
  if (denied) return denied;

  // Return info about latest montage
  const outputDir = join(homedir(), "Desktop/ugc-montage/output");
  try {
    const { readdir, stat } = await import("fs/promises");
    const files = await readdir(outputDir);
    const mp4s = files.filter(f => f.endsWith(".mp4"));
    const withStats = await Promise.all(
      mp4s.map(async f => {
        const s = await stat(join(outputDir, f));
        return { name: f, size: s.size, mtime: s.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    return NextResponse.json({ files: withStats.slice(0, 5) });
  } catch {
    return NextResponse.json({ files: [] });
  }
}
