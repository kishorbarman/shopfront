import config from '../config';
import logger from './logger';

type GeminiJsonOptions = {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function extractJsonCandidate<T>(rawText: string): T | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        return null;
      }
    }

    const objectLike = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!objectLike?.[0]) {
      return null;
    }

    try {
      return JSON.parse(objectLike[0]) as T;
    } catch {
      return null;
    }
  }
}

function extractTextFromGeminiResponse(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

export async function generateGeminiJson<T>(options: GeminiJsonOptions): Promise<T | null> {
  if (config.MOCK_LLM) {
    return null;
  }

  if (!config.GEMINI_API_KEY) {
    logger.error(
      { event: 'error', type: 'GeminiConfigError' },
      'GEMINI_API_KEY is not set while MOCK_LLM is disabled',
    );
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${options.model ?? 'gemini-2.0-flash'}:generateContent?key=${config.GEMINI_API_KEY}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: options.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: options.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: options.temperature ?? 0,
          maxOutputTokens: options.maxOutputTokens ?? 1024,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        {
          event: 'error',
          type: 'GeminiApiError',
          status: response.status,
          message: body,
        },
        'Gemini generateContent request failed',
      );
      return null;
    }

    const payload = (await response.json()) as GeminiResponse;
    const text = extractTextFromGeminiResponse(payload);
    return extractJsonCandidate<T>(text);
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        event: 'error',
        type: typedError.name,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Gemini request failed',
    );
    return null;
  }
}
