import Anthropic from '@anthropic-ai/sdk';

import { type ClassificationResult, SUPPORTED_INTENTS } from './intents';
import config from '../config';

interface ClassifierOptions {
  hasMedia?: boolean;
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (config.MOCK_ANTHROPIC) {
    return null;
  }

  const apiKey = config.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }

  return anthropicClient;
}

function extractTextContent(content: Anthropic.Messages.ContentBlock[]): string {
  const textBlocks = content.filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text');
  return textBlocks.map((block) => block.text).join('\n').trim();
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseModelClassification(rawText: string): ClassificationResult | null {
  const parsed = safeJsonParse<ClassificationResult>(rawText);
  if (!parsed) {
    return null;
  }

  if (!SUPPORTED_INTENTS.includes(parsed.intent)) {
    return null;
  }

  const confidence = Number(parsed.confidence);
  const boundedConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0.3;

  return {
    ...parsed,
    confidence: boundedConfidence,
    needsClarification: parsed.needsClarification || boundedConfidence < 0.7,
  };
}

function buildSystemPrompt(shopContext: { name: string; services: string[] }): string {
  return [
    'You classify shop owner messages into one intent category.',
    'Return ONLY valid JSON with fields: intent, confidence, needsClarification, clarificationQuestion, rawEntities.',
    `Supported intents: ${SUPPORTED_INTENTS.join(', ')}`,
    'Examples:',
    '- add_service: "Add lineup for $10"',
    '- update_service: "Change haircut to $28"',
    '- remove_service: "Remove hot towel shave"',
    '- update_hours: "Open til 8 on Fridays"',
    '- temp_closure: "Closed next Monday"',
    '- update_contact: "New number is 555-1234"',
    '- update_photo: "Make this my main photo"',
    '- add_notice: "Put up a sign: cash only"',
    '- remove_notice: "Take down the vacation notice"',
    '- query: "What is my fade price?"',
    '- greeting: "Hey"',
    '- help: "What can you do?"',
    `Shop name: ${shopContext.name}`,
    `Known services: ${shopContext.services.join(', ') || 'none'}`,
    'If confidence < 0.7 set needsClarification to true and include a short clarificationQuestion.',
  ].join('\n');
}

function classifyHeuristically(
  message: string,
  shopContext: { name: string; services: string[] },
  options?: ClassifierOptions,
): ClassificationResult {
  const text = message.toLowerCase().trim();

  const mentionsMediaIntent = /(photo|image|picture|banner|profile|main photo)/i.test(text);
  if ((options?.hasMedia && mentionsMediaIntent) || (mentionsMediaIntent && text.includes('upload'))) {
    return {
      intent: 'update_photo',
      confidence: 0.95,
      needsClarification: false,
    };
  }

  if (/^(hey|hi|hello|yo|sup)\b/.test(text)) {
    return { intent: 'greeting', confidence: 0.95, needsClarification: false };
  }

  if (/(what can you do|help|commands|how does this work)/.test(text)) {
    return { intent: 'help', confidence: 0.95, needsClarification: false };
  }

  if (
    /(^|\b)(what|show|list|which|how much|price)(\b|\?)/.test(text) ||
    /\bshow my hours\b/.test(text) ||
    /\bwhat are my hours\b/.test(text) ||
    /\bshow notices?\b/.test(text) ||
    /\blist notices?\b/.test(text)
  ) {
    return { intent: 'query', confidence: 0.82, needsClarification: false };
  }

  if (/(take down|remove).*notice|(take down|remove).*sign|remove notice|delete notice/.test(text)) {
    return { intent: 'remove_notice', confidence: 0.9, needsClarification: false };
  }

  if (/(notice|sign|announcement|cash only|post this)/.test(text)) {
    return { intent: 'add_notice', confidence: 0.85, needsClarification: false };
  }

  if (/(vacation|closed next|closed on|temp closed|temporarily closed)/.test(text)) {
    return { intent: 'temp_closure', confidence: 0.85, needsClarification: false };
  }

  if (/(hours|open|close|closing|opening|friday|monday|sunday)/.test(text)) {
    return { intent: 'update_hours', confidence: 0.8, needsClarification: false };
  }

  if (/(new number|phone|address|contact|reach me)/.test(text)) {
    return { intent: 'update_contact', confidence: 0.8, needsClarification: false };
  }

  if (/(remove|delete|drop|take off|off menu)/.test(text)) {
    return { intent: 'remove_service', confidence: 0.82, needsClarification: false };
  }

  const mentionsKnownService = shopContext.services.some((service) => text.includes(service.toLowerCase()));
  if (
    /(change|update|set|make|chg|edit|raise|lower).*(\$|\d+)/.test(text) ||
    (mentionsKnownService && /(change|update|set|now|chg|edit)/.test(text))
  ) {
    return {
      intent: 'update_service',
      confidence: mentionsKnownService ? 0.9 : 0.75,
      needsClarification: false,
    };
  }

  if (/(add|new service|include|offer)/.test(text)) {
    return { intent: 'add_service', confidence: 0.82, needsClarification: false };
  }

  return {
    intent: 'unknown',
    confidence: 0.4,
    needsClarification: true,
    clarificationQuestion: 'Do you want to update services, hours, notices, or contact details?',
  };
}

export async function classifyIntent(
  message: string,
  shopContext: { name: string; services: string[] },
  history: Array<{ role: string; content: string }>,
  options?: ClassifierOptions,
): Promise<ClassificationResult> {
  const heuristic = classifyHeuristically(message, shopContext, options);
  const client = getAnthropicClient();

  if (!client) {
    return heuristic.confidence < 0.7
      ? {
          ...heuristic,
          needsClarification: true,
          clarificationQuestion:
            heuristic.clarificationQuestion ??
            'I can help with services, hours, notices, and photos. What should I update?',
        }
      : heuristic;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 512,
      temperature: 0,
      system: buildSystemPrompt(shopContext),
      messages: [
        {
          role: 'user',
          content: `History: ${JSON.stringify(history.slice(-5))}\nMessage: ${JSON.stringify(message)}`,
        },
      ],
    });

    const parsed = parseModelClassification(extractTextContent(response.content));
    if (!parsed) {
      return heuristic;
    }

    if (options?.hasMedia && /(photo|image|picture|banner|profile)/i.test(message)) {
      return {
        ...parsed,
        intent: 'update_photo',
        confidence: Math.max(parsed.confidence, 0.9),
        needsClarification: false,
      };
    }

    if (parsed.confidence < 0.7) {
      return {
        ...parsed,
        needsClarification: true,
        clarificationQuestion:
          parsed.clarificationQuestion ??
          'I can help with services, hours, notices, and photos. What should I update?',
      };
    }

    return parsed;
  } catch (error) {
    console.error('Intent classification failed:', error);
    return heuristic;
  }
}

export function isPhotoIntentFromMedia(message: string, hasMedia: boolean): boolean {
  if (!hasMedia) {
    return false;
  }

  return /(photo|image|picture|banner|profile|main photo)/i.test(message);
}
