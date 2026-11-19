#!/usr/bin/env node
import { projectManuscriptThroughPandoc } from "../src/manuscript-project.mjs";
import { manuscriptRequestSchema } from "../src/manuscript-request-schema.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { projectManuscriptThroughPandoc };

export const operationDefinition = {
  name: "projectManuscriptThroughPandoc",
  description: "Runs real pandoc over a planned (or plannable) manuscript projection and returns a build receipt: pandoc version, argv, input and output ni: addresses, and a provenance fragment for prov-o-provenance-service.",
  inputSchema: { anyOf: [manuscriptRequestSchema, { type: "object", required: ["kind"], properties: { kind: { const: "manuscript-projection-plan" } } }] },
  outputSchema: resultSchema,
  operation: (planOrRequest) => projectManuscriptThroughPandoc(planOrRequest),
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
