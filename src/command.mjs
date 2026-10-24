import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

/** Every operation answers with ok: true plus its value, or ok: false and a refusal. */
export const resultSchema = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    refusal: { type: "object", required: ["reason", "message"], properties: { reason: { type: "string" }, message: { type: "string" } } },
  },
};

/** Run one operation as an NDJSON command: one JSON value per input line, one per output line. */
export async function runCommand(operationDefinition) {
  process.exitCode = (await runJavascriptNodeOperation(operationDefinition, {
    arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout,
  })).exitCode;
}
