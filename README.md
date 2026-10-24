# @red-cup-engineering/project-document-through-pandoc-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Plans and runs pandoc, without owning document discovery, Git state or publication routes. Two layers:

1. **The manuscript renderer** (0.2.0): a reproducible renderer for an ordered Markdown manuscript with a
   CSL-YAML bibliography and a CSL style, to `pdf`, `html`, `docx`, `epub` and `jats`, that returns a **build
   receipt** — pandoc version, exact argv, the `ni:` address of every input and output — shaped to feed
   [`prov-o-provenance-service`](https://github.com/red-cup-engineering/prov-o-provenance-service).
2. **The single-document projection** (unchanged): `planPandocDocumentProjection` /
   `projectDocumentThroughPandoc`, and the archival `publish-book` Bash CLI.

Every manuscript operation answers `{ok: true, ...}` or `{ok: false, refusal: {reason, message}}`, and each has a
command that reads one JSON value per input line and writes one JSON value per output line. All paths in a request
are **relative to `rootDir`** and pandoc runs with `rootDir` as its working directory, so the argv in a plan and in a
receipt is the same on every machine.

## Operations

### planManuscriptProjection

~~~js
export function planManuscriptProjection(request, ports = {})
~~~

`request`: `{parts, formats, sourceDateEpoch}` plus optionally `metadataFile`, `bibliography` (CSL-YAML or CSL-JSON),
`cslStyle`, `rootDir` (default `.`), `outputDir` (`build`), `basename` (`manuscript`), `pdfEngine`
(`xelatex` default | `lualatex` | `pdflatex`), `resourcePaths` (`["."]`), `citeproc` (true), `numberSections`,
`toc`, `tocDepth`, `from` (`markdown`), `date` (a string or `"source-date-epoch"`), `referenceDoc` (docx), `css` and
`embedResources` (html), `jatsFlavor` (`archiving` | `publishing` | `articleauthoring`), `variables`, `metadata`,
`requirePandocVersion`.

- Returns `{ok: true, plan}`: `plan.outputs[i] = {format, path, mediaType, reproducibility, argv}` in request order,
  `plan.env` (`SOURCE_DATE_EPOCH`, `FORCE_SOURCE_DATE=1`, `TZ=UTC`), `plan.supportFiles` (for PDF, a generated
  LaTeX header that removes build-time values).
- Refusals: `InvalidRequest`, `NoManuscriptParts`, `NoOutputFormats`, `UnsupportedFormat`, `UnsupportedPdfEngine`,
  `InvalidSourceDateEpoch`, `PathEscapesRoot` (absolute, `..`, backslash, or beginning with `-`),
  `MissingBibliography` / `MissingStyle` (citeproc is on and none named). When `ports.exists` is supplied (the command
  supplies it), also `MissingPart`, `MissingMetadata`, `MissingReferenceDoc`, `MissingStylesheet`, and `MissingStyle` /
  `MissingBibliography` for named files that are not there.
- Precondition: the request is as above; every path is inside `rootDir`.
- Postcondition: each `argv` is the exact argument vector for `pandoc`, parts in the order given, relative paths only.
- Preserved frame: the request and the filesystem; nothing is read or written.
- Effect class: pure.
- Witness: the plan itself; planning twice yields deep-equal plans.
- Command: `plan-manuscript-projection` reads one request per line.

### projectManuscriptThroughPandoc

~~~js
export async function projectManuscriptThroughPandoc(planOrRequest, ports = {})
~~~

Runs a plan (or plans a request, then runs it). Ports: `runPandoc({command, argv, env})`, `exists`, `readFile`,
`writeFile`, `mkdir`, `readdir`, `now`, `address`; each defaults to the Node implementation rooted at `rootDir`.
`runPandoc` is the seam for fakes and for container runners.

- Returns `{ok: true, receipt}`. `receipt` = `{kind: "manuscript-build-receipt", version, toolchain: {pandoc, pdfEngine?},
  sourceDateEpoch, startedAt, endedAt, inputs, supportFiles, invocations: [{format, argv, env, cwd, status, startedAt, endedAt}],
  outputs: [{format, path, ni, bytes, mediaType, reproducibility}], provenance: {agents, activities, entities}}`.
  `inputs` are the parts, metadata, bibliography, CSL style, reference doc, stylesheet and every file below a non-root
  resource path (figures), each with its `ni:`.
- `receipt.provenance` is already a `prov-o-provenance-service` manifest fragment: agents `pandoc` (and the PDF engine),
  one `render-<format>` activity per output (`used` = inputs, `generated` = the output, role `renderer`/`typesetter`),
  and entities with `wasDerivedFrom` on every output. Add the accountable human agent (and `actedOnBehalfOf`) and
  concatenate.
- Refusals: every planning refusal; `MissingPart`, `MissingStyle`, `MissingInput` (checked again at run time);
  `PandocNotFound`, `PdfEngineNotFound`; `PandocVersionMismatch` (when the plan names `requirePandocVersion`);
  `InputUnreadable`; `PandocFailed` (carries the partial `receipt` of what ran).
- Precondition: pandoc (and, for PDF, the engine) is installed; the plan's inputs exist.
- Postcondition: each output file exists and its `ni` is the sha-256 of its bytes; no output is reported for a pandoc
  that failed.
- Preserved frame: all input files (never written) and everything outside `outputDir`.
- Effect class: writes `outputDir` and runs `pandoc` (and a TeX engine) as child processes.
- Witness: the receipt (versions, argv, `ni:` addresses); re-running with the same toolchain reproduces the output `ni:`
  where `reproducibility` says it can.
- Command: `project-manuscript-through-pandoc` reads one request or plan per line.

### observePandocToolchain

~~~js
export async function observePandocToolchain({ pdfEngine? } = {}, ports = {})
~~~

- Returns `{ok: true, pandoc: {version, versionLine, features?}, pdfEngine?: {name, versionLine, version?, texLive?}}`.
- Refusals: `InvalidRequest`, `UnsupportedPdfEngine`, `PandocNotFound`, `PdfEngineNotFound`, `PandocVersionUnreadable`.
- Precondition: none.
- Postcondition: values are exactly what the programs print for `--version`.
- Preserved frame: everything (reads only program output).
- Effect class: runs `pandoc --version` and optionally `<engine> --version`.
- Witness: the version lines.
- Command: `observe-pandoc-toolchain` reads one `{pdfEngine?}` per line.

## Invocation

```sh
echo '{"parts":["manuscript/00-intro.md"],"metadataFile":"manuscript/metadata.yaml","bibliography":"references.yaml","cslStyle":"styles/minimal.csl","formats":["html"],"sourceDateEpoch":1700000000}' \
  | node bin/plan-manuscript-projection.mjs
echo '{"pdfEngine":"xelatex"}' | node bin/observe-pandoc-toolchain.mjs
node bin/project-manuscript-through-pandoc.mjs < request.ndjson     # runs pandoc
node bin/render-manuscript.mjs --request request.json --receipt build/receipt.json [--docker-image ref@sha256:...]
```

`render-manuscript` has Node built-ins as its only dependencies, so a consumer repository can run it from a checkout;
with `--docker-image` it runs each program inside that container instead of on the host.

## Pinned CI toolchain

`.github/actions/render-manuscript/action.yml` is a composite action for consumer repositories. It pins
`actions/setup-node` by commit SHA and the toolchain by image digest
(`pandoc/latex:3.11.0.0-alpine@sha256:cdbf139f…`), derives `SOURCE_DATE_EPOCH` from the commit time, renders, and
writes the receipt:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: red-cup-engineering/computer-content-engineering-services-section/services/computer-documents-engineering-services-section/services/pandoc-engineering-services-section/services/project-document-through-pandoc-service/.github/actions/render-manuscript@<commit>
  with: { request: manuscript.request.json }
```

(The action path resolves inside the repository this directory lives in until the service is extracted to its own
repository.) The digest was read from Docker Hub for tag `3.11.0.0-alpine` and has not been exercised by these
tests, which ran against the host's pandoc; re-check it and the TeX packages your manuscript needs before relying on it.

## Offers

One held offer per operation is in `data/records/offers/` (`saleStatus: "held"`, validated with
`declareOffer` from `@red-cup-engineering/x402-services-section`). `rootDir` is caller authority over the host
filesystem, so the rendering offer must stay held until a content-carrying (inline files, sandboxed) variant exists.

## Reproducibility

Every invocation runs with `SOURCE_DATE_EPOCH=<sourceDateEpoch>`, `FORCE_SOURCE_DATE=1` and `TZ=UTC`, and no
`date` unless the caller asks for one (`date: "source-date-epoch"` renders the epoch's UTC date). `sourceDateEpoch` is
required: derive it from the manuscript's commit time (`git log -1 --format=%ct`). The plan labels each output
with the class it can honestly promise, and the receipt repeats it.

| format | class | what makes it so |
|---|---|---|
| `html`, `jats` | byte-identical for the same pandoc version | pandoc writes no timestamp unless `date` metadata is set. Citations and the bibliography are resolved by pandoc's own citeproc, deterministically. |
| `docx` | byte-identical for the same pandoc version, given `SOURCE_DATE_EPOCH` | `docProps/core.xml` created/modified and the zip entry times are taken from `SOURCE_DATE_EPOCH` (pandoc manual, "Reproducible builds"). A different epoch gives a different file. |
| `epub` | byte-identical for the same pandoc version, given `SOURCE_DATE_EPOCH` **and** an `identifier` in the metadata file | without `identifier`, pandoc mints a random UUID. Put `identifier:` (or `rights`/`date`) in `metadataFile`. |
| `pdf` | byte-identical only on a **pinned toolchain**: same pandoc, same TeX Live release, same installed fonts | see below. Not promised across machines with different TeX Live or fonts. |

### PDF through LaTeX

A LaTeX PDF carries four kinds of build-dependent bytes: the `/CreationDate` and `/ModDate`, the trailer `/ID`, the
producer and TeX Live banner strings, and the embedded fonts. What the renderer does about each:

- Dates and `\today`: `SOURCE_DATE_EPOCH` with `FORCE_SOURCE_DATE=1` makes pdfTeX, XeTeX (xdvipdfmx) and LuaTeX use the
  epoch for PDF dates and for `\today` (TeX Live 2019 or later). Without `FORCE_SOURCE_DATE=1` the epoch
  applies only to the PDF metadata, and `\today` still shows the build day.
- `pdflatex`: the generated header (`build/.reproducibility-pdflatex.tex`, passed with `--include-in-header`) sets
  `\pdfinfoomitdate=1` (no Info dates), `\pdftrailerid{}` (no `/ID`) and `\pdfsuppressptexinfo=-1` (no `PTEX.*` keys).
- `lualatex`: the header sets `\pdfvariable omitcidset=1` and `\pdfvariable suppressoptionalinfo` to a mask that omits
  every optional Info key and the trailer `/ID`.
- `xelatex`: dates follow `SOURCE_DATE_EPOCH`/`FORCE_SOURCE_DATE`, but xdvipdfmx draws the trailer `/ID` at random; the
  header pins it with `\AtBeginDocument{\special{pdf:trailerid [<00..00> <00..00>]}}`.
- Producer and fonts: the PDF names the engine and TeX Live release, and embeds subsetted fonts. Two machines with
  different TeX Live releases, or different system fonts under `xelatex`/`lualatex` (`fontspec`), produce different
  bytes by design. `observePandocToolchain` records the versions so a difference can be explained, and
  `requirePandocVersion` refuses a pandoc that is not the pinned one. The CI action pins the whole toolchain by
  image digest for this reason.
- `-V date=...`: `--variable=date:` / `--metadata=date:` only changes the title block, not the PDF Info dictionary; use
  it (or `date: "source-date-epoch"`) so a build does not print the build day.

### Measured (pandoc 3.1.3, TeX Live 2023/Debian, Node 24, one host, 2026-10-24)

Each row renders the 2-part, 2-entry-bibliography fixture in `test/fixtures/manuscript` twice, at least 2 seconds
apart, and compares the bytes (`test/integration.test.mjs` repeats these checks whenever pandoc is on `PATH`).

| output | result |
|---|---|
| html | identical across runs; also identical under a different `SOURCE_DATE_EPOCH` (nothing in it depends on time) |
| docx | identical across runs; **different** under a different `SOURCE_DATE_EPOCH` (the epoch is really stamped) |
| jats | identical across runs |
| epub | **different** across runs without an `identifier` (random UUID); identical with `--metadata=identifier:...` |
| pdf, `pdflatex` + generated header | identical across runs |
| pdf, `xelatex` without the trailer-id special | **different**: the only differing bytes were the XRef `/ID` |
| pdf, `xelatex` + generated header | identical across runs |
| pdf, `lualatex` + generated header | **not verified end to end**. The pandoc default template fails on this host before the header matters, because the OpenType Latin Modern fonts are not installed (`lmroman10-regular ... metric data not found`). On a plain LuaLaTeX article the header works: two runs were identical and the Info dictionary (Producer, Creator, dates, `PTEX.FullBanner`) and `/ID` were gone, while the same article without the header differed between runs. |

What this does not establish: reproducibility across machines (different TeX Live or fonts), pandoc versions other than
3.1.3, `lualatex` through pandoc's template, documents with images or custom fonts, or the container image the CI
action pins. Treat `pdf` as byte-reproducible only where the receipt's toolchain lines match.

## Math written as `\(x\)` and `\[x\]`

Pass `from: "markdown+tex_math_single_backslash"` in a manuscript request (the same reader the `publish-book`
`--math-single-backslash` option and `reader` of `planPandocDocumentProjection` select) for papers that write TeX math
with single backslashes.

## Single-document projection and archival `publish-book`

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
