import { PDF_ENGINES } from "./manuscript-plan.mjs";
import { nodePorts } from "./ports.mjs";

const refuse = (reason, message) => Object.freeze({ ok: false, refusal: Object.freeze({ reason, message }) });

/** `pandoc 3.1.3` or `pandoc.exe 3.1.3` -> `3.1.3`. */
export function parsePandocVersion(firstLine) {
  return /^pandoc(?:\.exe)?\s+([0-9]+(?:\.[0-9]+)*)/u.exec(firstLine ?? "")?.[1];
}

/** Pick the TeX Live release out of `... (TeX Live 2023/Debian)` and the engine version if the line has one. */
export function parseTexEngineLine(line) {
  return {
    versionLine: line,
    ...(/\(TeX Live ([^)]+)\)/u.exec(line) ? { texLive: /\(TeX Live ([^)]+)\)/u.exec(line)[1] } : {}),
    ...(/(?:Version|pdfTeX|XeTeX)\s+([0-9][^\s(]*)/u.exec(line) ? { version: /(?:Version|pdfTeX|XeTeX)\s+([0-9][^\s(]*)/u.exec(line)[1] } : {}),
  };
}

/**
 * Observe the pandoc version and, when asked, a PDF engine's version line. Reads nothing but
 * the programs' own `--version` output.
 * @param {{pdfEngine?: string}} [request]
 * @param {{runPandoc?: Function}} [ports] `runPandoc({command, argv, env})` resolving `{status, stdout, stderr, error?}`.
 */
export async function observePandocToolchain(request = {}, ports = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) return refuse("InvalidRequest", "request must be an object");
  const { pdfEngine } = request;
  if (pdfEngine !== undefined && !PDF_ENGINES.includes(pdfEngine)) return refuse("UnsupportedPdfEngine", `pdfEngine must be one of ${PDF_ENGINES.join(", ")}`);
  const runPandoc = ports.runPandoc ?? nodePorts().runPandoc;
  const pandoc = await runPandoc({ command: "pandoc", argv: ["--version"], env: {} });
  if (pandoc.status !== 0) return refuse("PandocNotFound", `pandoc --version did not succeed (${pandoc.error ?? `status ${pandoc.status}`})`);
  const lines = pandoc.stdout.split("\n").map((line) => line.trimEnd());
  const version = parsePandocVersion(lines[0]);
  if (version === undefined) return refuse("PandocVersionUnreadable", `could not read a version from ${JSON.stringify(lines[0])}`);
  const features = lines.find((line) => line.startsWith("Features:"));
  const result = { ok: true, pandoc: { version, versionLine: lines[0], ...(features === undefined ? {} : { features: features.slice("Features:".length).trim() }) } };
  if (pdfEngine !== undefined) {
    const engine = await runPandoc({ command: pdfEngine, argv: ["--version"], env: {} });
    if (engine.status !== 0) return refuse("PdfEngineNotFound", `${pdfEngine} --version did not succeed (${engine.error ?? `status ${engine.status}`})`);
    result.pdfEngine = { name: pdfEngine, ...parseTexEngineLine(engine.stdout.split("\n")[0].trimEnd()) };
  }
  return Object.freeze(result);
}
