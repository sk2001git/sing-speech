# Suara knowledge base: data format

1.1.0, 2026-09-15. Adds Chinese translations made on need ([[dec-suara-0012]] in the vault).

Suara is a knowledge base of official answers, not a helpdesk. Every line a person sees is
tied to a verbatim quote from an official or configured source, so an entry can be checked
automatically with no human approval step.

## Files

| File | What it is |
|---|---|
| `entry.schema.json` | One answer or process. The unit a card shows and a guide walks |
| `publisher.schema.json` | One ministry, statutory board or configured source in the central registry |
| `examples/sg.moh.gpfirst-emergency-referral.json` | A real MOH entry, collected by hand for review |

`src/lib/kb/entry.ts` is the runtime copy of `entry.schema.json`, because JSON Schema
compilers generate code at runtime and Cloudflare Workers forbid that. `entry.test.ts`
runs the same valid and invalid entries through both and fails if they disagree.

## The shape of an entry

| Group | Fields | Why it exists |
|---|---|---|
| Identity | `id`, `kind`, `language`, `schema_version` | Stable ids across re-collection; one language per stored entry |
| Languages | `translation_of`, `translations` | A translation names the original version it came from; an original lists its translations, so a reader's language is checked from one entry |
| What a person sees first | `title.short` (16), `title.full` (60), `summary` (140) | Minimal first: one line in grid, one line in single view, one line read aloud |
| What opens on demand | `details[]`, `steps[]`, `action` | Detail layered behind the interface; processes walked and confirmed step by step |
| Finding it | `topic`, `audience`, `search.example_phrasings`, `search.keywords` | What a spoken request is matched against. Vectors live in the index, not the entry |
| Where it came from | `sources[]`, `quotes[]` | Every summary, detail, step and action cites `quote_refs`; every quote cites a source page |
| How it was made | `provenance.collected`, `provenance.structured`, `provenance.translated` | Which method and model collected, structured and translated it, and when |
| Whether it can be served | `verification.status`, `verification.checks[]` | Only `grounded` entries are served |
| Change | `lifecycle`, `sources[].content_hash`, `sources[].source_modified_at` | Detect a changed source; re-embed when served text changes |

Numbers in brackets are maximum characters.

## Translations

An entry is stored under `(id, language)`. English originals are collected; Chinese
versions are made the first time a Chinese reader needs one.

On the original:

```json
"translation_of": null,
"translations": {
  "zh-Hans": { "from_version": 1, "at": "2026-09-15T08:00:00Z" }
}
```

On the translation:

```json
"id": "sg.moh.gpfirst-emergency-referral",
"language": "zh-Hans",
"translation_of": { "id": "sg.moh.gpfirst-emergency-referral", "version": 1 },
"provenance": {
  "collected":  { "method": "manual", "model": null, "at": "2026-09-13T15:50:00Z" },
  "structured": { "method": "manual", "model": null, "prompt_version": null, "at": "2026-09-14T00:00:00Z" },
  "translated": { "method": "model", "model": "thinkingmachines/inkling:free", "prompt_version": "translate-1", "at": "2026-09-15T08:00:00Z" }
}
```

| Rule | Why |
|---|---|
| A translation is needed when `translations[lang]` is missing or its `from_version` is behind `lifecycle.version` | One read decides it; a changed original makes its translations out of date automatically |
| `quotes` and `sources` are copied unchanged, in the source language | The evidence stays checkable against the page |
| `quote_refs`, step positions, detail count and `kind` must match the original | A translation that drops a step or re-cites a line is not the same answer |
| `provenance.translated.model` is the model that served the reply | Rotation may fall back; the record says which model's words these are |
| Only translations have `provenance.translated`; only originals have `translations` | Enforced by the schema |

## Grounding rules

An entry is `grounded` only when every check passes:

| Check | Passes when |
|---|---|
| `refs-resolve` | Every `quote_refs` id exists in `quotes`, and every quote's `source` exists in `sources` |
| `quotes-found` | Every quote's text appears verbatim in the source page's main text, ignoring differences in whitespace |
| `url-live` | Every source URL returns the page |
| `source-unchanged` | The page's `content_hash` matches, or its `source_modified_at` has not moved |
| `lengths` | Titles, summary and step names fit their one-line limits |
| `translation-matches-original` | Translations only: same id, a different language, the original's current version, identical quotes and sources, and the same structure |

A failed `quotes-found` or `url-live` withdraws the entry. A changed source marks it
`stale` until it is re-collected. A translation behind its original is not served; the
reader sees the English entry, labelled, until it is re-translated.

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
| `translation_of` | `translationOfWork` |
| `translations` | `workTranslation` |
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

| Version | Date | Change |
|---|---|---|
| 1.1.0 | 2026-09-15 | `translation_of` becomes `{id, version}`; adds `translations`, `provenance.translated`, check `translation-matches-original` |
| 1.0.0 | 2026-09-14 | First draft |
