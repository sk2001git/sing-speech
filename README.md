# suara

Voice-first access to Singapore government services, for elderly users who cannot use a
website or an app.

Someone speaks in whatever language or dialect they actually speak. The system works out
which of six services they need, reads back what it understood, and asks them to confirm
before anything happens. Nothing is typed.

## What makes this different from a transcription app

**There is no transcript.** The audio goes to a reasoning model, and what comes back is
an intent with a confidence score. Look at `src/lib/understanding.ts` — there is no field
for a transcript, deliberately.

That is not a stylistic choice. The best available model for this population reports 46%
word error rate on Hokkien, 26% on Tamil and 23% on code-switched Singlish. At those
rates a transcript is not usable as content, and every stage downstream of it inherits
the corruption with no way to recover — the waveform that could have disambiguated is
already gone. Selecting one of six distinctive intents tolerates far more noise than
reconstructing a sentence, so that is what the system does.

It also costs about the same. Audio bills at 32 tokens per second, so a minute of speech
is roughly $0.0006 on a cheap audio model — between Cloudflare Whisper and Groq, and it
returns understanding rather than a string that still needs a second model to interpret.

## The rules the code enforces

**Never act on a guess.** `src/lib/policy.ts` holds the thresholds in one place. Above
0.85 confidence it acts and reads back; between 0.6 and 0.85 it asks a single yes/no
question about its best guess; below 0.6 it asks for a repeat with a concrete example;
twice below 0.6 in a row it hands off to a person. There is a test asserting nothing acts
below the threshold at any confidence in the band.

**Ask yes/no, never "did you mean A or B".** Offering two options makes the user hold
both in working memory and choose, which is the exact cognitive load this exists to
remove. A yes/no question is answerable in one syllable in any language, or by pressing
one of two buttons.

**Audio enters the context once.** Audio is roughly 13x denser than the words it
carries, so replaying a session's audio each turn would multiply the bill by the length
of the conversation. What persists across turns is the structured result. `TurnContext`
has no field audio could go in.

**No voice-activity detection anywhere.** Tap to start, tap to stop. Elderly speakers
pause mid-sentence for longer than any silence threshold expects, and a system that cuts
them off is the worst failure this product has. The user decides when they have finished.

## Swapping models

Everything above `VoiceProvider` (`src/lib/providers/types.ts`) deals in `Understanding`
and knows nothing about any vendor. Adding a model means adding a file and a case in the
registry.

The `price` field on a provider is not documentation — the cost harness reads it, so
adding a provider automatically prices it. Record the date you checked when you set it.

`FakeProvider` is the most important one: it makes the whole suite runnable with no API
key, no network and no spend, and it proves the seam is real. If something upstream
cannot be driven by the fake, that code has a vendor assumption baked into it.

## Running it

```bash
npm install
cp .env.example .env      # add GEMINI_API_KEY
npm run dev
```

Verification, all of which must pass:

```bash
npm run verify            # typecheck, build, tests
```

Deploy:

```bash
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

## Verified end to end

Run against the live APIs on 2026-09-08 with real synthesised speech, not fixtures:

| Utterance | Audio model | Transcript | Agreement | Decision |
|---|---|---|---|---|
| "I need help paying for the doctor. The medicine is too expensive." | `chas_subsidy` 0.95 | transcribed correctly | agreed | act |
| "Which bus number should I take to go there?" | `wayfinding` 0.95 | agreed | agreed | act |
| "I want to talk to a real person please." | `human_handoff` 1.0 | correct | no-signal | handoff |
| "Ah... the thing, you know. My paper. I don't know lah." | `human_handoff` 0.4 | "I don't know **law**" | no-signal | handoff |

1.76s for a full turn, both channels running concurrently.

The last row is the design working as intended in miniature. Whisper heard Singlish
"lah" as "law", the cue matcher found nothing, and rather than manufacture a false
disagreement it reported no signal — while the audio model, hearing the hesitation
rather than reading the mangled words, correctly routed to a human.

## Speech out is the unsolved half

Understanding dialect speech is handled. Speaking it back is not, and that is the
harder problem.

Android and iOS ship no Hokkien or Teochew voice, so the on-device synthesis this
depends on covers English, Mandarin, Malay and Tamil and stops there. No commercial TTS
API sells Hokkien either. The system therefore understands a Hokkien-speaking
eighty-year-old and answers in a language they may not read — failing precisely the
users it exists for.

The one available path is `MERaLiON/MERaLiON-OmniVoice-Hokkien-TTS`: 0.8B parameters,
2.7GB, fp16, Chinese characters in and 24kHz WAV out. It takes arbitrary text rather
than a fixed phrase list, so it works with model-generated replies. There is no hosted
API, but at that size it runs on a cheap always-on CPU box rather than a GPU — a fixed
monthly cost that serves every dialect user.

Replies are generated per turn rather than authored from a fixed set. That is a
deliberate trade: it costs roughly $6 more per month per thousand users and puts
unreviewed Tamil and Malay in front of users, and it buys replies that answer what the
person actually said rather than what category they fall into.

### Where the budget lands

| Line | 1000 users |
|---|---|
| Audio in and understanding | ~$2.30 |
| Generated replies, 3.5 Flash-Lite output | ~$6 |
| Dialect TTS box, fixed | ~$8 |
| **Total** | **~$16-17/mo** |

Over the $10 target at exactly a thousand users, and under it from roughly 2,500
onward, because the TTS box is a fixed cost that does not grow. The levers if $10 must
hold at 1000: author the replies instead of generating them, halve the 400-character
cap, or give dialect speakers Mandarin audio alongside text in their own language.

## Not built yet

Named here so nobody assumes otherwise:

- **Dialect speech output.** See above. The largest known gap.
- **The profile vault.** `screenFor` returns an empty `facts` array. The "don't ask,
  fetch" half of the product does not exist yet — the schema is meant to mirror Myinfo's
  fields so that Myinfo later becomes a second implementation of one interface.
- **The intent eval.** The claim that intent survives where transcription fails is
  untested. It needs recorded utterances across the languages and a per-language accuracy
  number. Until that exists, the central premise is a hypothesis.
- **The cost harness.** The provider `price` fields are wired for it but nothing reads
  them yet.
- **Myinfo.** Out of scope for v1 on purpose: private-sector access is gated behind
  Singpass onboarding, and v1 is informational only, so it needs no write access.

## Design

The interface is one screen with one question and one action. No borders, no dividers,
no cards — structure is carried by size and space alone. Text is left-aligned because
centred text moves the left edge, which is measurably harder for low-vision readers.
Actions sit in the bottom thumb zone at 72px minimum. Colour carries state: teal means
ready, red means the microphone is open.

No webfont. On mobile data on an old phone, a flash of invisible text is a real cost to
this audience, and it outranks having a distinctive typeface.
