# Project a document through Pandoc

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

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

Optional `--math-single-backslash`, `--no-html`, `--no-pdf`, and `--pdf-engine xelatex|lualatex|pdflatex` preserve the CLI contract. Both requested outputs are fabricated in one temporary output-directory sibling, then selected only if all requested Pandoc invocations succeed. Invalid output basenames, unsupported engine names and requests for zero output formats are refused. The log remains in `<outdir>/build.log` on success or failure. A failed conversion cannot replace the previously produced artifacts. This local arrangement does not claim atomicity for filesystem failures between the two final moves; consumers still need an independent acceptance gate.

Requirements: Bash, coreutils (`sed`, `mktemp`, `mv`), Pandoc, and the selected PDF TeX engine. Package `bin` exposes `publish-book`, and `node --test test/publish-book.test.mjs` exercises its command-line contract with a **fake Pandoc only**; actual conversions require real Pandoc and receiver qualification. This repository does not activate the old unpinned GitHub Actions workflow, upload release artifacts, implement multi-paper publishing, or certify Lean proofs. The unsatisfied future contract stays with the original [paper publishing request](https://github.com/emsenn/2025-12-19-pandoc-publishing/issues/1), not as a new parallel publishing service.


## 20 October 2026: exact math reader selection for research papers

An actual [Obsmetrologia research manuscript](https://github.com/lenticule-science/obsmetrologia/blob/main/docs/preprints/02-feathers-fleets-and-farms-finite-fibers.md) writes TeX math as `\(x\)` and `\[x\]`. Pandoc's default Markdown reader does not enable its built-in `tex_math_single_backslash` extension: real XeLaTeX PDF fabrication failed with `Missing $ inserted` on mathematical content. Specifying Pandoc's standard `markdown+tex_math_single_backslash` reader repaired this in a local end-to-end rendering.

For such manuscripts, use the existing published CLI with:

```sh
bin/publish-book --source manuscript.md --outdir dist --basename paper --math-single-backslash
```

For a caller that supplies an existing Pandoc projection plan, set `reader: "markdown+tex_math_single_backslash"` on `planPandocDocumentProjection`. Default behavior for previously supported manuscripts is unchanged. An unknown or injected reader is refused. The CLI supplies the same reader to HTML **and** PDF; one output cannot silently interpret math differently from the other.

This repairs a **fabrication** option in the original Red Cup producer, not a DOI, license, editorial admission, public release, or ActivityPub syndication. The existing research-document metadata, Math/Lean and Causeway publication owners retain their responsibilities. The CLI test suite includes valid/default/refusal cases with a fake Pandoc; actual conversion still requires an independently installed Pandoc/TeX host and publication receiving.
