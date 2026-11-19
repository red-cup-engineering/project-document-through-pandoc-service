-- paper-declarations: render a paper.yaml's people, disclosures and declarations
-- into the document, so the printed title page and the citation metadata share
-- one source. Reads the fields of research-release-metadata-service's
-- paper.schema.json (authors, acknowledgements, ai-disclosure, funding, care,
-- license, repository-code) plus two render-only fields, `ethics` and
-- `conflicts-of-interest`. Declarations go before the section holding the
-- `#refs` bibliography div, or at the end when there is none.

local stringify = pandoc.utils.stringify

local function text_of(value)
  return value and stringify(value) or ""
end

local function person_name(person)
  if person.name then return stringify(person.name) end
  return text_of(person.given) .. " " .. text_of(person.family)
end

local function para(markdown)
  local first = pandoc.read(markdown, "markdown").blocks[1]
  return first and pandoc.Para(first.content) or pandoc.Para({})
end

-- YAML null arrives as an empty value; treat it as "not declared".
local function declared(value, fallback)
  local text = text_of(value)
  return text ~= "" and text or fallback
end

local function heading(level, text, identifier)
  return pandoc.Header(level, text, pandoc.Attr(identifier or "", {"unnumbered"}))
end

function Meta(meta)
  local authors = pandoc.List()
  for _, person in ipairs(meta.authors or {}) do
    local label = person_name(person)
    if person.affiliation then label = label .. " (" .. stringify(person.affiliation) .. ")" end
    authors:insert(pandoc.MetaInlines(pandoc.Inlines(label)))
  end
  if #authors > 0 then meta.author = pandoc.MetaList(authors) end
  if meta.version and not meta.date then
    meta.date = pandoc.MetaInlines(pandoc.Inlines("Version " .. stringify(meta.version) .. ", " .. text_of(meta.status)))
  end
  return meta
end

local function funding_text(funding)
  if type(funding) ~= "table" or #funding == 0 then return "None declared." end
  local parts = {}
  for _, grant in ipairs(funding) do
    local line = text_of(grant.funder)
    if text_of(grant.award) ~= "" then line = line .. ", award " .. stringify(grant.award) end
    table.insert(parts, line)
  end
  return table.concat(parts, "; ") .. "."
end

local function declarations(meta)
  local blocks = pandoc.List({heading(1, "Declarations", "declarations")})

  local credits = pandoc.List()
  for _, person in ipairs(meta.authors or {}) do
    local line = "**" .. person_name(person) .. "**, " .. text_of(person.role)
    if person.disclosure then line = line .. ". " .. stringify(person.disclosure) end
    credits:insert({para(line)})
  end
  for _, person in ipairs(meta.contributors or {}) do
    local line = "Contributor: **" .. person_name(person) .. "**, " .. text_of(person.role)
    if person.disclosure then line = line .. ". " .. stringify(person.disclosure) end
    credits:insert({para(line)})
  end
  for _, person in ipairs(meta.acknowledgements or {}) do
    credits:insert({para("Acknowledged: **" .. text_of(person.name) .. "**, " .. text_of(person.role) .. ".")})
  end
  blocks:insert(heading(2, "Authorship and AI disclosure"))
  if #credits > 0 then blocks:insert(pandoc.BulletList(credits)) end
  local ai = meta["ai-disclosure"]
  if ai then blocks:insert(para(text_of(ai.statement or ai))) end

  for _, section in ipairs({
    {"Ethics", declared(meta.ethics, "Not declared.")},
    {"Funding", funding_text(meta.funding)},
    {"Conflicts of interest", declared(meta["conflicts-of-interest"], "None declared.")},
  }) do
    blocks:insert(heading(2, section[1]))
    blocks:insert(para(section[2]))
  end

  if meta.care then
    blocks:insert(heading(2, "Indigenous data governance (CARE)"))
    local items = pandoc.List()
    for _, key in ipairs({"collective-benefit", "authority-to-control", "responsibility", "ethics"}) do
      if meta.care[key] then items:insert({para("**" .. key:gsub("-", " ") .. ".** " .. stringify(meta.care[key]))}) end
    end
    blocks:insert(pandoc.BulletList(items))
  end

  if meta.license then
    local terms = {}
    for _, kind in ipairs({"text", "data", "code"}) do
      if meta.license[kind] then table.insert(terms, kind .. " " .. stringify(meta.license[kind])) end
    end
    local line = "Licenses: " .. table.concat(terms, ", ") .. "."
    if meta["repository-code"] then line = "Source, records and build provenance: " .. stringify(meta["repository-code"]) .. ". " .. line end
    if meta.license.scope then line = line .. " " .. stringify(meta.license.scope) end
    blocks:insert(heading(2, "Data and code availability"))
    blocks:insert(para(line))
  end
  return blocks
end

local function holds_refs(block)
  local found = false
  if block.t == "Div" and block.identifier == "refs" then return true end
  pandoc.walk_block(block, {Div = function(div) if div.identifier == "refs" then found = true end end})
  return found
end

function Pandoc(doc)
  local inserted = declarations(doc.meta)
  local refs_at
  for index, block in ipairs(doc.blocks) do
    if holds_refs(block) then refs_at = index break end
  end
  if not refs_at then
    doc.blocks:extend(inserted)
    return doc
  end
  -- Step back to the heading that opens the bibliography's section.
  local at = refs_at
  while at > 1 and doc.blocks[at].t ~= "Header" do at = at - 1 end
  local out = pandoc.List()
  for index, block in ipairs(doc.blocks) do
    if index == at then out:extend(inserted) end
    out:insert(block)
  end
  return pandoc.Pandoc(out, doc.meta)
end
