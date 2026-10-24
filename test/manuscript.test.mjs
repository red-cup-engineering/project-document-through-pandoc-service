import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planManuscriptProjection, reproducibilityHeader } from "../src/manuscript-plan.mjs";
import { projectManuscriptThroughPandoc } from "../src/manuscript-project.mjs";
import { observePandocToolchain, parsePandocVersion, parseTexEngineLine } from "../src/pandoc-toolchain.mjs";
import { niOf } from "../src/ports.mjs";

const request = {
  parts: ["manuscript/00-intro.md", "manuscript/01-results.md"],
  metadataFile: "manuscript/metadata.yaml",
  bibliography: "references.yaml",
  cslStyle: "styles/minimal.csl",
  formats: ["html", "docx", "pdf"],
  pdfEngine: "xelatex",
  sourceDateEpoch: 1700000000,
  numberSections: true,
  toc: true,
  resourcePaths: [".", "figures"],
};

test("plan: exact argv per output, relative to the root, in manuscript order", () => {
  const { ok, plan } = planManuscriptProjection(request);
  assert.equal(ok, true);
  assert.deepEqual(plan.env, { FORCE_SOURCE_DATE: "1", SOURCE_DATE_EPOCH: "1700000000", TZ: "UTC" });
  assert.deepEqual(plan.outputs.map((output) => output.path), ["build/manuscript.html", "build/manuscript.docx", "build/manuscript.pdf"]);
  assert.deepEqual(plan.outputs[0].argv, [
    "--from=markdown", "--standalone", "--metadata-file=manuscript/metadata.yaml", "--to=html5",
    "--number-sections", "--toc", "--resource-path=.:figures", "--bibliography=references.yaml", "--csl=styles/minimal.csl", "--citeproc",
    "--output=build/manuscript.html", "manuscript/00-intro.md", "manuscript/01-results.md",
  ]);
  assert.deepEqual(plan.outputs[2].argv.slice(3, 6), ["--to=pdf", "--pdf-engine=xelatex", "--include-in-header=build/.reproducibility-xelatex.tex"]);
  assert.equal(plan.supportFiles.length, 1);
  assert.equal(plan.supportFiles[0].content, reproducibilityHeader("xelatex"));
});

test("plan: deterministic and does not touch its input", () => {
  const frozen = structuredClone(request);
  assert.deepEqual(planManuscriptProjection(request), planManuscriptProjection(frozen));
  assert.deepEqual(request, frozen);
});

test("plan: options become flags", () => {
  const { plan } = planManuscriptProjection({ ...request, formats: ["jats", "epub"], toc: true, tocDepth: 2, citeproc: true, date: "source-date-epoch", variables: { lang: "en" }, jatsFlavor: "publishing", from: "markdown+smart" });
  const jats = plan.outputs[0].argv;
  assert.ok(jats.includes("--to=jats_publishing") && jats.includes("--toc-depth=2") && jats.includes("--metadata=date:2023-11-14") && jats.includes("--variable=lang:en") && jats.includes("--from=markdown+smart"));
  assert.ok(plan.outputs[1].argv.includes("--to=epub3"));
  assert.equal(plan.pdfEngine, undefined);
});

test("plan: refusals", () => {
  const reason = (change) => planManuscriptProjection({ ...request, ...change }).refusal?.reason;
  assert.equal(reason({ parts: [] }), "NoManuscriptParts");
  assert.equal(reason({ formats: [] }), "NoOutputFormats");
  assert.equal(reason({ formats: ["rtf"] }), "UnsupportedFormat");
  assert.equal(reason({ cslStyle: undefined }), "MissingStyle");
  assert.equal(reason({ bibliography: undefined }), "MissingBibliography");
  assert.equal(reason({ sourceDateEpoch: undefined }), "InvalidSourceDateEpoch");
  assert.equal(reason({ sourceDateEpoch: -1 }), "InvalidSourceDateEpoch");
  assert.equal(reason({ pdfEngine: "wkhtmltopdf" }), "UnsupportedPdfEngine");
  assert.equal(reason({ parts: ["../secret.md"] }), "PathEscapesRoot");
  assert.equal(reason({ parts: ["/etc/passwd"] }), "PathEscapesRoot");
  assert.equal(reason({ parts: ["--lua-filter=x.lua"] }), "PathEscapesRoot");
  assert.equal(reason({ referenceDoc: "ref.docx", formats: ["html"] }), "InvalidRequest");
  assert.equal(planManuscriptProjection(null).refusal.reason, "InvalidRequest");
});

test("plan: a missing part or style is refused when the existence port is supplied", () => {
  const present = new Set([...request.parts, request.metadataFile, request.bibliography, request.cslStyle]);
  assert.equal(planManuscriptProjection(request, { exists: (path) => present.has(path) }).ok, true);
  present.delete("manuscript/01-results.md");
  assert.equal(planManuscriptProjection(request, { exists: (path) => present.has(path) }).refusal.reason, "MissingPart");
  present.add("manuscript/01-results.md"); present.delete("styles/minimal.csl");
  assert.equal(planManuscriptProjection(request, { exists: (path) => present.has(path) }).refusal.reason, "MissingStyle");
});

test("ni addresses match the RFC 6920 sha-256 vectors", () => {
  assert.equal(niOf(new Uint8Array()), "ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  assert.equal(niOf(new TextEncoder().encode("abc")), `ni:///sha-256;${createHash("sha256").update("abc").digest("base64url")}`);
});

// ---- the execution port, with a fake pandoc ----

function fakeWorld({ failFormat, version = "pandoc 3.1.3" } = {}) {
  const files = new Map([
    ["manuscript/00-intro.md", "# Intro"], ["manuscript/01-results.md", "# Results"], ["manuscript/metadata.yaml", "title: T"],
    ["references.yaml", "references: []"], ["styles/minimal.csl", "<style/>"], ["figures/a.png", "PNG"],
  ].map(([path, text]) => [path, new TextEncoder().encode(text)]));
  const calls = [];
  let tick = 0;
  return {
    calls, files,
    ports: {
      exists: (path) => files.has(path) || path === "figures",
      readFile: (path) => files.get(path),
      writeFile: (path, bytes) => files.set(path, bytes),
      mkdir: () => {},
      readdir: (path) => (path === "figures" ? [{ name: "a.png", directory: false }] : []),
      now: () => new Date(Date.UTC(2026, 9, 24, 12, 0, tick++)),
      address: niOf,
      runPandoc: async ({ command, argv, env }) => {
        calls.push({ command, argv, env });
        if (argv[0] === "--version") return { status: 0, stdout: command === "pandoc" ? `${version}\nFeatures: +lua\n` : "XeTeX 3.141592653-2.6-0.999995 (TeX Live 2023/Debian)\n", stderr: "" };
        const output = argv.find((arg) => arg.startsWith("--output=")).slice("--output=".length);
        const format = argv.find((arg) => arg.startsWith("--to=")).slice(5);
        if (failFormat && format.startsWith(failFormat)) return { status: 64, stdout: "", stderr: "boom" };
        files.set(output, new TextEncoder().encode(`rendered ${format}`));
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  };
}

test("project: runs each argv, hashes inputs and outputs, and shapes a provenance fragment", async () => {
  const world = fakeWorld();
  const { plan } = planManuscriptProjection(request);
  const result = await projectManuscriptThroughPandoc(plan, world.ports);
  assert.equal(result.ok, true);
  const { receipt } = result;
  assert.equal(receipt.toolchain.pandoc.version, "3.1.3");
  assert.equal(receipt.toolchain.pdfEngine.texLive, "2023/Debian");
  assert.deepEqual(receipt.invocations.map((call) => call.format), ["html", "docx", "pdf"]);
  assert.deepEqual(receipt.invocations[0].argv, ["pandoc", ...plan.outputs[0].argv]);
  assert.deepEqual(receipt.invocations[0].env, plan.env);
  assert.ok(receipt.inputs.some((input) => input.role === "resource" && input.path === "figures/a.png"));
  assert.equal(receipt.inputs.find((input) => input.path === "manuscript/00-intro.md").ni, niOf(new TextEncoder().encode("# Intro")));
  assert.equal(receipt.outputs[0].ni, niOf(new TextEncoder().encode("rendered html5")));
  assert.equal(receipt.outputs[2].reproducibility, "byte-identical-with-pinned-toolchain");
  const { agents, activities, entities } = receipt.provenance;
  assert.deepEqual(agents.map((agent) => agent.id), ["pandoc", "xelatex"]);
  assert.equal(activities.length, 3);
  assert.deepEqual(activities[0].generated, ["build/manuscript.html"]);
  assert.ok(activities[2].used.includes("build/.reproducibility-xelatex.tex"));
  assert.ok(!activities[0].used.includes("build/.reproducibility-xelatex.tex"));
  const html = entities.find((entity) => entity.id === "build/manuscript.html");
  assert.ok(html.wasDerivedFrom.includes("manuscript/00-intro.md") && html.wasDerivedFrom.includes("styles/minimal.csl"));
  assert.equal(world.files.has("build/.reproducibility-xelatex.tex"), true);
});

test("project: a failing pandoc is a refusal that keeps the partial receipt", async () => {
  const world = fakeWorld({ failFormat: "docx" });
  const result = await projectManuscriptThroughPandoc(planManuscriptProjection(request).plan, world.ports);
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason, "PandocFailed");
  assert.match(result.refusal.message, /boom/u);
  assert.deepEqual(result.receipt.invocations.map((call) => call.status), [0, 64]);
});

test("project: pandoc version pin, missing input, and unplannable request are refused", async () => {
  const pinned = planManuscriptProjection({ ...request, requirePandocVersion: "3.9.0" }).plan;
  assert.equal((await projectManuscriptThroughPandoc(pinned, fakeWorld().ports)).refusal.reason, "PandocVersionMismatch");
  const world = fakeWorld();
  world.files.delete("styles/minimal.csl");
  assert.equal((await projectManuscriptThroughPandoc(planManuscriptProjection(request).plan, world.ports)).refusal.reason, "MissingStyle");
  assert.equal((await projectManuscriptThroughPandoc({ ...request, parts: [] }, fakeWorld().ports)).refusal.reason, "NoManuscriptParts");
});

test("project: a request is planned first", async () => {
  const result = await projectManuscriptThroughPandoc({ ...request, formats: ["html"] }, fakeWorld().ports);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.outputs.length, 1);
});

test("toolchain: versions are read from --version output; absence is a refusal", async () => {
  assert.equal(parsePandocVersion("pandoc 3.1.3"), "3.1.3");
  assert.equal(parsePandocVersion("pandoc.exe 2.19.2"), "2.19.2");
  assert.equal(parsePandocVersion("not pandoc"), undefined);
  assert.deepEqual(parseTexEngineLine("This is LuaHBTeX, Version 1.17.0 (TeX Live 2023/Debian)"), { versionLine: "This is LuaHBTeX, Version 1.17.0 (TeX Live 2023/Debian)", texLive: "2023/Debian", version: "1.17.0" });
  const observed = await observePandocToolchain({ pdfEngine: "xelatex" }, fakeWorld().ports);
  assert.equal(observed.pandoc.version, "3.1.3");
  assert.equal(observed.pdfEngine.name, "xelatex");
  const absent = await observePandocToolchain({}, { runPandoc: async () => ({ status: null, stdout: "", stderr: "", error: "spawn pandoc ENOENT" }) });
  assert.equal(absent.refusal.reason, "PandocNotFound");
  assert.equal((await observePandocToolchain({ pdfEngine: "word" })).refusal.reason, "UnsupportedPdfEngine");
});
