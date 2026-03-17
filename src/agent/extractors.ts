import { parseHours } from './parsers';
import { generateGeminiJson } from '../lib/gemini';
import logger from '../lib/logger';

export type MutationIntent =
  | 'add_service'
  | 'update_service'
  | 'remove_service'
  | 'update_hours'
  | 'temp_closure'
  | 'update_contact'
  | 'add_notice'
  | 'remove_notice'
  | 'update_photo';

type ExtractContext = {
  shopName: string;
  services: string[];
  notices?: Array<{ id: string; message: string }>;
  hasMedia?: boolean;
};

type ExtractionResult =
  | {
      success: true;
      intent: MutationIntent;
      data: Record<string, any>;
      confirmationMessage: string;
    }
  | {
      success: false;
      reason: string;
      clarificationQuestion: string;
    };

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findClosestServiceName(input: string, services: string[]): string | null {
  const target = normalize(input);
  if (!target) return null;

  const exact = services.find((service) => normalize(service) === target);
  if (exact) return exact;

  const contains = services.find(
    (service) => normalize(service).includes(target) || target.includes(normalize(service)),
  );
  if (contains) return contains;
  return null;
}

function dayFromText(text: string): number | null {
  const map: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };

  const token = text.toLowerCase().match(/sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat/);
  if (!token) return null;
  return map[token[0]] ?? null;
}

function to24HourFromPhrase(value: string): string | null {
  const match = value.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const suffix = match[3]?.toLowerCase();

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (!suffix && hour < 8) hour += 12;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function nextDayIso(dayName: string): string {
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const target = map[dayName.toLowerCase()] ?? 1;
  const now = new Date();
  const date = new Date(now);
  const delta = (target - now.getDay() + 7) % 7 || 7;
  date.setDate(now.getDate() + delta);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function buildConfirmation(intent: MutationIntent, data: Record<string, any>): string {
  switch (intent) {
    case 'add_service': {
      const services = Array.isArray(data.services)
        ? data.services
        : data.name && data.price
          ? [{ name: data.name, price: data.price }]
          : [];
      if (services.length <= 1) {
        const first = services[0] ?? data;
        return `I'll add ${first.name} for $${first.price}. Sound good?`;
      }

      const summary = services.map((service: { name: string; price: number }) => `${service.name} ($${service.price})`).join(', ');
      return `I'll add these services: ${summary}. Sound good?`;
    }
    case 'update_service': {
      const priceText = data.newPrice ? ` to $${data.newPrice}` : '';
      const nameText = data.newName ? ` as ${data.newName}` : '';
      return `I'll update ${data.serviceName}${priceText}${nameText}. Sound good?`;
    }
    case 'remove_service':
      return `I'll remove ${data.serviceName} from your menu. Sound good?`;
    case 'update_hours':
      return `I'll update your hours (${data.summary ?? 'as requested'}). Sound good?`;
    case 'temp_closure':
      return `I'll post a temporary closure notice: "${data.message}". Sound good?`;
    case 'update_contact':
      return `I'll update your ${data.field} to "${data.value}". Sound good?`;
    case 'add_notice':
      return `I'll add this notice: "${data.message}". Sound good?`;
    case 'remove_notice':
      return `I'll remove that notice. Sound good?`;
    case 'update_photo':
      return 'I\'ll update your main photo with this image. Sound good?';
    default:
      return 'I\'ll make that change. Sound good?';
  }
}

function parseAddServiceHeuristic(message: string) {
  const cleaned = message
    .replace(/^(add|new service|include|offer)\s*/i, '')
    .trim();

  const normalizeName = (value: string): string =>
    value
      .replace(/^["']+|["']+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());

  const parseSegment = (segment: string): { name: string; price: number } | null => {
    const stripped = segment.trim().replace(/\$/g, '');
    if (!stripped) return null;

    const match = stripped.match(/^(.*?)(?:\s+(?:for|at)\s+|:\s*|-\s*|\s+)(\d+(?:\.\d{1,2})?)$/i);
    if (!match) return null;

    const name = normalizeName(match[1].replace(/\b(for|at)\b$/i, '').trim());
    const price = Number(match[2]);
    if (!name || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    return { name, price };
  };

  const segments = cleaned
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const parsed = segments
    .map(parseSegment)
    .filter((service): service is { name: string; price: number } => Boolean(service));

  if (parsed.length === 0) {
    const single = parseSegment(cleaned);
    if (!single) return null;
    return { name: single.name, price: single.price, services: [single] };
  }

  return {
    name: parsed[0].name,
    price: parsed[0].price,
    services: parsed,
  };
}

function parseUpdateServiceHeuristic(message: string, services: string[]) {
  const lower = message.toLowerCase();
  const priceMatch = lower.match(/(\d+(?:\.\d{1,2})?)/);
  const stripped = lower
    .replace(/^(change|update|set|make|edit)\s+/i, '')
    .replace(/\s+(to|at|for)\s+\$?\d+(?:\.\d{1,2})?.*$/i, '')
    .replace(/\$/g, '')
    .trim();
  const serviceMention = services.find((service) => lower.includes(service.toLowerCase()));

  if (!serviceMention && !priceMatch) return null;

  const fallbackName = serviceMention ?? findClosestServiceName(stripped || lower, services);
  if (!fallbackName) return null;

  return {
    serviceName: fallbackName,
    newPrice: priceMatch ? Number(priceMatch[1]) : undefined,
    newName: undefined,
  };
}
function parseRemoveServiceHeuristic(message: string, services: string[]) {
  const lower = message.toLowerCase().replace(/^(remove|delete|drop|take off)\s*/i, '');
  const matched = services.find((service) => lower.includes(service.toLowerCase()));
  const best = matched ?? findClosestServiceName(lower, services);
  return best ? { serviceName: best } : null;
}

async function parseUpdateHoursHeuristic(message: string) {
  const lower = message.toLowerCase();
  const closePattern = lower.match(/(?:open\s+til|open\s+till|close\s+at|closing\s+at)\s+([\d:apm\s]+)\s+on\s+([a-z]+)/i);
  if (closePattern) {
    const closeTime = to24HourFromPhrase(closePattern[1]);
    const day = dayFromText(closePattern[2]);
    if (closeTime && day !== null) {
      return {
        changes: [{ dayOfWeek: day, closeTime, isClosed: false }],
        summary: message,
      };
    }
  }

  const parsed = await parseHours(message);
  if (!parsed) return null;

  const changes = parsed.map((hour) => ({
    dayOfWeek: hour.dayOfWeek,
    openTime: hour.open,
    closeTime: hour.close,
    isClosed: hour.isClosed,
  }));

  return {
    changes,
    summary: message,
  };
}

function parseTempClosureHeuristic(message: string) {
  const dayMatch = message.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);

  const startsAt = dayMatch ? nextDayIso(dayMatch[1]) : new Date().toISOString();
  const expires = new Date(startsAt);
  expires.setDate(expires.getDate() + 1);

  return {
    message: message.trim(),
    startsAt,
    expiresAt: expires.toISOString(),
  };
}

function parseUpdateContactHeuristic(message: string) {
  const phoneMatch = message.match(/(\+?\d[\d\s-]{6,}\d)/);
  if (phoneMatch) {
    return { field: 'phone', value: phoneMatch[1].replace(/[\s-]/g, '') };
  }

  const addressMatch = message.match(/address\s+(?:is\s+|to\s+)?(.+)/i);
  if (addressMatch) {
    return { field: 'address', value: addressMatch[1].trim() };
  }

  return null;
}

function parseAddNoticeHeuristic(message: string) {
  const extracted = message.replace(/^(put up a sign|post notice|add notice|notice)[:\s]*/i, '').trim();
  if (!extracted) return null;

  return {
    message: extracted,
    type: /warning|urgent|important/i.test(extracted) ? 'warning' : 'info',
  };
}

function parseRemoveNoticeHeuristic(message: string, notices?: Array<{ id: string; message: string }>) {
  const idMatch = message.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  if (idMatch) {
    return { noticeId: idMatch[0] };
  }

  if (!notices || notices.length === 0) {
    return null;
  }

  const lower = message.toLowerCase();
  const matched = notices.find((notice) => lower.includes(notice.message.toLowerCase()));
  return { noticeId: (matched ?? notices[0]).id };
}

function parseUpdatePhotoHeuristic(hasMedia?: boolean) {
  if (!hasMedia) return null;
  return { useAsMain: true };
}

function toolForIntent(intent: MutationIntent) {
  switch (intent) {
    case 'add_service':
      return {
        name: 'add_service',
        description: 'Add one or more new services with prices.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number' },
            description: { type: 'string' },
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  price: { type: 'number' },
                  description: { type: 'string' },
                },
                required: ['name', 'price'],
              },
            },
          },
          required: [],
        },
      };
    case 'update_service':
      return {
        name: 'update_service',
        description: 'Update existing service fields.',
        input_schema: {
          type: 'object',
          properties: {
            serviceName: { type: 'string' },
            newPrice: { type: 'number' },
            newName: { type: 'string' },
          },
          required: ['serviceName'],
        },
      };
    case 'remove_service':
      return {
        name: 'remove_service',
        description: 'Remove an existing service by name.',
        input_schema: {
          type: 'object',
          properties: {
            serviceName: { type: 'string' },
          },
          required: ['serviceName'],
        },
      };
    case 'update_hours':
      return {
        name: 'update_hours',
        description: 'Update hours for one or more days.',
        input_schema: {
          type: 'object',
          properties: {
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dayOfWeek: { type: 'number' },
                  openTime: { type: 'string' },
                  closeTime: { type: 'string' },
                  isClosed: { type: 'boolean' },
                },
                required: ['dayOfWeek'],
              },
            },
          },
          required: ['changes'],
        },
      };
    case 'temp_closure':
      return {
        name: 'add_temp_closure',
        description: 'Create a temporary closure notice with dates.',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            startsAt: { type: 'string' },
            expiresAt: { type: 'string' },
          },
          required: ['message', 'startsAt', 'expiresAt'],
        },
      };
    case 'update_contact':
      return {
        name: 'update_contact',
        description: 'Update contact field phone or address.',
        input_schema: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['phone', 'address'] },
            value: { type: 'string' },
          },
          required: ['field', 'value'],
        },
      };
    case 'add_notice':
      return {
        name: 'add_notice',
        description: 'Add a notice banner.',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            type: { type: 'string', enum: ['info', 'warning'] },
          },
          required: ['message', 'type'],
        },
      };
    case 'remove_notice':
      return {
        name: 'remove_notice',
        description: 'Remove a notice by id.',
        input_schema: {
          type: 'object',
          properties: {
            noticeId: { type: 'string' },
          },
          required: ['noticeId'],
        },
      };
    case 'update_photo':
      return {
        name: 'update_photo',
        description: 'Set latest uploaded image as main photo.',
        input_schema: {
          type: 'object',
          properties: {
            useAsMain: { type: 'boolean' },
          },
          required: ['useAsMain'],
        },
      };
    default:
      return null;
  }
}

async function extractWithSonnet(intent: MutationIntent, message: string, context: ExtractContext) {
  const tool = toolForIntent(intent);
  if (!tool) return null;

  try {
    const extracted = await generateGeminiJson<Record<string, any>>({
      model: 'gemini-2.0-flash',
      maxOutputTokens: 700,
      temperature: 0,
      systemPrompt:
        'You extract structured fields for a requested mutation intent. Return ONLY valid JSON matching the provided schema. Prefer best-effort extraction over null.',
      userPrompt: JSON.stringify({
        intent,
        message,
        schema: tool.input_schema,
        shopName: context.shopName,
        services: context.services,
        notices: context.notices ?? [],
        hasMedia: context.hasMedia ?? false,
      }),
    });

    return extracted;
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { event: 'error', type: typedError.name, message: typedError.message, stack: typedError.stack },
      'Gemini entity extraction failed',
    );
    return null;
  }
}

export async function extractMutationEntities(
  intent: MutationIntent,
  message: string,
  context: ExtractContext,
): Promise<ExtractionResult> {
  const sonnetData = await extractWithSonnet(intent, message, context);

  let data: Record<string, any> | null = sonnetData;

  const fallbackHeuristic = async (): Promise<Record<string, any> | null> => {
    if (intent === 'add_service') {
      return parseAddServiceHeuristic(message);
    }
    if (intent === 'update_service') {
      return parseUpdateServiceHeuristic(message, context.services);
    }
    if (intent === 'remove_service') {
      return parseRemoveServiceHeuristic(message, context.services);
    }
    if (intent === 'update_hours') {
      return parseUpdateHoursHeuristic(message);
    }
    if (intent === 'temp_closure') {
      return parseTempClosureHeuristic(message);
    }
    if (intent === 'update_contact') {
      return parseUpdateContactHeuristic(message);
    }
    if (intent === 'add_notice') {
      return parseAddNoticeHeuristic(message);
    }
    if (intent === 'remove_notice') {
      return parseRemoveNoticeHeuristic(message, context.notices);
    }
    if (intent === 'update_photo') {
      return parseUpdatePhotoHeuristic(context.hasMedia);
    }

    return null;
  };

  let cachedHeuristic: Record<string, any> | null | undefined;
  const getHeuristic = async () => {
    if (cachedHeuristic !== undefined) {
      return cachedHeuristic;
    }
    cachedHeuristic = await fallbackHeuristic();
    return cachedHeuristic;
  };

  if (intent === 'add_service') {
    const heuristicAdd = await getHeuristic();
    if (heuristicAdd && Array.isArray(heuristicAdd.services) && heuristicAdd.services.length > 1) {
      data = heuristicAdd;
    }
  }

  if (!data) {
    data = await getHeuristic();
  }

  if (!data) {
    return {
      success: false,
      reason: 'unable_to_extract',
      clarificationQuestion: 'I need a bit more detail to make that update. Can you rephrase it?',
    };
  }

  if (intent === 'update_hours' && Array.isArray(data.changes)) {
    for (const change of data.changes) {
      if (change.openTime) {
        change.openTime = to24HourFromPhrase(change.openTime) ?? change.openTime;
      }
      if (change.closeTime) {
        change.closeTime = to24HourFromPhrase(change.closeTime) ?? change.closeTime;
      }
    }
  }

  let normalized = validateExtractedData(intent, data);
  if (!normalized) {
    const heuristicData = await getHeuristic();
    if (heuristicData) {
      normalized = validateExtractedData(intent, heuristicData);
    }
  }

  if (!normalized) {
    return {
      success: false,
      reason: 'invalid_extracted_data',
      clarificationQuestion: 'I need a bit more detail to make that update. Can you rephrase it?',
    };
  }

  return {
    success: true,
    intent,
    data: normalized,
    confirmationMessage: buildConfirmation(intent, normalized),
  };
}

function validateExtractedData(intent: MutationIntent, data: Record<string, any>): Record<string, any> | null {
  switch (intent) {
    case 'add_service': {
      const rawServices = Array.isArray(data.services)
        ? data.services
        : data.name !== undefined || data.price !== undefined
          ? [{ name: data.name, price: data.price, description: data.description }]
          : [];

      if (rawServices.length === 0) return null;

      const services = rawServices
        .map((service: Record<string, any>) => {
          if (typeof service?.name !== 'string' || !service.name.trim()) return null;
          const price = Number(service.price);
          if (Number.isNaN(price) || price <= 0) return null;
          const description =
            typeof service.description === 'string' && service.description.trim().length > 0
              ? service.description.trim()
              : undefined;
          return {
            name: service.name.trim(),
            price,
            ...(description ? { description } : {}),
          };
        })
        .filter((service): service is { name: string; price: number; description?: string } => Boolean(service));

      if (services.length === 0) return null;

      return {
        ...data,
        name: services[0].name,
        price: services[0].price,
        services,
      };
    }
    case 'update_service': {
      if (typeof data.serviceName !== 'string' || !data.serviceName.trim()) return null;
      const hasUpdate = data.newPrice !== undefined || data.newName !== undefined;
      if (!hasUpdate) return null;
      if (data.newPrice !== undefined && (Number.isNaN(Number(data.newPrice)) || Number(data.newPrice) <= 0)) return null;
      if (data.newName !== undefined && (typeof data.newName !== 'string' || !data.newName.trim())) return null;
      return {
        ...data,
        serviceName: data.serviceName.trim(),
        newPrice: data.newPrice !== undefined ? Number(data.newPrice) : undefined,
        newName: typeof data.newName === 'string' ? data.newName.trim() : undefined,
      };
    }
    case 'remove_service':
      if (typeof data.serviceName !== 'string' || !data.serviceName.trim()) return null;
      return { ...data, serviceName: data.serviceName.trim() };
    case 'update_hours':
      if (!Array.isArray(data.changes) || data.changes.length === 0) return null;
      return data;
    case 'temp_closure':
      if (typeof data.message !== 'string' || !data.message.trim()) return null;
      if (typeof data.startsAt !== 'string' || !data.startsAt.trim()) return null;
      if (typeof data.expiresAt !== 'string' || !data.expiresAt.trim()) return null;
      return {
        ...data,
        message: data.message.trim(),
        startsAt: data.startsAt.trim(),
        expiresAt: data.expiresAt.trim(),
      };
    case 'update_contact':
      if (data.field !== 'phone' && data.field !== 'address') return null;
      if (typeof data.value !== 'string' || !data.value.trim()) return null;
      return { ...data, value: data.value.trim() };
    case 'add_notice':
      if (typeof data.message !== 'string' || !data.message.trim()) return null;
      return {
        ...data,
        message: data.message.trim(),
        type: data.type === 'warning' ? 'warning' : 'info',
      };
    case 'remove_notice':
      if (typeof data.noticeId !== 'string' || !data.noticeId.trim()) return null;
      return { ...data, noticeId: data.noticeId.trim() };
    case 'update_photo':
      if (typeof data.useAsMain !== 'boolean') return null;
      return data;
    default:
      return null;
  }
}

function formatDay(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] ?? `Day ${day}`;
}

export function formatQueryResponse(
  query: string,
  context: {
    services: Array<{ name: string; price: string }>;
    hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>;
    notices: Array<{ message: string; type: string }>;
  },
): string {
  const lower = query.toLowerCase();

  if (/hours|open|close/.test(lower)) {
    const ordered = [...context.hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    if (ordered.length === 0) {
      return 'You have no hours set yet.';
    }

    const lines = ordered.map((hour) =>
      hour.isClosed
        ? `${formatDay(hour.dayOfWeek)}: Closed`
        : `${formatDay(hour.dayOfWeek)}: ${hour.openTime}-${hour.closeTime}`,
    );

    return ['Your current hours:', ...lines].join('\n');
  }

  const matchedService = context.services.find((service) => lower.includes(service.name.toLowerCase()));
  if (matchedService) {
    return `${matchedService.name} is currently $${matchedService.price}.`;
  }

  if (/service|price|menu|list/.test(lower)) {
    if (context.services.length === 0) return 'You have no active services yet.';
    const lines = context.services.map((service) => `- ${service.name}: $${service.price}`);
    return ['Your active services:', ...lines].join('\n');
  }

  if (/notice|announcement|sign/.test(lower)) {
    if (context.notices.length === 0) return 'You have no active notices.';
    const lines = context.notices.map((notice) => `- [${notice.type}] ${notice.message}`);
    return ['Your active notices:', ...lines].join('\n');
  }

  return 'I can look up your services, hours, or notices. What would you like to check?';
}
