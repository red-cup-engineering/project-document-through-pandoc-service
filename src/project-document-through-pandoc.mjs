import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const supportedFormats = new Set(["html", "pdf", "markdown"]);

function checkPath(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty path`);
  return resolve(value);
}

/** Plan one explicit document projection.  Discovery and release policy stay with the caller. */
export function planPandocDocumentProjection({ sourcePath, outputPath, format, metadata = {}, templatePath, stylesheetPath, pdfEngine } = {}) {
  const source = checkPath(sourcePath, "sourcePath"), output = checkPath(outputPath, "outputPath");
  if (!supportedFormats.has(format)) throw new TypeError(`format must be one of ${[...supportedFormats].join(", ")}`);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Object.values(metadata).some((value) => typeof value !== "string")) throw new TypeError("metadata must be a string-valued object");
  const args = [source, "--output", output, "--standalone"];
  if (format === "pdf" && pdfEngine !== undefined) {
    if (typeof pdfEngine !== "string" || pdfEngine.trim() === "") throw new TypeError("pdfEngine must be a non-empty string");
    args.push(`--pdf-engine=${pdfEngine}`);
  }
  if (templatePath !== undefined) args.push("--template", checkPath(templatePath, "templatePath"));
  if (stylesheetPath !== undefined) {
    if (format !== "html") throw new TypeError("stylesheetPath is only meaningful for HTML output");
    args.push("--css", checkPath(stylesheetPath, "stylesheetPath"));
  }
  for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) args.push("--metadata", `${key}=${value}`);
  return Object.freeze({ kind: "pandoc-document-projection-plan", sourcePath: source, outputPath: output, format, command: "pandoc", arguments: Object.freeze(args), metadata: Object.freeze({ ...metadata }) });
}

/** Execute a previously planned local codec projection and return its immutable receipt. */
export function projectDocumentThroughPandoc(plan) {
  if (!plan || plan.kind !== "pandoc-document-projection-plan" || !Array.isArray(plan.arguments)) throw new TypeError("plan must be a Pandoc document projection plan");
  mkdirSync(dirname(plan.outputPath), { recursive: true });
  const result = spawnSync(plan.command, plan.arguments, { encoding: "utf8" });
  if (result.error) throw new Error(`could not start ${plan.command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${plan.command} failed (${result.status}): ${(result.stderr || result.stdout || "no diagnostic").trim()}`);
  return Object.freeze({ kind: "pandoc-document-projection-receipt", plan, status: "projected", stdout: result.stdout ?? "" });
}
