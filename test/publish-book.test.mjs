import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { planPandocDocumentProjection } from "../src/project-document-through-pandoc.mjs";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/publish-book");

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "pandoc-archive-receipt-"));
  try {
    const mockBin = join(root, "mock-bin");
    mkdirSync(mockBin);
    const mockPandoc = join(mockBin, "pandoc");
    writeFileSync(mockPandoc, [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "pandoc mock 1.0"; exit 0; fi',
      'if [ "$PANDOC_MOCK_REQUIRE_MATH" = "1" ]; then',
      '  case "$*" in *--from=markdown+tex_math_single_backslash*) ;; *) echo "missing math reader" >&2; exit 7;; esac',
      'fi',
      'if [ "$PANDOC_MOCK_FAIL_PDF" = "1" ]; then',
      '  case "$*" in *.pdf*) echo "mock pdf failure" >&2; exit 9;; esac',
      "fi",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi',
      "done",
      '[ -n "$out" ] || exit 2',
      'printf "mock artifact\n" > "$out"',
    ].join("\n") + "\n");
    chmodSync(mockPandoc, 0o755);
    const run = (args, env = {}) => spawnSync("bash", [script, ...args], {
      cwd: root, encoding: "utf8", env: { ...process.env, ...env, PATH: mockBin + ":" + process.env.PATH },
    });
    const source = join(root, "manuscript.md");
    writeFileSync(source, "# A test manuscript\n");
    fn({ root, source, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("original --source contract builds both HTML and PDF with a log", () => fixture(({root, source, run}) => {
  const out = join(root, "dist");
  const result = run(["--source", source, "--outdir", out, "--basename", "sample"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(out, "sample.html"), "utf8"), "mock artifact\n");
  assert.equal(readFileSync(join(out, "sample.pdf"), "utf8"), "mock artifact\n");
  assert.match(readFileSync(join(out, "build.log"), "utf8"), /== local conversion finished ==/);
  assert.deepEqual(readdirSync(out).sort(), ["build.log", "sample.html", "sample.pdf"]);
}));

test("original --repo semantics and HTML-only selection", () => fixture(({root, run}) => {
  const repo = join(root, "paper");
  mkdirSync(join(repo, "text"), { recursive: true });
  writeFileSync(join(repo, "text", "paper.md"), "# A paper\n");
  writeFileSync(join(repo, "semantics.yaml"), "book:\n  source: text/paper.md\npublish:\n  slug: paper-edition\n");
  const outroot = join(root, "published");
  const result = run(["--repo", repo, "--outroot", outroot, "--no-pdf"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(outroot, "paper", "paper-edition.html")));
  assert.equal(existsSync(join(outroot, "paper", "paper-edition.pdf")), false);
}));

test("a failed PDF conversion retains the previous complete outputs", () => fixture(({root, source, run}) => {
  const out = join(root, "dist");
  mkdirSync(out);
  writeFileSync(join(out, "sample.html"), "previous html\n");
  writeFileSync(join(out, "sample.pdf"), "previous pdf\n");
  const result = run(["--source", source, "--outdir", out, "--basename", "sample"], {
    PANDOC_MOCK_FAIL_PDF: "1",
  });
  assert.equal(result.status, 9, result.stderr);
  assert.equal(readFileSync(join(out, "sample.html"), "utf8"), "previous html\n");
  assert.equal(readFileSync(join(out, "sample.pdf"), "utf8"), "previous pdf\n");
  assert.match(readFileSync(join(out, "build.log"), "utf8"), /mock pdf failure/);
  assert.deepEqual(readdirSync(out).sort(), ["build.log", "sample.html", "sample.pdf"]);
}));

test("no-output and basename traversal are refused before creating artifacts", () => fixture(({root, source, run}) => {
  const out = join(root, "dist");
  for (const args of [
    ["--no-html", "--no-pdf"],
    ["--basename", "../outside"],
    ["--basename", "/absolute"],
    ["--pdf-engine", "unsupported"],
  ]) {
    const baseline = ["--source", source, "--outdir", out, "--basename", "sample"];
    const result = run([...baseline, ...args]);
    assert.equal(result.status, 2, result.stderr);
  }
  assert.equal(existsSync(out), false);
}));

test("missing metadata and missing input are refused", () => fixture(({root, run}) => {
  const repo = join(root, "paper");
  mkdirSync(repo);
  assert.equal(run(["--repo", repo, "--outroot", join(root, "published")]).status, 2);
  assert.equal(run(["--source", join(root, "missing.md"), "--outdir", join(root, "dist"), "--basename", "book"]).status, 2);
}));


test("native math reader is opt-in and source plan rejects unknown input readers", () => {
  const base = {sourcePath:"/tmp/research.md",outputPath:"/tmp/research.pdf",format:"pdf"};
  const old = planPandocDocumentProjection(base);
  assert.equal(old.arguments.includes("--from"), false);
  const math = planPandocDocumentProjection({...base,reader:"markdown+tex_math_single_backslash"});
  assert.deepEqual(math.arguments.slice(math.arguments.indexOf("--from"),math.arguments.indexOf("--from")+2),
    ["--from","markdown+tex_math_single_backslash"]);
  assert.throws(() => planPandocDocumentProjection({...base,reader:"markdown+raw_tex+unknown"}),
    /unsupported Pandoc input reader/);
});

test("CLI passes the opt-in math reader to both HTML and PDF and preserves refusal", () => fixture(({root, source, run}) => {
  writeFileSync(source, "# A test with \\(a+b\\)\\n");
  const out = join(root, "math");
  const args = ["--source",source,"--outdir",out,"--basename","paper"];
  const refused = run(args, {PANDOC_MOCK_REQUIRE_MATH:"1"});
  assert.equal(refused.status,7);
  assert.equal(existsSync(join(out,"paper.pdf")),false);
  const done = run([...args,"--math-single-backslash"], {PANDOC_MOCK_REQUIRE_MATH:"1"});
  assert.equal(done.status,0,done.stderr);
  assert.equal(readFileSync(join(out,"paper.html"),"utf8"),"mock artifact\n");
  assert.equal(readFileSync(join(out,"paper.pdf"),"utf8"),"mock artifact\n");
  assert.match(readFileSync(join(out,"build.log"),"utf8"),/math_single_backslash: 1/);
}));
