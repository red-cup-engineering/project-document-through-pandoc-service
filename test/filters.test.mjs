// Shipped Lua filters and multiple metadata files. The real-pandoc test is skipped when pandoc is absent.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planManuscriptProjection, SHIPPED_FILTERS } from "../src/manuscript-plan.mjs";
import { nodePorts } from "../src/ports.mjs";

const base = { parts: ["paper.md"], formats: ["html"], sourceDateEpoch: 1700000000, citeproc: false };

test("plan: a shipped filter becomes a support file and a --lua-filter before --citeproc", () => {
  const result = planManuscriptProjection({ ...base, citeproc: true, bibliography: "refs.yaml", cslStyle: "style.csl", filters: ["paper-declarations"] });
  assert.equal(result.ok, true);
  const support = result.plan.supportFiles.find((file) => file.path === "build/.filters/paper-declarations.lua");
  assert.equal(support.content, SHIPPED_FILTERS["paper-declarations"]);
  const argv = result.plan.outputs[0].argv;
  assert.ok(argv.indexOf("--lua-filter=build/.filters/paper-declarations.lua") < argv.indexOf("--citeproc"));
});

test("plan: metadataFiles are read in order after metadataFile", () => {
  const result = planManuscriptProjection({ ...base, metadataFile: "a.yaml", metadataFiles: ["b.yaml", "c.yaml"] });
  const argv = result.plan.outputs[0].argv.filter((arg) => arg.startsWith("--metadata-file="));
  assert.deepEqual(argv, ["--metadata-file=a.yaml", "--metadata-file=b.yaml", "--metadata-file=c.yaml"]);
});

test("plan: an unknown filter and an escaping metadata file are refused", () => {
  assert.equal(planManuscriptProjection({ ...base, filters: ["rm-rf"] }).refusal.reason, "UnknownFilter");
  assert.equal(planManuscriptProjection({ ...base, metadataFiles: ["../x.yaml"] }).refusal.reason, "PathEscapesRoot");
});

const havePandoc = spawnSync("pandoc", ["--version"]).status === 0;

test("real pandoc: paper-declarations renders authorship, CARE and funding before the bibliography", { skip: havePandoc ? false : "pandoc is not on PATH" }, () => {
  const root = mkdtempSync(join(tmpdir(), "paper-declarations-"));
  try {
    mkdirSync(join(root, "build"));
    writeFileSync(join(root, "build", "paper-declarations.lua"), SHIPPED_FILTERS["paper-declarations"]);
    writeFileSync(join(root, "paper.yaml"), [
      "title: T", "version: \"1.0.0\"", "status: released",
      "authors:", "  - {given: Ada, family: Lovelace, affiliation: Lab, role: accountable-author, ai: false}",
      "  - {name: Model 1, role: ai-research-collaborator, ai: true, disclosure: An AI system.}",
      "acknowledgements:", "  - {name: Anonymous contributor, role: research direction}",
      "funding:", "  - {funder: Agency, award: A-1}",
      "care:", "  collective-benefit: Open release.",
      "license: {text: CC-BY-4.0, code: MIT}", "repository-code: https://example.org/r", "",
    ].join("\n"));
    writeFileSync(join(root, "paper.md"), "# Body\n\nText.\n\n# Bibliography\n\n::: {#refs}\n:::\n");
    const run = spawnSync("pandoc", ["--metadata-file=paper.yaml", "--lua-filter=build/paper-declarations.lua", "--to=markdown", "paper.md"], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = run.stdout;
    for (const expected of ["Declarations", "Ada Lovelace", "An AI system.", "Anonymous contributor", "Agency, award A-1", "collective benefit", "CC-BY-4.0"]) assert.ok(out.includes(expected), expected);
    assert.ok(out.indexOf("Declarations") < out.indexOf("Bibliography"), "declarations precede the bibliography section");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ports: writeFile creates the support file's parent directories", () => {
  const root = mkdtempSync(join(tmpdir(), "ports-"));
  try {
    nodePorts(root).writeFile("build/.filters/x.lua", new TextEncoder().encode("-- x"));
    assert.equal(readFileSync(join(root, "build/.filters/x.lua"), "utf8"), "-- x");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
