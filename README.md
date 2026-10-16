# Project a document through Pandoc

The existing JavaScript export plans and performs **one** caller-scoped Pandoc projection. It does not decide whether a document should be released or which market should receive it.

## Received archival CLI

The original `publish-book` Bash executable is recovered from:
- `emsenn/2025-12-19-pandoc-publishing@71b74fc7b7694d2e0fb16b023817b2dae2ec3ace:bin/publish-book`;
- `emsenn/emsenn-archive-code@3c69d5cf9d3bec484f1dc22067ed9623b1bab7c6:topical/information/561-group/superrepo/engine/pandoc-publishing/bin/publish-book`.

The two archival Git blobs are **identical**: `bee61615b088452ea9c34a9bd5f67c01b4a00f73`. That exact `100755` executable entered this living repository in `edc21f1964a47c72f5f585e03f88e718d7ed24cc`. The subsequent source commit retains this ancestry while tightening local fabrication refusal. The historical repositories remain readable evidence and are no longer preferred executable owners.

Direct input:
```sh
bin/publish-book --source manuscript.md --outdir dist --basename manuscript
```

Original repository manifest (only `book.source`, optional `book.basename`, and optional `publish.slug` of the historical `semantics.yaml` subset):
```sh
bin/publish-book --repo /path/to/manuscript-repo --outroot /path/to/builds
```

Optional `--no-html`, `--no-pdf`, and `--pdf-engine xelatex|lualatex|pdflatex` preserve the CLI contract. Both requested outputs are fabricated in one temporary output-directory sibling, then selected only if all requested Pandoc invocations succeed. Invalid output basenames, unsupported engine names and requests for zero output formats are refused. The log remains in `<outdir>/build.log` on success or failure. A failed conversion cannot replace the previously produced artifacts. This local arrangement does not claim atomicity for filesystem failures between the two final moves; consumers still need an independent acceptance gate.

Requirements: Bash, coreutils (`sed`, `mktemp`, `mv`), Pandoc, and the selected PDF TeX engine. Package `bin` exposes `publish-book`, and `node --test test/publish-book.test.mjs` exercises its command-line contract with a **fake Pandoc only**; actual conversions require real Pandoc and receiver qualification. This repository does not activate the old unpinned GitHub Actions workflow, upload release artifacts, implement multi-paper publishing, or certify Lean proofs. The unsatisfied future contract stays with the original [paper publishing request](https://github.com/emsenn/2025-12-19-pandoc-publishing/issues/1), not as a new parallel publishing service.
