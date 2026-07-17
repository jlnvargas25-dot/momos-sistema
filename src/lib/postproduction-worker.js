import { createHash } from "node:crypto";

const clean = (value) => String(value ?? "").trim();
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const POSTPRODUCTION_LIMITS = Object.freeze({
  maxSourceBytes: 250 * 1024 * 1024,
  maxTotalSourceBytes: 750 * 1024 * 1024,
  maxDurationSeconds: 300,
  processTimeoutMs: 20 * 60 * 1000,
});

export function redactPostproductionError(error) {
  return clean(error?.message || error)
    .replace(/(?:sb_secret_|eyJ)[A-Za-z0-9._-]{12,}/gi, "[SECRETO]")
    .replace(/https?:\/\/[^\s"']+/gi, "[URL PRIVADA]")
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[RUTA LOCAL]")
    .slice(0, 600) || "Fallo de postproducción sin detalle.";
}

export function validSubtitleCues(cues) {
  return Array.isArray(cues) && cues.length > 0 && cues.every((cue) => {
    const start = finite(cue?.start_seconds, -1);
    const end = finite(cue?.end_seconds, -1);
    return start >= 0 && end > start && end <= POSTPRODUCTION_LIMITS.maxDurationSeconds && clean(cue?.text).length > 0 && clean(cue?.text).length <= 180;
  });
}

export function validatePostproductionClaim(claim = {}) {
  const job = claim.export;
  const snapshot = job?.snapshot;
  const spec = snapshot?.export_spec;
  const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
  const audioBinding = claim.audio_binding;
  const audio = audioBinding?.snapshot;
  const reasons = [];
  if (!job || !Number.isInteger(Number(job.id)) || Number(job.id) <= 0) reasons.push("Falta una exportación válida.");
  if (!/^[0-9a-f-]{36}$/i.test(clean(claim.lease_token))) reasons.push("Falta un lease válido.");
  if (!/^[0-9a-f]{32}$/i.test(clean(job?.fingerprint))) reasons.push("La huella del contrato no es válida.");
  if (!spec || spec.container !== "mp4" || spec.video_codec !== "h264" || spec.audio_codec !== "aac" || spec.color_space !== "bt709") reasons.push("El perfil sellado no es MP4/H.264/AAC/BT.709.");
  if (!Number.isInteger(Number(spec?.width)) || !Number.isInteger(Number(spec?.height))) reasons.push("Falta resolución exacta.");
  if (![24, 25, 30, 50, 60].includes(Number(spec?.fps))) reasons.push("Los FPS no están permitidos.");
  if (!sources.length) reasons.push("No hay tomas selladas.");
  for (const source of sources) {
    if (!Number.isInteger(Number(source.asset_id)) || !clean(source.storage_path) || !/^[0-9a-f]{64}$/i.test(clean(source.content_hash))) reasons.push("Una toma perdió identidad o integridad.");
    if (!/^video\/(mp4|quicktime|webm)$/.test(clean(source.mime_type))) reasons.push("Una toma no es un video permitido.");
    if (finite(source.size_bytes) <= 0 || finite(source.size_bytes) > POSTPRODUCTION_LIMITS.maxSourceBytes) reasons.push("Una toma supera el tamaño permitido.");
  }
  if (sources.reduce((sum, source) => sum + finite(source.size_bytes), 0) > POSTPRODUCTION_LIMITS.maxTotalSourceBytes) reasons.push("Las tomas superan el tamaño total permitido.");
  if (spec?.burn_subtitles === true && !validSubtitleCues(snapshot?.subtitle_plan?.cues)) reasons.push("Se pidieron subtítulos, pero no existen cues sellados y válidos.");
  if (!audioBinding || !/^[0-9a-f]{32}$/i.test(clean(audioBinding.fingerprint)) || !audio || !["Original", "Biblioteca"].includes(audio.mode)) {
    reasons.push("Falta un contrato de audio sellado.");
  } else if (audio.mode === "Biblioteca") {
    const asset = audio.asset || {};
    if (!Number.isInteger(Number(asset.id)) || !clean(asset.storage_path) || !/^[0-9a-f]{64}$/i.test(clean(asset.content_hash))
      || !/^audio\/(mpeg|mp4|wav)$/.test(clean(asset.mime_type)) || finite(asset.size_bytes) <= 0
      || finite(asset.size_bytes) > POSTPRODUCTION_LIMITS.maxSourceBytes || finite(asset.duration_seconds) <= 0) {
      reasons.push("La pista sellada perdió archivo, identidad o duración.");
    }
    if (finite(audio.mix?.soundtrack_gain_db, 999) < -30 || finite(audio.mix?.soundtrack_gain_db, 999) > 0 || audio.mix?.loop !== true) reasons.push("La mezcla sellada de la pista no está permitida.");
  }
  return { valid: reasons.length === 0, reasons };
}

function srtTime(seconds) {
  const millis = Math.max(0, Math.round(finite(seconds) * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis % 1000).padStart(3, "0")}`;
}

export function subtitleCuesToSrt(cues = []) {
  if (!validSubtitleCues(cues)) throw new Error("Los cues de subtítulos no son válidos.");
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start_seconds)} --> ${srtTime(cue.end_seconds)}\n${clean(cue.text).replace(/[\r\n]+/g, " ")}\n`).join("\n");
}

export function rationalToNumber(value) {
  const raw = clean(value);
  if (!raw.includes("/")) return finite(raw);
  const [numerator, denominator] = raw.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

export function inspectProbe(probe = {}, { loudnessLufs = null, sizeBytes = 0 } = {}) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video") || {};
  const audio = streams.find((stream) => stream.codec_type === "audio") || {};
  return {
    width: Math.round(finite(video.width)),
    height: Math.round(finite(video.height)),
    fps: Math.round(rationalToNumber(video.avg_frame_rate || video.r_frame_rate)),
    video_codec: clean(video.codec_name).toLowerCase(),
    audio_codec: clean(audio.codec_name).toLowerCase(),
    color_space: [video.color_space, video.color_primaries, video.color_transfer].some((value) => /bt709/i.test(clean(value))) ? "bt709" : clean(video.color_space).toLowerCase(),
    duration_seconds: finite(probe.format?.duration || video.duration || audio.duration),
    loudness_lufs: Number(finite(loudnessLufs).toFixed(2)),
    size_bytes: Math.round(finite(sizeBytes || probe.format?.size)),
  };
}

export function parseLoudnorm(stderr = "") {
  const matches = [...String(stderr).matchAll(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)];
  for (const match of matches.reverse()) {
    try {
      const loudness = Number(JSON.parse(match[0]).input_i);
      if (Number.isFinite(loudness)) return loudness;
    } catch { /* probar el bloque anterior */ }
  }
  throw new Error("FFmpeg no devolvió una medición LUFS válida.");
}

export function outputStoragePath(exportId, hash) {
  const id = Number(exportId);
  const digest = clean(hash).toLowerCase();
  if (!Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{64}$/.test(digest)) throw new Error("Identidad de salida inválida.");
  return `exports/${id}/${digest}.mp4`;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizationArgs({ inputPath, outputPath, spec, hasAudio, durationSeconds, subtitlePath = "" }) {
  const width = Number(spec.width);
  const height = Number(spec.height);
  const fps = Number(spec.fps);
  const filters = [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`, `fps=${fps}`, "setsar=1", "format=yuv420p"];
  if (subtitlePath) filters.push(`subtitles='${clean(subtitlePath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}'`);
  const args = ["-hide_banner", "-nostdin", "-y", "-i", inputPath];
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push("-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0", "-vf", filters.join(","), "-af", hasAudio ? "aresample=48000" : "volume=0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  if (!hasAudio) args.push("-t", String(finite(durationSeconds)));
  args.push("-movflags", "+faststart", "-shortest", outputPath);
  return args;
}

export function finalizationArgs({ inputPath, outputPath, audioBinding, soundtrackPath = "", subtitlePath = "" }) {
  const audio = audioBinding?.snapshot || {};
  const args = ["-hide_banner", "-nostdin", "-y", "-i", inputPath];
  if (soundtrackPath) args.push("-stream_loop", "-1", "-i", soundtrackPath);
  if (subtitlePath) {
    const filterPath = clean(subtitlePath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    args.push("-vf", `subtitles='${filterPath}'`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv");
  } else args.push("-c:v", "copy");
  args.push("-map", "0:v:0");
  if (soundtrackPath) {
    const originalGain = finite(audio.mix?.original_gain_db);
    const soundtrackGain = finite(audio.mix?.soundtrack_gain_db, -14);
    args.push("-filter_complex", `[0:a:0]volume=${originalGain}dB[original];[1:a:0]volume=${soundtrackGain}dB[music];[original][music]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:TP=-1.5:LRA=11[audio]`, "-map", "[audio]");
  } else args.push("-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11");
  args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", outputPath);
  return args;
}

export function assertMasterMatchesSpec(probe = {}, spec = {}) {
  const reasons = [];
  for (const field of ["width", "height", "fps"]) if (Number(probe[field]) !== Number(spec[field])) reasons.push(`${field} no coincide.`);
  if (probe.video_codec !== "h264") reasons.push("El video no es H.264.");
  if (probe.audio_codec !== "aac") reasons.push("El audio no es AAC.");
  if (probe.color_space !== "bt709") reasons.push("El color no es BT.709.");
  if (!(probe.duration_seconds > 0 && probe.duration_seconds <= POSTPRODUCTION_LIMITS.maxDurationSeconds)) reasons.push("La duración no está permitida.");
  if (!(probe.loudness_lufs >= -24 && probe.loudness_lufs <= -9)) reasons.push("La sonoridad no está entre -24 y -9 LUFS.");
  if (!(probe.size_bytes > 0 && probe.size_bytes <= Number(spec.max_size_bytes))) reasons.push("El tamaño supera el contrato.");
  if (reasons.length) throw new Error(`El máster no cumple el contrato: ${reasons.join(" ")}`);
  return true;
}
