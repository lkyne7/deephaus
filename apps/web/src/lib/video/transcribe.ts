import { transcribeMedia as transcribeWithLlm } from "@deephaus/llm";

const USE_MOCK = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

export function transcriptionUsesPaidProvider(): boolean {
  return !USE_MOCK && Boolean(process.env.OPENAI_API_KEY);
}

export async function transcribeMedia(buffer: Buffer, filename: string) {
  return transcribeWithLlm(buffer, filename, {
    apiKey: process.env.OPENAI_API_KEY,
    mock: USE_MOCK || !process.env.OPENAI_API_KEY,
  });
}
