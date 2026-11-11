import { describe, expect, it, vi } from "vitest";
import { ELEVENLABS_VOICE_IDS, TTS_MODEL, speechLanguageCode, synthesizeSpeech } from "../../packages/llm/src/speech";
import { DEFAULT_TTS_VOICE, TTS_VOICES, resolveTtsVoice } from "../../packages/shared/src/schemas";

describe("ElevenLabs text-to-speech", () => {
  it("has a provider voice for every listed voice", () => {
    for (const voice of TTS_VOICES) expect(ELEVENLABS_VOICE_IDS[voice.id]).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it("maps the old OpenAI voice names and unknown values to current voices", () => {
    expect(resolveTtsVoice("george")).toBe("george");
    expect(resolveTtsVoice("alloy")).toBe("sarah");
    expect(resolveTtsVoice("onyx")).toBe("daniel");
    expect(resolveTtsVoice("nope")).toBe(DEFAULT_TTS_VOICE);
    expect(resolveTtsVoice(undefined)).toBe(DEFAULT_TTS_VOICE);
  });

  it("turns what a learner types into a language code", () => {
    expect(speechLanguageCode("French")).toBe("fr");
    expect(speechLanguageCode(" español ")).toBe("es");
    expect(speechLanguageCode("Portuguese (Brazil)")).toBe("pt");
    expect(speechLanguageCode("pt-BR")).toBe("pt");
    expect(speechLanguageCode("ja")).toBe("ja");
    expect(speechLanguageCode("")).toBeNull();
    expect(speechLanguageCode("Klingon dialect")).toBeNull();
  });

  it("posts the text, model, voice and language and returns the MP3", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 1]), { status: 200 }));
    const speech = await synthesizeSpeech({ text: "Bonjour", voice: "alice", languageCode: "fr", apiKey: "k", fetchImpl });
    expect(speech).toEqual({ bytes: new Uint8Array([0xff, 0xfb, 1]), mimeType: "audio/mpeg" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_IDS.alice}?output_format=mp3_44100_128`);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Bonjour", model_id: TTS_MODEL, language_code: "fr" });
  });

  it("omits the language when unknown and reports provider errors without the key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: { message: "quota exceeded" } }), { status: 402 }));
    await expect(synthesizeSpeech({ text: "Hi", voice: "eric", apiKey: "secret", fetchImpl })).rejects.toThrow(
      "The speech service failed (402): quota exceeded",
    );
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ text: "Hi", model_id: TTS_MODEL });
  });

  it("returns silent mock audio without a key", async () => {
    const fetchImpl = vi.fn();
    const speech = await synthesizeSpeech({ text: "Hi", voice: "sarah", fetchImpl });
    expect(speech.mimeType).toBe("audio/mpeg");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
