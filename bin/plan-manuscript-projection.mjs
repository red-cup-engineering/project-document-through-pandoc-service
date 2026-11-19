#!/usr/bin/env node
import { planManuscriptProjection } from "../src/manuscript-plan.mjs";
import { nodePorts } from "../src/ports.mjs";
import { manuscriptRequestSchema } from "../src/manuscript-request-schema.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { planManuscriptProjection };

export const operationDefinition = {
  name: "planManuscriptProjection",
  description: "Plans the projection of an ordered Markdown manuscript, metadata file, CSL-YAML bibliography and CSL style into pdf, html, docx, epub or jats as exact pandoc argument vectors; refuses missing parts or style.",
  inputSchema: manuscriptRequestSchema,
  outputSchema: resultSchema,
  operation: (request) => planManuscriptProjection(request, { exists: nodePorts(request.rootDir ?? ".").exists }),
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
