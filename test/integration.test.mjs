// Integration tests that run the real pandoc. They are skipped, with a message, when pandoc is not on PATH.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectManuscriptThroughPandoc } from "../src/manuscript-project.mjs";
import { observePandocToolchain } from "../src/pandoc-toolchain.mjs";

const probe = spawnSync("pandoc", ["--version"], { encoding: "utf8" });
const havePandoc = probe.status === 0;
const SKIP = havePandoc ? false : "pandoc is not on PATH: install pandoc >= 3.1 to run the real-pandoc integration tests";
const version = havePandoc ? /^pandoc(?:\.exe)? (\S+)/u.exec(probe.stdout)?.[1] : undefined;
if (!havePandoc) console.log(`# SKIPPED real-pandoc integration tests: ${SKIP}`);
else console.log(`# real-pandoc integration tests run against pandoc ${version}`);

const fixture = fileURLToPath(new URL("./fixtures/manuscript", import.meta.url));
const request = (root, extra = {}) => ({
  rootDir: root,
  parts: ["manuscript/00-intro.md", "manuscript/01-results.md"],
  metadataFile: "manuscript/metadata.yaml",
  bibliography: "references.yaml",
  cslStyle: "styles/minimal.csl",
  formats: ["html", "docx"],
  sourceDateEpoch: 1700000000,
  ...extra,
});

function withManuscript(fn) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "manuscript-"));
    try {
      cpSync(fixture, root, { recursive: true });
      await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("real pandoc: observePandocToolchain reads the installed version", { skip: SKIP }, async () => {
  const observed = await observePandocToolchain({});
  assert.equal(observed.ok, true);
  assert.equal(observed.pandoc.version, version);
});

test("real pandoc: HTML and DOCX are rendered with both citations and the bibliography resolved", { skip: SKIP }, withManuscript(async (root) => {
  const result = await projectManuscriptThroughPandoc(request(root, { numberSections: true }));
  assert.equal(result.ok, true, JSON.stringify(result.refusal));
  const { receipt } = result;
  assert.equal(receipt.toolchain.pandoc.version, version);
  assert.deepEqual(receipt.outputs.map((output) => output.format), ["html", "docx"]);

  const html = readFileSync(join(root, "build/manuscript.html"), "utf8");
  assert.match(html, /data-cites="smith2020"[^>]*>Smith \(2020\)</u);
  assert.match(html, /\(Jones 2021, p\. 4\)/u);
  assert.match(html, /id="ref-smith2020"/u);
  assert.match(html, /Corneal Tissue Handbook/u);
  assert.doesNotMatch(html, /\?smith2020|\?jones2021/u);

  const docx = spawnSync("pandoc", ["--from=docx", "--to=plain", "build/manuscript.docx"], { cwd: root, encoding: "utf8" });
  assert.equal(docx.status, 0, docx.stderr);
  const text = docx.stdout.replace(/\s+/gu, " ");
  assert.match(text, /Smith \(2020\)/u);
  assert.match(text, /\(Jones 2021, p\. 4\)/u);
  assert.match(text, /On Lenticules/u);
  assert.doesNotMatch(text, /@smith2020/u);
}));

test("real pandoc: the receipt's ni addresses are the sha-256 of the bytes on disk", { skip: SKIP }, withManuscript(async (root) => {
  const { receipt } = await projectManuscriptThroughPandoc(request(root, { formats: ["html"] }));
  const check = spawnSync(process.execPath, ["-e", `
    const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs");
    const ni = (path) => "ni:///sha-256;" + createHash("sha256").update(readFileSync(path)).digest("base64url");
    const receipt = JSON.parse(process.argv[1]);
    for (const item of [...receipt.inputs, ...receipt.outputs, ...receipt.supportFiles]) if (ni(item.path) !== item.ni) { console.log("MISMATCH " + item.path); process.exit(1); }
    console.log("ok");
  `, JSON.stringify(receipt)], { cwd: root, encoding: "utf8" });
  assert.equal(check.stdout.trim(), "ok", check.stdout + check.stderr);
}));

test("real pandoc: HTML, DOCX and JATS are byte-identical across runs under SOURCE_DATE_EPOCH", { skip: SKIP }, withManuscript(async (root) => {
  const first = await projectManuscriptThroughPandoc(request(root, { formats: ["html", "docx", "jats"], outputDir: "build-a" }));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = await projectManuscriptThroughPandoc(request(root, { formats: ["html", "docx", "jats"], outputDir: "build-b" }));
  assert.equal(first.ok && second.ok, true, JSON.stringify(first.refusal ?? second.refusal));
  for (const [index, format] of ["html", "docx", "jats"].entries()) {
    assert.equal(first.receipt.outputs[index].ni, second.receipt.outputs[index].ni, `${format} differs between runs`);
  }
}));

test("real pandoc: a different SOURCE_DATE_EPOCH changes the DOCX (the epoch is really stamped)", { skip: SKIP }, withManuscript(async (root) => {
  const one = await projectManuscriptThroughPandoc(request(root, { formats: ["docx"], outputDir: "build-a" }));
  const two = await projectManuscriptThroughPandoc(request(root, { formats: ["docx"], outputDir: "build-b", sourceDateEpoch: 1700086400 }));
  assert.notEqual(one.receipt.outputs[0].ni, two.receipt.outputs[0].ni);
}));

test("real pandoc: a manuscript whose citation key is missing from the bibliography still renders but is reported unresolved", { skip: SKIP }, withManuscript(async (root) => {
  const bad = spawnSync("sh", ["-c", "printf 'See [@nobody1999].\\n' > manuscript/00-intro.md"], { cwd: root });
  assert.equal(bad.status, 0);
  const result = await projectManuscriptThroughPandoc(request(root, { formats: ["html"] }));
  assert.equal(result.ok, true);
  assert.match(readFileSync(join(root, "build/manuscript.html"), "utf8"), /nobody1999/u);
}));

const haveEngine = (engine) => spawnSync(engine, ["--version"]).status === 0;

test("real pandoc: EPUB is byte-identical across runs when the metadata names an identifier", { skip: SKIP }, withManuscript(async (root) => {
  const options = { formats: ["epub"], metadata: { identifier: "urn:isbn:9780000000002" } };
  const first = await projectManuscriptThroughPandoc(request(root, { ...options, outputDir: "build-a" }));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = await projectManuscriptThroughPandoc(request(root, { ...options, outputDir: "build-b" }));
  assert.equal(first.ok && second.ok, true, JSON.stringify(first.refusal ?? second.refusal));
  assert.equal(first.receipt.outputs[0].ni, second.receipt.outputs[0].ni);
}));

for (const engine of ["xelatex", "pdflatex"]) {
  test(`real pandoc: a PDF through ${engine} is produced and byte-identical across runs on one toolchain`, { skip: SKIP || (haveEngine(engine) ? false : `${engine} is not on PATH`) }, withManuscript(async (root) => {
    const first = await projectManuscriptThroughPandoc(request(root, { formats: ["pdf"], pdfEngine: engine, outputDir: "build-a" }));
    assert.equal(first.ok, true, JSON.stringify(first.refusal));
    assert.equal(readFileSync(join(root, "build-a/manuscript.pdf")).subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(first.receipt.toolchain.pdfEngine.texLive);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await projectManuscriptThroughPandoc(request(root, { formats: ["pdf"], pdfEngine: engine, outputDir: "build-b" }));
    assert.equal(first.receipt.outputs[0].ni, second.receipt.outputs[0].ni);
  }));
}
