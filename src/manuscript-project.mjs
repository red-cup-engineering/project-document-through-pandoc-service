import { PLAN_KIND, planManuscriptProjection } from "./manuscript-plan.mjs";
import { observePandocToolchain } from "./pandoc-toolchain.mjs";
import { nodePorts } from "./ports.mjs";

export const RECEIPT_KIND = "manuscript-build-receipt";
const MAX_RESOURCE_FILES = 2000;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const refuse = (reason, message, extra = {}) => Object.freeze({ ok: false, refusal: Object.freeze({ reason, message }), ...extra });
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const MEDIA_TYPES = {
  md: "text/markdown", markdown: "text/markdown", yaml: "application/yaml", yml: "application/yaml", json: "application/json",
  csl: "application/vnd.citationstyles.style+xml", bib: "application/x-bibtex", tex: "application/x-tex", css: "text/css",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", svg: "image/svg+xml", pdf: "application/pdf", html: "text/html", csv: "text/csv", txt: "text/plain",
};
const mediaTypeOf = (path) => MEDIA_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

function walk(directory, outputDir, ports, found) {
  for (const entry of ports.readdir(directory).sort((a, b) => compare(a.name, b.name))) {
    const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
    if (path === outputDir || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    if (entry.directory) walk(path, outputDir, ports, found);
    else found.push(path);
    if (found.length > MAX_RESOURCE_FILES) throw new RangeError(`resource paths hold more than ${MAX_RESOURCE_FILES} files`);
  }
}

/** Every input of a plan, in a fixed order, with its role. Resource directories are listed file by file. */
function inputList(plan, ports) {
  const items = [];
  const add = (role, path) => { if (!items.some((item) => item.path === path)) items.push({ role, path }); };
  for (const path of plan.inputs.parts) add("part", path);
  for (const [role, key] of [["metadata", "metadataFile"], ["bibliography", "bibliography"], ["csl-style", "cslStyle"], ["reference-doc", "referenceDoc"], ["stylesheet", "css"]]) {
    if (plan.inputs[key] !== undefined) add(role, plan.inputs[key]);
  }
  const resources = [];
  for (const root of plan.inputs.resourcePaths) {
    if (root === "." || !ports.exists(root)) continue;
    walk(root, plan.outputDir, ports, resources);
  }
  for (const path of resources.sort(compare)) add("resource", path);
  return items;
}

/**
 * Execute a manuscript projection plan through an injected `runPandoc` port and return a build
 * receipt: the pandoc version, every argv, the NI of every input and every output, and a
 * `provenance` block already in the shape of a prov-o-provenance-service manifest fragment.
 * @param {object} planOrRequest A plan from `planManuscriptProjection`, or the request it takes.
 * @param {object} [ports] `{runPandoc, exists, readFile, writeFile, mkdir, readdir, now, address}`; defaults are the Node ports rooted at the plan's rootDir.
 * @returns {Promise<object>} `{ok: true, receipt}`, or a refusal (with the partial `receipt` when pandoc itself failed).
 */
export async function projectManuscriptThroughPandoc(planOrRequest, ports = {}) {
  let plan = planOrRequest;
  if (plan?.kind !== PLAN_KIND) {
    const planned = planManuscriptProjection(planOrRequest, { exists: (ports.exists ?? nodePorts(planOrRequest?.rootDir ?? ".").exists) });
    if (!planned.ok) return planned;
    plan = planned.plan;
  }
  if (plan.version !== 1 || !Array.isArray(plan.outputs) || plan.outputs.length === 0) return refuse("InvalidPlan", "plan is not a version 1 manuscript projection plan");
  const io = { ...nodePorts(plan.rootDir), ...ports };

  for (const path of [...plan.inputs.parts, ...[plan.inputs.metadataFile, plan.inputs.bibliography, plan.inputs.cslStyle, plan.inputs.referenceDoc, plan.inputs.css].filter(Boolean)]) {
    if (!io.exists(path)) return refuse(path === plan.inputs.cslStyle ? "MissingStyle" : plan.inputs.parts.includes(path) ? "MissingPart" : "MissingInput", `input ${path} does not exist under ${plan.rootDir}`);
  }

  const toolchain = await observePandocToolchain({ pdfEngine: plan.pdfEngine }, { runPandoc: io.runPandoc });
  if (!toolchain.ok) return toolchain;
  if (plan.requirePandocVersion !== undefined && toolchain.pandoc.version !== plan.requirePandocVersion) {
    return refuse("PandocVersionMismatch", `plan requires pandoc ${plan.requirePandocVersion} but ${toolchain.pandoc.version} is installed`);
  }

  let inputs;
  try {
    inputs = inputList(plan, io).map((item) => {
      const bytes = io.readFile(item.path);
      return { ...item, id: item.path, ni: io.address(bytes), bytes: bytes.byteLength, mediaType: mediaTypeOf(item.path) };
    });
  } catch (error) {
    return refuse("InputUnreadable", error.message);
  }

  const startedAt = io.now();
  io.mkdir(plan.outputDir);
  const support = [];
  for (const file of plan.supportFiles) {
    const bytes = new TextEncoder().encode(file.content);
    io.writeFile(file.path, bytes);
    support.push({ role: file.role, path: file.path, id: file.path, ni: io.address(bytes), bytes: bytes.byteLength, mediaType: file.mediaType });
  }

  const invocations = [], outputs = [], activities = [];
  for (const output of plan.outputs) {
    const began = io.now();
    const result = await io.runPandoc({ command: plan.command, argv: output.argv, env: plan.env });
    const ended = io.now();
    const invocation = { format: output.format, argv: [plan.command, ...output.argv], env: plan.env, cwd: plan.rootDir, status: result.status, startedAt: began.toISOString(), endedAt: ended.toISOString() };
    invocations.push(invocation);
    if (result.status !== 0 || !io.exists(output.path)) {
      return refuse("PandocFailed", `pandoc failed for ${output.format} (${result.error ?? `status ${result.status}`}): ${(result.stderr || result.stdout || "no diagnostic").trim().slice(0, 2000)}`, { receipt: { kind: RECEIPT_KIND, version: 1, toolchain, invocations, outputs } });
    }
    const bytes = io.readFile(output.path);
    outputs.push({ format: output.format, path: output.path, id: output.path, ni: io.address(bytes), bytes: bytes.byteLength, mediaType: output.mediaType, reproducibility: output.reproducibility });
    activities.push({
      id: `render-${output.format}`,
      label: `pandoc ${toolchain.pandoc.version} projection to ${output.format}`,
      startedAt: began.toISOString(),
      endedAt: ended.toISOString(),
      used: [...inputs, ...(output.format === "pdf" ? support : [])].map((item) => item.id),
      generated: [output.path],
      wasAssociatedWith: [
        { agent: "pandoc", role: "renderer" },
        ...(output.format === "pdf" && toolchain.pdfEngine ? [{ agent: toolchain.pdfEngine.name, role: "typesetter" }] : []),
      ],
    });
  }
  const endedAt = io.now();

  const manifestEntity = (item, derived) => ({ id: item.id, path: item.path, ni: item.ni, bytes: item.bytes, mediaType: item.mediaType, ...(derived === undefined ? {} : { wasDerivedFrom: derived }) });
  const sources = [...inputs, ...support];
  const agents = [
    { id: "pandoc", name: `pandoc ${toolchain.pandoc.version}`, kind: "software" },
    ...(toolchain.pdfEngine ? [{ id: toolchain.pdfEngine.name, name: toolchain.pdfEngine.versionLine, kind: "software" }] : []),
  ];
  return Object.freeze({
    ok: true,
    receipt: {
      kind: RECEIPT_KIND,
      version: 1,
      toolchain: { pandoc: toolchain.pandoc, ...(toolchain.pdfEngine ? { pdfEngine: toolchain.pdfEngine } : {}) },
      sourceDateEpoch: plan.sourceDateEpoch,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      inputs: inputs.map(({ role, path, ni, bytes }) => ({ role, path, ni, bytes })),
      supportFiles: support.map(({ role, path, ni, bytes }) => ({ role, path, ni, bytes })),
      invocations,
      outputs: outputs.map(({ format, path, ni, bytes, mediaType, reproducibility }) => ({ format, path, ni, bytes, mediaType, reproducibility: reproducibility.level })),
      provenance: {
        agents,
        activities,
        entities: [
          ...sources.map((item) => manifestEntity(item)),
          ...outputs.map((item) => manifestEntity(item, sources.filter((source) => source.role !== "support" || item.format === "pdf").map((source) => source.id))),
        ],
      },
    },
  });
}
