# MiniMax H3 Video Prompt Engineering & Reference Guide (Updated)

Authoritative, deduplicated knowledge base for **writing syntax-valid MiniMax H3 prompts** across **T2VA**, **I2VA**, **FL2VA**, **L2VA**, and **REF2VA**. Optimized for AnythingLLM RAG retrieval.

**Scope:** prompting only — modes, headers, fields, camera/dialogue grammar, REF2VA structure, consistency patterns, LLM compilers, QA.  
**Out of scope (separate RAG later):** ComfyUI workflows/nodes, Extender chaining, LoRA training.

**Sources consolidated:** official MiniMax base/ref guides, prior prompting RAG, DomoAI / SuperMaker / ArtRealm / promptslove / graphicdesigngeek notes, filtered technical content from community transcripts.

---

## 1. System Overview

MiniMax H3 is a ~33B single-stream Omni Transformer that jointly processes text, images, video, and audio and generates video with **native synchronized 32 kHz stereo audio** in one forward pass. Text conditioning is strong (Qwen3-VL-class instruction following); short vague prompts under-specify the timeline.

### Core principles

| Principle | Rule |
| --- | --- |
| Observable Reality | Every clause describes visible or audible phenomena. No abstract emotion without physical manifestation. |
| Structured Format | Model is trained on labeled fields and shot markers. Wrong/missing headers degrade output. |
| No bracket camera tags | `[Push in]`, `[Truck left]`, etc. are deprecated (Hailuo 02 era). Camera moves are natural English inside the shot. Square brackets are for `[Shot N]` and task prefixes only. |
| Causal motion | Actions: onset → development → settlement. |
| H3-Context-IR | Hosted MiniMax may rewrite casual prompts into structured form (not open-sourced). Direct / local base APIs: **you** must write the structured format. |

---

## 2. Operational Specs & Limits

| Parameter | Spec |
| --- | --- |
| Duration | **4–15 s** whole seconds (default often 5; some hosts min 5) |
| Frame rate | **24 fps** fixed |
| Audio | **32 kHz stereo**, co-generated |
| Resolution tiers | **768P** or **2K** (2K ≈ 1440 short edge; e.g. 2560×1440 @ 16:9). No separate 1080p/4K tier. |
| Aspect ratios | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16; T2VA needs an explicit ratio; I2VA/FL2VA/L2VA follow source image |
| Prompt length | Model ~**7000** chars; some APIs (e.g. fal) ~**2000** — condense without losing dialogue |
| Languages (dialogue/lip-sync) | Arabic, Chinese, English, French, German, Italian, Japanese, Korean, Portuguese, Russian, Spanish |
| Speech budget | ~**2.5 words/sec** (10 s ≈ 20–25 words) |
| REF2VA assets | Up to **9 images**, **3 videos**, **3 audio**; **max 12** total; reference video clips typically 2–15 s |
| Mutual exclusivity | Frame-led I2VA/FL2VA/L2VA vs full REF2VA — do not mix modes |
| Hosted API knobs | Often: model, content, resolution, duration, ratio. Usually **no** seed / negative-prompt / CFG / steps (guidance-distilled). Prose negatives still work inside the prompt. |
| Image dims (VAE) | Width and height **divisible by 32** |

---

## 3. Mode Selection

| Mode | Inputs | First line | Body format | Best for |
| --- | --- | --- | --- | --- |
| **T2VA** | Text only | *(none)* | 3 fields | New audiovisual idea from text |
| **I2VA** | `<Picture 1>` first frame | I2VA alignment header | 3 fields | Animate a prepared opening |
| **FL2VA** | Picture 1 + Picture 2 | FL2VA alignment header | 3 fields | Controlled open→close path |
| **L2VA** | `<Picture 1>` last frame | L2VA alignment header | 3 fields | Ending-first reveal / converge |
| **REF2VA** | Up to 12 mixed refs | *(no base alignment line)* | **6 sections** | Identity, motion transfer, edit, continuation, audio reuse |

Choose mode from available media — not from which acronym sounds advanced.

---

## 4. Base Mode: Alignment Headers + Three Fields

Instruction line 1 (if any) → **exactly one blank line** → three fields.

### 4.1 Alignment headers (exact strings)

**I2VA:**
```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

**FL2VA:**
```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

**L2VA:**
```text
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

`N` = final shot index. `S.SS` = clip duration to **two decimals** (`5.00`, `8.00`, `10.00`).

### 4.2 Three core fields

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

| Field | Contains | Must not contain |
| --- | --- | --- |
| `integrated_multimodal_description` | Style, subjects, actions, camera, cuts, dialogue/singing, diegetic sound, on-screen text | Audience-only score dump |
| `overall_soundscape` | Room tone, ambience, Foley, non-verbal vocals (1–4 EN sentences) | Full dialogue; full score |
| `non_diegetic_music` | Audience-only instruments/tempo/dynamics (1–3 EN sentences) or `N/A` | Diegetic radio/band (those stay in timeline) |

`overall_soundscape: N/A` only for intentional total silence. `non_diegetic_music: N/A` whenever no score is wanted (required — do not omit).

### 4.3 Keyframe path patterns

| Mode | Structure |
| --- | --- |
| I2VA | First-frame anchor → action onset → continuous development → result. Preserve identity/clothing/layout from `<Picture 1>`. |
| FL2VA | First-frame state → observable intermediate changes → narrowing differences → last-frame state. Prefer **one shot**. |
| L2VA | Plausible preceding state → transition path → gradual convergence → last-frame landing on `<Picture 1>` in final shot. |

Do not re-describe two static keyframes; describe the **motion path** between them.

---

## 5. Shots, Timing, Camera Grammar

### 5.1 Shots and cuts

- `[Shot 1]` **never** has a timestamp.
- Later shots: `[Shot 2] At 00:03.500, the camera cuts to...` — times strictly increasing and inside duration (`MM:SS.mmm`).
- Cut connectors: `the camera cuts to`, `the shot cuts to`, `the shot transitions to`, `the shot changes to`, `the shot switches to`. Cross-dissolve / fade / wipe only if user requests.
- Cut only for new subject/space/state/viewpoint/time. Distance/slight angle → camera motion, not a new shot.
- Inside one shot, use prose (“halfway through the shot”), not fake cut timestamps.
- Pacing budget: ~**1 cut / 3 s**; prefer 3–4 clear shots in 15 s over 6–7 rushed events.

### 5.2 Camera = Motion Type + Amplitude + Speed

Write as natural English inside the shot. Omit medium amplitude / normal speed.

```text
The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.
The camera pans right with large amplitude at fast speed, revealing the open doorway.
The camera holds a static shot as the runner exits the frame.
```

| Dimension | Terms |
| --- | --- |
| Motion | Zoom In/Out · Push In/Pull Out · Pan Left/Right · Truck Left/Right · Tilt Up/Down · Pedestal Up/Down · Arc Shot · Tracking Shot · Static Shot · Shake Slightly/Strongly · POV · Roll Clockwise/Counterclockwise |
| Amplitude | `with small amplitude` · `with large amplitude` |
| Speed | `at slow speed` · `at fast speed` |

**Anti-drift:** Without an explicit static hold, the camera often drifts. Prefer `The camera holds a static shot as...`.

**Cinematography vocabulary (framing):** wide / medium / close-up / extreme close-up / macro · shallow DoF · rack focus · film grain · highlight halation · side orbit (as natural English, not bracket tags).

---

## 6. Dialogue, Speakers, Visible Text, Audio Layers

### 6.1 Speakers and `<d>` tags

- Stable IDs `(S1)`, `(S2)`, … in order of first vocal event; reuse across shots. Silent characters get no ID. Choral: `(S1,S2)`.
- On first appearance: type, age, gender, on/off-screen, pitch, timbre, rate, accent.
- Identifying phrase, ID, action, delivery **outside** `<d>`. Inside: language tag + **verbatim** words only.

```text
The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
The two children (S1,S2) shout together, <d>[English] Wait for us!</d>
```

### 6.2 Voiceover / closed lips / lip stop

```text
The man (S1) says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.
```

After on-screen dialogue ends cleanly:
```text
Her lips stop moving immediately after the last word. She listens in silence.
```

### 6.3 Dialogue across cuts

Use `<scenetrans>` at both join points; state continuity (`continues seamlessly across the cut`, `carries over from the previous shot`). Use `<cutoff>` when speech is truncated by video end.

### 6.4 On-screen text

Visible signs/labels/UI/neon: English double quotes, verbatim, untranslated:

```text
A red neon sign reading "OPEN LATE" glows above the doorway.
A perfume bottle with a cream label reading "NORTHLINE" sits on the plinth.
```

### 6.5 Four audio jobs

| Job | Where |
| --- | --- |
| Dialogue / singing | Timeline + `<d>` |
| Synchronized event (click, impact) | Current shot in timeline |
| Ambience / Foley / non-verbal | `overall_soundscape` |
| Audience-only score | `non_diegetic_music` |

---

## 7. Canonical Base Examples

### 7.1 T2VA

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) places a fresh loaf on the wooden counter and says: <d>[English] First batch of the morning.</d> [Shot 2] At 00:05.000, the camera cuts to a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot.

overall_soundscape: Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell rings once, followed by light footsteps and the crisp sound of bread being sliced.

non_diegetic_music: A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes and a gentle fade at the end.
```

### 7.2 I2VA

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the young woman shown in <Picture 1> remains beside the rain-covered train window, preserving her appearance, clothing, seat position, and the carriage layout. The camera trucks right with small amplitude at slow speed as she lifts her gaze from the folded letter toward the passing city lights. Her reflection moves across the glass while the quiet, breathy young woman (S1) says: <d>[English] I get off at the next station.</d> She folds the letter along its existing crease.

overall_soundscape: The train wheels produce a steady metallic rhythm beneath a low ventilation hum. Rain ticks against the window while paper rustles softly in her hands.

non_diegetic_music: Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.
```

### 7.3 FL2VA (8.00 s single shot)

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a rain-soaked cyclist begins in the position and framing established by Picture 1, holding a closed black umbrella beside a silver bicycle. The camera pulls out with small amplitude at slow speed as she releases the bicycle handle, raises the umbrella above her shoulder, and presses the runner upward until the canopy opens. Water rolls from the expanding fabric while she steps beneath it, rotates the handle into the final angle, and settles into the pose, spacing, and composition established by Picture 2 at the end of the shot.

overall_soundscape: Rain falls steadily on the pavement, followed by the metallic click of the umbrella runner and the soft snap of the canopy opening. Water drips from the bicycle frame as distant traffic passes.

non_diegetic_music: N/A
```

### 7.4 L2VA (6.00 s — official glass break)

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 6.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a close shot begins with an intact drinking glass near the edge of a dark wooden table, while the same hand and sleeve visible in <Picture 1> approach from the right. The camera pushes in with small amplitude at slow speed as the fingertips strike the rim. The glass tips, falls, and hits the floor with a sharp impact; cracks spread through it as fragments slide outward. Toward the end, the moving pieces lose momentum and settle into the exact broken arrangement, hand position, camera angle, lighting, and final composition established by <Picture 1>.

overall_soundscape: Fingertips tap the glass before it scrapes across the tabletop, falls, and breaks with a sharp crash. Small fragments scatter and gradually stop sliding across the floor.

non_diegetic_music: A low electronic pulse at a slow tempo, ending immediately after the glass breaks.
```

### 7.5 L2VA product converge (8.00 s)

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic product film. An empty wet black-basalt plinth fills the foreground inside a dark greenhouse before sunrise. The camera pulls out with small amplitude at slow speed. From the left, a square amber-glass perfume bottle, matte-black cap, cream label reading "NORTHLINE" slides smoothly onto the plinth and slows as it reaches center. Cold blue light from the right changes gradually to a narrow amber beam from the left. Water beads become visible on the bottle. During the final two seconds, every moving element comes to rest. The object placement, scale, camera view, reflections, label direction, fern shadows, and illumination now match <Picture 1>. No extra bottle, label, subtitle, or watermark appears.

overall_soundscape: Rain taps the greenhouse roof while glass slides softly over wet stone. The sliding sound slows and stops as one final drop strikes the plinth.

non_diegetic_music: Four muted glass harmonics sound at even intervals. The fourth ends as the bottle stops moving.
```

---

## 8. REF2VA / Full-Reference (Six Sections)

```text
subject_definitions: ...

summary: ...

retention_analysis: ...

detailed_description: ...

overall_soundscape: ...

non_diegetic_music: ...
```

Write all six sections in English. Preserve original language only inside `<d>` and for visible on-screen text.

### 8.1 Labels

| Label | Meaning |
| --- | --- |
| `<Subject N>` | Reusable visible content unit (person, prop, scene, style, pose…) used in the target — not the file itself |
| `<Picture N>` | Image as concrete first/key/last/edited frame or storyboard/composition anchor |
| `<Video N>` | Whole-video relationship: edit source, continuation start, or camera/cut/rhythm structure |
| `<Audio N>` | Standalone audio or enabled sync track: copy, timbre, BGM style, lyrics, beat |

Rules:
- One subject may come from multiple assets; one asset may yield multiple subjects.
- If Picture/Video only sources another subject and is not used alone later, cite it **inside** that subject’s definition (no separate line).
- People/objects from a video are still `<Subject N>`; `<Video N>` is structure/asset.
- Ordinary video does **not** auto-create `<Audio N>` just because it has sound.
- `<Video N>` and `<Audio N>` indices are **independent** (same source can be Video 1 + Audio 2).
- Labels keep meaning across all six sections.

```text
<Subject 1> is the young woman in <Picture 1>, with long dark hair, a blue cardigan, and a thin silver necklace.
<Subject 1> is the woman whose appearance comes from <Picture 1> and whose walking motion comes from <Video 1>.
<Picture 2> is the first frame of [Shot 1], showing a woman seated beside a café window.
<Picture 3> is a storyboard reference for [Shot 1] and [Shot 2], defining viewpoint, subject placement, and shot order.
<Video 1> is the source video for the target video edit.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).
```

### 8.2 `summary` task prefixes

| Prefix | When |
| --- | --- |
| `[keyframe completion]` | Image is concrete first/key/last/edited frame anchor |
| `[reference generation]` | Asset guides identity/style/motion/storyboard without being locked frame or edit/continue source |
| `[video editing]` | Source video directly modified → body must start: `The target video is an edited version of <Video 1>.` |
| `[video continuation]` | Extends/resumes from source video |
| `[audio reuse]` | Same audio signal copied in full or part |
| `[audio reference]` | Timbre/style/rhythm/texture referenced, not copied |

Combine with ` + ` without repeating types. Presence of video/audio alone does **not** force a prefix — motion-only video → `[reference generation]`.

### 8.3 `retention_analysis`

One line per declared label. **Never** write `(Sx)` here.

**Visual:** `fully_preserved` · `partially_preserved` · `attribute_transfer` · `weak_reference`  
**Audio:** `fully_copy` · `partially_copy` · `reference` · `weak_reference`

```text
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - facial features and clothing remain unchanged.
<Picture 2> ([Shot 1] first frame): fully_preserved - exact opening composition and lighting.
<Video 1> (cut and pacing structure): weak_reference - references pacing without copying footage.
<Audio 1>: fully_copy - <Audio 1> is reused 1:1 as the target video's complete final audio track.
<Audio 2>: reference - the target speaker follows <Audio 2>'s voice timbre without copying the signal.
```

### 8.4 `detailed_description`

- Style: **1–2 English sentences before `[Shot 1]`** (unlike base mode).
- Shot grammar, camera, speakers, `<d>`, text quotes: same as base.
- Insert labels at first use and wherever roles apply; do not redefine.
- Frame anchors: `the shot begins from <Picture 1>` · `the shot's keyframe corresponds to <Picture 2>` · `the shot ends on <Picture 3>`.
- Speaking subject: `<Subject N> (Sx) ...`
- Verbal cue only inside reused BGM with no independent speaker → cite `<Audio N>`, do **not** invent `(Sx)`.
- Reused lyrics/dialogue: verbatim + original language; unintelligible → `[unclear]`; clean punctuation to `, . ? !`.
- Length: generation tasks typically **350–500** English words; dialogue-dense prioritizes full spoken timeline; edits scale with source complexity.

### 8.5 Job-only reference pattern (avoid identity wash)

Do **not** re-pixel-describe references when the job is lock/transfer:

```text
Image 1 defines CharacterName identity — do not redesign face, hair, or proportions.
Image 2 defines wardrobe only.
Video 1: camera motion and cut rhythm only — do not copy people or location.
Audio 1: voice-timbre reference for CharacterName — do not copy the signal.
```

Then express the same binding formally in `subject_definitions` + `retention_analysis`.

### 8.6 Canonical REF2VA example (official sitcom)

```text
subject_definitions:
<Subject 1> is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table.
<Subject 2> is the fluffy white Samoyed in <Picture 2>, <Picture 3>, and <Picture 4>, with thick white fur, pointed ears, a dark nose, and a curved tail.
<Subject 3> is the young blonde woman in <Video 1>, with long blonde hair and a light-pink button-down shirt with rolled-up sleeves.
<Subject 4> is the young man in <Video 2>, with short wavy brown hair and a dark-grey hoodie with drawstrings.
<Audio 1> is the voice-timbre reference for <Subject 3> (S1), containing a spoken English vocal layer.

summary:
[reference generation + audio reference] The target video shows <Subject 3> eating a cookie in <Subject 1>. <Subject 4> enters with <Subject 2>, which lunges toward the cookie. The three-shot exchange uses <Audio 1> as the voice-timbre reference for <Subject 3> and ends with a canned audience laugh.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table are retained.
<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - the Samoyed's thick white fur, pointed ears, dark nose, and curved tail are retained.
<Subject 3> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the blonde woman's identity, long hair, and light-pink shirt are retained.
<Subject 4> (appears in [Shot 1], [Shot 2]): fully_preserved - the young man's short wavy brown hair and dark-grey hoodie are retained.
<Audio 1>: reference - its vocal timbre guides the dialogue delivery of <Subject 3> without copying the original signal.

detailed_description:
The target video uses a realistic multi-camera sitcom style with warm indoor lighting.
[Shot 1] A medium shot establishes <Subject 1>, the coffee shop with its exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table. <Subject 3> (S1), the young woman with long blonde hair and a light-pink button-down shirt with rolled-up sleeves, sits on the sofa holding a chocolate-chip cookie. From the left, <Subject 4>, the young man with short wavy brown hair and a dark-grey hoodie with drawstrings, enters holding the leash of <Subject 2>, the thick-furred white Samoyed with pointed ears, a dark nose, and a curved tail. The dog lunges toward the cookie and pulls the leash taut. <Subject 3> (S1) jerks her hand back and, using the clear youthful voice timbre referenced from <Audio 1>, exclaims with light annoyance, <d>[English] Hey! Watch your dog!</d> She closes her lips and guards the cookie while <Subject 4> pulls the dog back.
[Shot 2] At 00:03.000, the shot cuts to a close-up of <Subject 4> (S2), the young man in the dark-grey hoodie from Shot 1, sitting beside <Subject 3> on the sofa and holding <Subject 2> securely in his arms. <Subject 4> (S2) says in a casual young male voice with a playful tone and an easy conversational pace, <d>[English] He just likes cookies more than me.</d> He closes his mouth into an apologetic smile and strokes the dog's thick white fur.
[Shot 3] At 00:05.000, the shot cuts to a close-up of <Subject 3> (S1), the blonde woman in the light-pink shirt from Shot 1. Her annoyance softens as she looks toward the Samoyed. <Subject 3> (S1) replies in the same clear youthful voice referenced from <Audio 1> with an amused cadence, <d>[English] Well, he has good taste at least.</d> She smiles and raises the cookie in a small toast-like gesture. A classic canned audience laugh begins immediately after the line and continues through the final frame.

overall_soundscape:
Soft indoor coffee-shop room tone continues throughout the scene.

non_diegetic_music:
N/A
```

---

## 9. Consistency Blocks & Production Patterns

### 9.1 Character identity lock

List non-negotiable traits; require same person across shot sizes:

```text
Strictly preserve the character's identity throughout the video.
Keep the same oval face shape, deep brown eyes, shoulder-length black wavy hair, small beauty mark beneath the left eye, natural skin tone, beige trench coat, and silver earrings.
Do not change age, facial proportions, eye color, hairstyle length, clothing colors, body proportions, or accessories.
Close-ups, medium shots, and wide shots must show the same individual.
Do not introduce identity drift, facial flickering, duplicated limbs, malformed hands, or additional people.
```

Native recognition: naming known anime/game/pop-culture characters alongside refs often improves anchoring.

### 9.2 Product consistency lock

```text
Strictly preserve the product design throughout every shot.
Keep the same rectangular bottle silhouette, thick transparent glass edges, amber liquid, liquid level, gold cylindrical cap, label structure, proportions, and materials.
Do not change bottle dimensions, glass thickness, liquid color, cap size, packaging text, typography, label position, or logo placement.
The product must not be redesigned while rotating, during camera movement, or when lighting changes.
No extra products, hands, flowers, subtitles, watermarks, melting edges, warped geometry, or garbled text.
```

Repeat the locked product noun phrase verbatim across shots (e.g. `square amber-glass perfume bottle, matte-black cap, cream label reading "NORTHLINE"`).

### 9.3 Specific negatives (prose)

Vague “keep consistent” fails. Prefer:

```text
Do not add subtitles, watermarks, garbled text, extra people, duplicate objects, sudden jumps, flickering, liquid transitions, or unrelated elements.
No soft dissolves or fluid morphs.
```

### 9.4 Correction line (post-drift)

```text
Preserve exactly the same [subject] and the same [object] from the reference image.
Correct only: [single failing element].
```

### 9.5 Timed audio design (map into fields)

Plan audio over time, then place dialogue/events in the timeline, ambience in `overall_soundscape`, score in `non_diegetic_music`:

```text
[0–3s] light wind + distant traffic under restrained low tone
[At 8s] one short low-frequency impact on the turn
[13–15s] music reduces to one sustained low note + quiet ambience
```

### 9.6 Video editing / continuation phrasing (REF2VA)

```text
[video editing] The target video is an edited version of <Video 1>.
Replace the green-screen background with a beach at sunset. Match background parallax to original camera. Preserve identity, clothing, actions, camera move, and editing rhythm. Relight subject to match sunset. Avoid green edges and compositing seams.
```

Stacked localized edits: list numbered changes + preserve rules for everything else.

Continuation:
```text
[video continuation] Target video is a seamless continuation of <Video 1>. First frame of [Shot 1] is the last frame of <Video 1>.
```

Action override without identity change:
```text
Same character and outfit as the reference. Change only the action: she turns toward the camera and takes one step forward.
```

### 9.7 Audio reuse guards

```text
Use Audio 1 only. Do not create a replacement song or add another soundtrack.
```

---

## 10. Two-Stage LLM Prompt Pipeline (local VLMs)

Small VLMs fail at one-shot full H3 prompts (split-screen hallucination, conversational filler). Split perception from synthesis:

```
[Images] → Stage 1 Vision (facts only) → Stage 2 Text LLM → Valid H3 prompt
```

**Stage 1 system:**
```text
You are an objective visual observer. You are analyzing two sequential frames from the same video in the same room.
State clearly and factually:
1. The subject's starting pose, clothing, and camera angle in Frame 1.
2. The subject's ending pose and camera angle in Frame 2.
3. The room environment and lighting details.
Be concise and factual. Do not write essays. Do not assume clothes change unless visually obvious.
```

**Stage 2 (FL2VA compiler) system — output raw prompt only, no fences:**
```text
You are an expert prompt engineer for the MiniMax H3 video model (FL2VA mode).
Output ONLY the raw plain text prompt. No greetings, no commentary, no markdown fences.
Use exact format:

How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the subject begins in the exact pose, angle, and framing of Picture 1, maintaining clothing and appearance. The subject smoothly shifts weight, transitions body posture and limb positions, and turns toward the new perspective while the camera naturally adjusts its angle, gradually settling into the exact pose, body orientation, and framing of Picture 2 by the 5.00-second mark.

overall_soundscape: Quiet indoor room ambience with light reverberation. The soft scraping of shoes on the floor accompanies the posture change, followed by the subtle rustle of clothing fabric moving.

non_diegetic_music: N/A

Adapt motion path, lighting, and soundscape strictly from the factual input.
```

Adapt duration/`S.SS` and Shot N to the real clip. For REF2VA, use a six-section compiler (Section 11).

**Prompt-side long-form note:** Native clips are 4–15 s. Extend via L2VA last-frame landing, REF2VA `[video continuation]`, or a dedicated Extender RAG (workflow tooling — not covered here). In multi-asset REF2VA, prefer strong retention language (`fully_preserved`) and clear job-only roles; host-side reference weight ≥50% is a common community setting when available.

---

## 11. System Prompt Architects (LLM compilers)

### 11.1 Base modes (T2VA / I2VA / FL2VA / L2VA)

```text
You are an elite MiniMax H3 Video Prompt Architect.
Convert any user input into one production-ready MiniMax H3 prompt for T2VA / I2VA / FL2VA / L2VA.
Output ONLY the finished prompt: no explanations, markdown, JSON, or headings.

Mode detection (silent):
- Text only → T2VA
- One image as start → I2VA
- Two images first+last → FL2VA
- One image as end → L2VA
Default ambiguous single image → I2VA. Map images to <Picture 1>, <Picture 2>.

Format:
[Mode instruction line if required]

integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...

Exact instruction lines:
I2VA: For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
FL2VA: How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
L2VA: How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.

Enforce: no timestamp on [Shot 1]; MM:SS.mmm cuts; camera as Motion+Amplitude+Speed natural English; (Sx) + <d>[Language] ...</d>; voiceover closed-lips rule; on-screen text in ""; non_diegetic_music N/A when none; FL2VA/L2VA prefer single continuous shot unless cuts are required.
```

### 11.2 REF2VA compiler (summary)

```text
You are an expert MiniMax H3 Ref2VA prompt writer.
User gives: concept, duration (default 5.00), and LABEL + description for each asset.
Never invent references. Never leave a used label undefined.
Output ONLY six fields in order, no preamble, no markdown fences:
subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music
Follow official retention markers, task prefixes, style-before-[Shot 1], 350-500 word detailed_description for generation tasks, and base camera/dialogue rules.
```

---

## 12. Troubleshooting & Pre-Generation QA

| Symptom | Cause | Fix |
| --- | --- | --- |
| Ignores reference / treats as style | Missing/paraphrased alignment header | Exact header on line 1 + blank line |
| Mouth moves on VO | No lip closure | `while his lips remain completely closed.` |
| Unwanted score | Missing music field | `non_diegetic_music: N/A` |
| FL2VA morph jump | No intermediate path | Describe observable motion between frames |
| Chaotic cuts | Minor angles as new shots | Stay in `[Shot 1]` + continuous camera |
| Timestamp ignored | On Shot 1 / marks action / out of range | Shot 1 untimed; increasing cut times only |
| Garbled dialogue | Missing `<d>` / paraphrase | Exact words in `<d>[Language] ...</d>` |
| Bad on-screen text | Unquoted / paraphrased | `""` verbatim |
| Character duplicates (REF2VA) | Subject/env not split | Separate `<Subject>` tags; mandate solitary framing |
| Levitates | Dark floor / abstract weight words | Visible floor contact + contact shadows |
| Camera drift | No static hold | `holds a static shot` |
| Identity wash | Redescribed refs | Job-only roles + fully_preserved |
| Soft / drifting face | Soft refs or weak identity language | Sharp identity refs + explicit preserve traits |
| Prompt truncated (API) | Char cap | Condense to host limit |
| Slideshow pacing | Too many events | Timed shot list; fewer locations |

### 30-second checklist

1. Mode matches inputs  
2. Alignment line exact; `S.SS` two decimals  
3. Shot 1 untimed; later cuts increasing  
4. Camera natural English (Motion ± Amplitude ± Speed)  
5. Stable `(Sx)` + `<d>` isolation  
6. VO closed-lips / dialogue lip-stop  
7. Diegetic vs non-diegetic split; music `N/A` if needed  
8. On-screen text in `""`  
9. REF2VA: all labels defined, retention lines present, style before Shot 1  
10. Duration/speech budget realistic  

---

## 13. Quick Mode Templates (fill-in)

**T2VA skeleton:**
```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, [framing + subjects + action + camera]. [Optional dialogue with (S1) and <d>]. [Shot 2] At 00:0X.000, the camera cuts to...

overall_soundscape: [ambience + Foley]

non_diegetic_music: [score] OR N/A
```

**I2VA skeleton:**
```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, [preserve Picture 1 subjects/layout], [forward action + camera]...

overall_soundscape: ...
non_diegetic_music: ...
```

**FL2VA skeleton:**
```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the S.SS-second mark of the target video.

integrated_multimodal_description: [Shot 1] ... begins as Picture 1 ... [observable path] ... settles into Picture 2...

overall_soundscape: ...
non_diegetic_music: N/A
```

**L2VA skeleton:**
```text
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the S.SS-second mark of the target video.

integrated_multimodal_description: [Shot 1] [plausible earlier state] ... converges to match <Picture 1>...

overall_soundscape: ...
non_diegetic_music: ...
```

---

*End of prompting guide. Primary AnythingLLM source for MiniMax H3 **prompt engineering**. ComfyUI / Extender / LoRA → separate RAG files.*
