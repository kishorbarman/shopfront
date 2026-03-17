import { type ClassificationResult, SUPPORTED_INTENTS } from './intents';
import { generateGeminiJson } from '../lib/gemini';
import logger from '../lib/logger';

interface ClassifierOptions {
  hasMedia?: boolean;
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

function looksLikeRegularHoursUpdate(text: string): boolean {
  const hasDayMention = /(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)/.test(text);
  const hasHoursCue = /(hours?|schedule|open|opened|close|closed|closing|opening)/.test(text);

  if (!hasDayMention || !hasHoursCue) {
    return false;
  }

  const hasTemporaryCue =
    /(vacation|temporary|temporarily|temp closed|closed next|next week|next month|tomorrow|today|this weekend|holiday|for\s+\d+\s+days|until|through|only\b)/.test(text);

  return !hasTemporaryCue;
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

  if (looksLikeRegularHoursUpdate(text)) {
    return { intent: 'update_hours', confidence: 0.86, needsClarification: false };
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

function applyHoursOverride(message: string, result: ClassificationResult): ClassificationResult {
  const text = message.toLowerCase().trim();

  if (looksLikeRegularHoursUpdate(text) && result.intent === 'temp_closure') {
    return {
      ...result,
      intent: 'update_hours',
      confidence: Math.max(result.confidence, 0.86),
      needsClarification: false,
      clarificationQuestion: undefined,
    };
  }

  return result;
}

export async function classifyIntent(
  message: string,
  shopContext: { name: string; services: string[] },
  history: Array<{ role: string; content: string }>,
  options?: ClassifierOptions,
): Promise<ClassificationResult> {
  const heuristic = classifyHeuristically(message, shopContext, options);

  try {
    const parsedRaw = await generateGeminiJson<ClassificationResult>({
      model: 'gemini-2.0-flash',
      maxOutputTokens: 512,
      temperature: 0,
      systemPrompt: buildSystemPrompt(shopContext),
      userPrompt: `History: ${JSON.stringify(history.slice(-5))}\nMessage: ${JSON.stringify(message)}`,
    });

    if (!parsedRaw) {
      return heuristic;
    }

    const parsed = parseModelClassification(JSON.stringify(parsedRaw));
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

    const withOverride = applyHoursOverride(message, parsed);

    if (withOverride.confidence < 0.7) {
      return {
        ...withOverride,
        needsClarification: true,
        clarificationQuestion:
          withOverride.clarificationQuestion ??
          'I can help with services, hours, notices, and photos. What should I update?',
      };
    }

    return withOverride;
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error({ event: 'error', type: typedError.name, message: typedError.message, stack: typedError.stack }, 'Intent classification failed');
    return heuristic;
  }
}

export function isPhotoIntentFromMedia(message: string, hasMedia: boolean): boolean {
  if (!hasMedia) {
    return false;
  }

  return /(photo|image|picture|banner|profile|main photo)/i.test(message);
}
