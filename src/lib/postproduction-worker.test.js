import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMasterMatchesSpec,
  inspectProbe,
  finalizationArgs,
  normalizationArgs,
  outputStoragePath,
  parseLoudnorm,
  rationalToNumber,
  redactPostproductionError,
  subtitleCuesToSrt,
  validatePostproductionClaim,
} from "./postproduction-worker.js";

const spec = { width: 1080, height: 1920, fps: 30, container: "mp4", video_codec: "h264", audio_codec: "aac", color_space: "bt709", max_size_bytes: 100_000_000, burn_subtitles: false };
const claim = { lease_token: "11111111-1111-4111-8111-111111111111", audio_binding: { fingerprint: "c".repeat(32), snapshot: { mode: "Original", requires_source_audio: true } }, export: { id: 7, fingerprint: "a".repeat(32), snapshot: { export_spec: spec, sources: [{ asset_id: 1, storage_path: "generated/x.mp4", content_hash: "b".repeat(64), mime_type: "video/mp4", size_bytes: 1200 }] } } };

test("valida contrato sellado y cierra subtítulos sin cues", () => {
  assert.equal(validatePostproductionClaim(claim).valid, true);
  const unsafe = structuredClone(claim);
  unsafe.export.snapshot.export_spec.burn_subtitles = true;
  assert.equal(validatePostproductionClaim(unsafe).valid, false);
});

test("acepta una pista de Biblioteca solo con identidad, mezcla y archivo sellados", () => {
  const library = structuredClone(claim);
  library.audio_binding.snapshot = { mode: "Biblioteca", asset: { id: 9, storage_path: "audio/pista.mp3", content_hash: "d".repeat(64), mime_type: "audio/mpeg", size_bytes: 4096, duration_seconds: 30 }, mix: { soundtrack_gain_db: -14, loop: true } };
  assert.equal(validatePostproductionClaim(library).valid, true);
  library.audio_binding.snapshot.asset.content_hash = "declarado";
  assert.equal(validatePostproductionClaim(library).valid, false);
});

test("convierte cues sellados a SRT", () => {
  const srt = subtitleCuesToSrt([{ start_seconds: 0, end_seconds: 1.25, text: "MOMOS\nlistos" }]);
  assert.match(srt, /00:00:00,000 --> 00:00:01,250/);
  assert.match(srt, /MOMOS listos/);
});

test("construye argumentos sin shell y agrega audio silencioso", () => {
  const args = normalizationArgs({ inputPath: "in.mp4", outputPath: "out.mp4", spec, hasAudio: false, durationSeconds: 4 });
  assert.deepEqual(args.slice(0, 5), ["-hide_banner", "-nostdin", "-y", "-i", "in.mp4"]);
  assert.ok(args.includes("anullsrc=channel_layout=stereo:sample_rate=48000"));
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("bt709"));
});

test("mezcla una pista sellada y normaliza el master sin publicar", () => {
  const args = finalizationArgs({
    inputPath: "concat.mp4", outputPath: "master.mp4", soundtrackPath: "music.wav",
    audioBinding: { snapshot: { mode: "Biblioteca", mix: { original_gain_db: 0, soundtrack_gain_db: -14, loop: true } } },
  });
  assert.deepEqual(args.slice(0, 9), ["-hide_banner", "-nostdin", "-y", "-i", "concat.mp4", "-stream_loop", "-1", "-i", "music.wav"]);
  assert.match(args[args.indexOf("-filter_complex") + 1], /volume=-14dB.*amix=inputs=2.*loudnorm=I=-14/);
  assert.ok(args.includes("[audio]"));
  assert.equal(args.at(-1), "master.mp4");
});

test("interpreta probe, fps racional y LUFS", () => {
  assert.equal(rationalToNumber("30000/1000"), 30);
  const probe = inspectProbe({ streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1", color_space: "bt709" }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "5.2", size: "9000" } }, { loudnessLufs: -14 });
  assert.equal(probe.audio_codec, "aac");
  assert.equal(assertMasterMatchesSpec(probe, spec), true);
  assert.equal(parseLoudnorm('x {"input_i":"-14.20","input_tp":"-1.0"} y'), -14.2);
});

test("protege ruta, huella y mensajes", () => {
  assert.equal(outputStoragePath(9, "c".repeat(64)), `exports/9/${"c".repeat(64)}.mp4`);
  assert.throws(() => outputStoragePath(0, "x"));
  const redacted = redactPostproductionError(new Error("https://private.test/a sb_secret_abcdefghijklmnop C:\\temp\\master.mp4"));
  assert.doesNotMatch(redacted, /private\.test|sb_secret|C:\\temp/);
});
