import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMasterMatchesSpec,
  inspectProbe,
  normalizationArgs,
  outputStoragePath,
  parseLoudnorm,
  rationalToNumber,
  redactPostproductionError,
  subtitleCuesToSrt,
  validatePostproductionClaim,
} from "./postproduction-worker.js";

const spec = { width: 1080, height: 1920, fps: 30, container: "mp4", video_codec: "h264", audio_codec: "aac", color_space: "bt709", max_size_bytes: 100_000_000, burn_subtitles: false };
const claim = { lease_token: "11111111-1111-4111-8111-111111111111", export: { id: 7, fingerprint: "a".repeat(32), snapshot: { export_spec: spec, sources: [{ asset_id: 1, storage_path: "generated/x.mp4", content_hash: "b".repeat(64), mime_type: "video/mp4", size_bytes: 1200 }] } } };

test("valida contrato sellado y cierra subtítulos sin cues", () => {
  assert.equal(validatePostproductionClaim(claim).valid, true);
  const unsafe = structuredClone(claim);
  unsafe.export.snapshot.export_spec.burn_subtitles = true;
  assert.equal(validatePostproductionClaim(unsafe).valid, false);
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
