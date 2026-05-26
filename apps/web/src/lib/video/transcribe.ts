import { transcribeMedia as transcribeWithLlm } from "@deephaus/llm";

const USE_MOCK = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

export async function transcribeMedia(buffer: Buffer, filename: string) {
  return transcribeWithLlm(buffer, filename, {
    apiKey: process.env.OPENAI_API_KEY,
    mock: USE_MOCK || !process.env.OPENAI_API_KEY,
  });
}
