#!/usr/bin/env node
import { observePandocToolchain } from "../src/pandoc-toolchain.mjs";
import { PDF_ENGINES } from "../src/manuscript-plan.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { observePandocToolchain };

export const operationDefinition = {
  name: "observePandocToolchain",
  description: "Observes the installed pandoc version and, if requested, the version line of a PDF engine (xelatex, lualatex or pdflatex).",
  inputSchema: { type: "object", properties: { pdfEngine: { enum: [...PDF_ENGINES] } } },
  outputSchema: resultSchema,
  operation: (request) => observePandocToolchain(request),
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
