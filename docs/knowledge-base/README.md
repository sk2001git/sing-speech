# Suara knowledge base: data format

Draft 1.0.0, 2026-09-14. For review with the owner before any collection pipeline is built.

Suara is a knowledge base of official answers, not a helpdesk. Every line a person sees is
tied to a verbatim quote from an official or configured source, so an entry can be checked
automatically with no human approval step.

## Files

| File | What it is |
|---|---|
| `entry.schema.json` | One answer or process. The unit a card shows and a guide walks |
| `publisher.schema.json` | One ministry, statutory board or configured source in the central registry |
| `examples/sg.moh.gpfirst-emergency-referral.json` | A real MOH entry, collected by hand for review |

## The shape of an entry

| Group | Fields | Why it exists |
|---|---|---|
| Identity | `id`, `kind`, `language`, `translation_of`, `schema_version` | Stable ids across re-collection; one language per entry |
| What a person sees first | `title.short` (16), `title.full` (60), `summary` (140) | Minimal first: one line in grid, one line in single view, one line read aloud |
| What opens on demand | `details[]`, `steps[]`, `action` | Detail layered behind the interface; processes walked and confirmed step by step |
| Finding it | `topic`, `audience`, `search.example_phrasings`, `search.keywords` | What a spoken request is matched against. Vectors live in the index, not the entry |
| Where it came from | `sources[]`, `quotes[]` | Every summary, detail, step and action cites `quote_refs`; every quote cites a source page |
| How it was made | `provenance.collected`, `provenance.structured` | Which method and model collected and structured it, and when |
| Whether it can be served | `verification.status`, `verification.checks[]` | Only `grounded` entries are served |
| Change | `lifecycle`, `sources[].content_hash`, `sources[].source_modified_at` | Detect a changed source; re-embed when served text changes |

Numbers in brackets are maximum characters.

## Grounding rules

An entry is `grounded` only when every check passes:

| Check | Passes when |
|---|---|
| `refs-resolve` | Every `quote_refs` id exists in `quotes`, and every quote's `source` exists in `sources` |
| `quotes-found` | Every quote's text appears verbatim in the source page's main text |
| `url-live` | Every source URL returns the page |
| `source-unchanged` | The page's `content_hash` matches, or its `source_modified_at` has not moved |
| `lengths` | Titles, summary and step names fit their one-line limits |

A failed `quotes-found` or `url-live` withdraws the entry. A changed source marks it
`stale` until it is re-collected.

## schema.org mapping

Chosen so entries can be exported as structured data without renaming.

| Suara | schema.org |
|---|---|
| `kind: "answer"` | `FAQPage` / `Question` with `acceptedAnswer` |
| `kind: "process"` | `HowTo` |
| `steps[].position`, `.name`, `.text` | `HowToStep.position`, `.name`, `.text` |
| `title.full` | `name` |
| `summary.text` | `abstract` |
| `language` | `inLanguage` |
| `sources[].publisher` | `publisher` |
| `sources[]` | `isBasedOn` |
| `quotes[]` | `citation` |
| `audience` | `audience` |
| `search.keywords` | `keywords` |
| `lifecycle.updated_at` | `dateModified` |
| `lifecycle.version` | `version` |

## Versioning

`schema_version` is exact. A change to a required field or an enum is a minor bump and
every stored entry is re-validated; a breaking change is a major bump with a migration.
