import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** RFC 6920 name of bytes: ni:///sha-256;<base64url digest>. Equal to the house makeNiUri (see the conformance vectors in test/). */
export function niOf(bytes) {
  return `ni:///sha-256;${createHash("sha256").update(bytes).digest("base64url")}`;
}

/**
 * Run a program and collect its output. Never throws: a program that cannot start reports
 * `status: null` and the reason in `error`.
 * @param {{command: string, argv: string[], cwd?: string, env?: Record<string,string>}} call
 */
export function runProgram({ command, argv, cwd, env }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ status: null, stdout: "", stderr: "", error: error.message });
      return;
    }
    const out = [], err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => resolve({ status: null, stdout: "", stderr: "", error: error.message }));
    child.on("close", (status) => resolve({ status, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
}

/** The effectful ports, rooted at one directory. Every path handed to a port is relative to that root. */
export function nodePorts(rootDir = ".") {
  const at = (path) => join(rootDir, path);
  return {
    runPandoc: ({ command = "pandoc", argv, env }) => runProgram({ command, argv, cwd: rootDir, env }),
    exists: (path) => existsSync(at(path)),
    readFile: (path) => new Uint8Array(readFileSync(at(path))),
    // Support files may sit in subdirectories of the output directory (shipped filters in .filters/).
    writeFile: (path, bytes) => { mkdirSync(dirname(at(path)), { recursive: true }); writeFileSync(at(path), bytes); },
    mkdir: (path) => mkdirSync(at(path), { recursive: true }),
    readdir: (path) => readdirSync(at(path), { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })),
    now: () => new Date(),
    address: niOf,
  };
}
