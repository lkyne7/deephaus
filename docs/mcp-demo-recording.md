# DeepHaus ChatGPT review recording

Record a continuous screen capture of ChatGPT Developer Mode using the dedicated
synthetic reviewer account. Keep passwords, OAuth tokens, other conversations,
and personal data out of the recording. The reviewer credentials are already in
the submission form; they do not belong in the video or this document.

## Before recording

1. Sign in to DeepHaus with the dedicated reviewer account.
2. In ChatGPT Developer Mode, connect DeepHaus at
   `https://www.deephaus.ai/api/mcp` using OAuth. Approve study and write access
   for the synthetic reviewer account.
3. Open a fresh chat and select DeepHaus. Confirm that its tools are available.
4. Start recording after login. Keep the ChatGPT window and relevant tool results
   visible. Use synthetic examples only.

## Recording sequence (approximately 3–5 minutes)

1. Show the connected DeepHaus integration briefly, then send:
   **Show my DeepHaus decks and due counts.**
   Expected: `list_decks` returns the reviewer account’s sample decks.
2. Send:
   **Create a new deck called MCP review. Add two basic flashcards: “What is
   2 + 2?” → “4”, and “What is the capital of France?” → “Paris”. Also add a
   cloze card: “The sum of 2 + 2 is {{c1::4}}.”**
   Expected: `create_deck` and `create_cards` succeed; show the returned deck and
   card details. Do not claim success if the tool returns an error.
3. Send:
   **Find the 2 + 2 basic card in MCP review and change its answer to Four (4).**
   Expected: `browse_cards` or `get_card`, followed by `update_card`. Show the
   updated answer in the tool result or retrieve the card again.
4. Send:
   **Quiz me on the cards in MCP review, one question at a time. Wait for my
   answer before revealing the answer, and wait for my explicit recall grade
   before recording a review.**
   Expected: `get_study_queue`; one question with its answer hidden initially.
   Answer the displayed question, then explicitly say **Mark that Good.**
   Expected: `submit_review` records the `good` grade only after that instruction.
5. Send:
   **Show my study progress and the statistics for MCP review.**
   Expected: `get_study_stats` and `get_deck_stats` return the reviewer’s data.
6. Optional short routing check:
   **Explain spaced repetition in two sentences. Do not access my account or
   create any flashcards.**
   Expected: a text answer without a DeepHaus tool call.

## Deliverable

Export an MP4 and provide a reviewer-accessible HTTPS video URL. Test that the
link opens without requiring access to your private workspace. Paste the URL
into OpenAI’s **Info → Demo Recording URL** field. The portal states that the
video is used for review and will not be shared externally.

This document is a recording script, not evidence that these ChatGPT interactions
have already been performed or recorded. The live tool scan and automated MCP
Inspector checks are separate verification steps.

## Recording setup — September 19, 2026

- OpenAI publisher verification is complete: the verified business is **Dekki**;
  the submission's app name remains **DeepHaus**.
- The old August 22 ChatGPT developer connection uses cached CIMD configuration
  and fails with `invalid_client` against the current DCR-only server. Do not use
  that old connection for the demo.
- Created a fresh **DeepHaus Demo** developer connection
  (`asdk_app_6aaefb19ab1c81918fadde7c744b5aba`). ChatGPT discovered Dynamic Client
  Registration, the production OAuth endpoints, and the `study write` scopes.
- The fresh connection was authenticated with the synthetic reviewer account
  after explicit approval for study/write access. ChatGPT loaded all 12 tools.
- A local tab-only WebM recorder is prepared at `/tmp/deephaus-demo-recorder/`.
  It uses Chrome's tab-sharing picker, excludes microphone/camera capture, and
  provides a local download after recording stops.

## Completed recording — September 19, 2026

- Final MP4: `/Users/lukekyne/Downloads/DeepHaus-ChatGPT-demo.mp4`.
- Original capture: `/Users/lukekyne/Downloads/deephaus-chatgpt-demo.webm`.
- Approximately 3 minutes 25 seconds, silent, actual ChatGPT developer-plugin
  interactions with the synthetic reviewer account. The first 10 seconds of
  setup were removed and the narrow sidebar cropped to exclude the profile
  avatar. The demonstrated interactions remain continuous and at normal speed.
- Demonstrated: list decks and due counts; create `MCP review` with two basic
  cards and one cloze card; find/edit/retrieve the arithmetic card; question-first
  study; answer reveal; explicit `Good` grade; review and deck statistics.
- Live results: all three cards created, saved answer `Four (4)` verified, one
  review recorded, one-day streak, and two new cards remaining in `MCP review`.
- ChatGPT conversation: https://chatgpt.com/c/6aaefcf7-baa8-83e9-8ba5-5f850c1b7abc
- This is a local deliverable. A reviewer-accessible HTTPS URL has not yet been
  added to the OpenAI submission, and the submission has not been sent.
