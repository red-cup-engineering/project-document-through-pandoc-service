#!/usr/bin/env node
// Plan and run a manuscript projection, optionally inside a container image, and write the build receipt.
// Dependencies: Node built-ins only, so a consumer repository can run it straight from a checkout.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { projectManuscriptThroughPandoc } from "../src/manuscript-project.mjs";
import { nodePorts, runProgram } from "../src/ports.mjs";

const { values } = parseArgs({ options: {
  request: { type: "string" }, receipt: { type: "string", default: "build/receipt.json" },
  "docker-image": { type: "string" }, "source-date-epoch": { type: "string" },
} });
if (values.request === undefined) { console.error("usage: render-manuscript --request request.json [--receipt path] [--docker-image ref@sha256:...] [--source-date-epoch n]"); process.exit(2); }

const request = JSON.parse(readFileSync(values.request, "utf8"));
if (values["source-date-epoch"] !== undefined) request.sourceDateEpoch = Number(values["source-date-epoch"]);
const rootDir = resolve(request.rootDir ?? ".");

const ports = nodePorts(rootDir);
if (values["docker-image"] !== undefined) {
  const user = typeof process.getuid === "function" ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
  ports.runPandoc = ({ command = "pandoc", argv, env = {} }) => runProgram({
    command: "docker",
    argv: ["run", "--rm", ...user, "--network=none", "--volume", `${rootDir}:/data`, "--workdir", "/data", "--entrypoint", command,
      ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]), values["docker-image"], ...argv],
    env: {},
  });
}

const result = await projectManuscriptThroughPandoc(request, ports);
const output = result.ok ? result.receipt : result;
const receiptPath = resolve(values.receipt);
mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(result.ok ? { ok: true, receipt: values.receipt, outputs: result.receipt.outputs.map(({ format, path, ni }) => ({ format, path, ni })) } : result));
process.exitCode = result.ok ? 0 : 1;
