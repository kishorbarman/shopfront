import { generateGeminiJson } from '../lib/gemini';

const EXTRACTION_SYSTEM_PROMPT =
  "You are a data extraction assistant. Extract structured data from the user's message. Respond ONLY with valid JSON.";

type ParsedService = { name: string; price: number };
type ParsedHour = { dayOfWeek: number; open: string; close: string; isClosed: boolean };

async function extractWithClaude<T>(prompt: string): Promise<T | null> {
  return generateGeminiJson<T>({
    model: 'gemini-2.0-flash',
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: prompt,
    maxOutputTokens: 512,
    temperature: 0,
  });
}

function normalizeBusinessName(text: string): string | null {
  const cleaned = text.trim().replace(/^hi[,!\s]*/i, '').replace(/^hello[,!\s]*/i, '').trim();
  if (cleaned.length < 2) {
    return null;
  }

  return cleaned;
}

const KNOWN_CATEGORIES = ['barber', 'salon', 'restaurant', 'food truck', 'auto repair'];

function normalizeCategory(text: string): string | null {
  const normalized = text.toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  const known = KNOWN_CATEGORIES.find((category) => normalized.includes(category));
  if (known) {
    return known;
  }

  return normalized.split(/[,.!?]/)[0]?.trim() ?? null;
}

const WORD_UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const WORD_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const WORD_DIGITS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const NUMBER_WORDS_PATTERN =
  /(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point)/;

function parseWordNumber(input: string): number | null {
  const tokens = input
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  let integerValue = 0;
  let currentValue = 0;
  let sawNumberWord = false;
  let decimalMode = false;
  let decimalDigits = '';

  for (const token of tokens) {
    if (token === 'and') {
      continue;
    }

    if (token === 'point') {
      decimalMode = true;
      continue;
    }

    if (decimalMode) {
      const digit = WORD_DIGITS[token];
      if (digit === undefined) {
        return null;
      }
      decimalDigits += digit;
      sawNumberWord = true;
      continue;
    }

    if (WORD_UNITS[token] !== undefined) {
      currentValue += WORD_UNITS[token];
      sawNumberWord = true;
      continue;
    }

    if (WORD_TENS[token] !== undefined) {
      currentValue += WORD_TENS[token];
      sawNumberWord = true;
      continue;
    }

    if (token === 'hundred') {
      currentValue = (currentValue || 1) * 100;
      sawNumberWord = true;
      continue;
    }

    return null;
  }

  integerValue += currentValue;

  if (!sawNumberWord) {
    return null;
  }

  if (decimalDigits) {
    return Number(`${integerValue}.${decimalDigits}`);
  }

  return integerValue;
}

function titleCase(text: string): string {
  return text
    .split(' ')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(' ');
}

function extractPriceAndName(chunk: string): ParsedService | null {
  const numericPriceMatch = chunk.match(/\$?(\d+(?:\.\d{1,2})?)/);
  if (numericPriceMatch) {
    const price = Number(numericPriceMatch[1]);
    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }

    const name = chunk
      .replace(/\$?\d+(?:\.\d{1,2})?/g, '')
      .replace(/\b(usd|dollars?|for|at|is|now)\b/gi, '')
      .trim()
      .replace(/\s+/g, ' ');

    if (!name) {
      return null;
    }

    return { name: titleCase(name), price };
  }

  const lowerChunk = chunk.toLowerCase();
  const tailMatch = lowerChunk.match(
    /((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point|and|-|\s)+)$/,
  );

  if (!tailMatch || !NUMBER_WORDS_PATTERN.test(tailMatch[1])) {
    return null;
  }

  const price = parseWordNumber(tailMatch[1]);
  if (!price || price <= 0) {
    return null;
  }

  const tailStart = lowerChunk.lastIndexOf(tailMatch[1]);
  if (tailStart <= 0) {
    return null;
  }

  const name = chunk
    .slice(0, tailStart)
    .replace(/\b(for|at|is|now)\s*$/i, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!name) {
    return null;
  }

  return { name: titleCase(name), price };
}

function heuristicParseServices(text: string): ParsedService[] | null {
  const chunks = text
    .split(/\n|,|;|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const parsed: ParsedService[] = [];

  for (const chunk of chunks) {
    const parsedChunk = extractPriceAndName(chunk);
    if (parsedChunk) {
      parsed.push(parsedChunk);
    }
  }

  return parsed.length > 0 ? parsed : null;
}

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function parseDayExpression(expression: string): number[] {
  const cleaned = expression.toLowerCase().trim();

  const rangeMatch = cleaned.match(
    /(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thurs|thursday|fri|friday|sat|saturday)\s*(?:-|to|through|thru)\s*(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thurs|thursday|fri|friday|sat|saturday)/,
  );

  if (rangeMatch) {
    const start = DAY_MAP[rangeMatch[1]];
    const end = DAY_MAP[rangeMatch[2]];
    if (start === undefined || end === undefined) {
      return [];
    }

    const result: number[] = [];
    let current = start;
    while (true) {
      result.push(current);
      if (current === end) {
        break;
      }
      current = (current + 1) % 7;
    }
    return result;
  }

  const tokens = cleaned.match(
    /sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thurs|thursday|fri|friday|sat|saturday/g,
  );

  if (!tokens) {
    return [];
  }

  return Array.from(new Set(tokens.map((token) => DAY_MAP[token]).filter((day) => day !== undefined)));
}

function to24Hour(hour: number, minute: number, suffix?: string): string {
  let normalizedHour = hour;

  if (suffix) {
    const ampm = suffix.toLowerCase();
    if (ampm === 'pm' && hour < 12) {
      normalizedHour += 12;
    } else if (ampm === 'am' && hour === 12) {
      normalizedHour = 0;
    }
  }

  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeRange(text: string): { open: string; close: string } | null {
  const match = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );

  if (!match) {
    return null;
  }

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] ?? '0');
  const startSuffix = match[3];
  const endHourRaw = Number(match[4]);
  const endMinute = Number(match[5] ?? '0');
  const endSuffix = match[6];

  if ([startHour, startMinute, endHourRaw, endMinute].some((value) => Number.isNaN(value))) {
    return null;
  }

  let startHour24 = startHour;
  let endHour24 = endHourRaw;

  if (!startSuffix && !endSuffix && endHour24 <= startHour24) {
    endHour24 += 12;
  }

  const open = to24Hour(startHour24, startMinute, startSuffix);
  const close = to24Hour(endHour24, endMinute, endSuffix);

  return { open, close };
}

function heuristicParseHours(text: string): ParsedHour[] | null {
  const result: ParsedHour[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    open: '09:00',
    close: '17:00',
    isClosed: true,
  }));

  const segments = text
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  let applied = false;

  for (const segment of segments) {
    const days = parseDayExpression(segment);
    if (days.length === 0) {
      continue;
    }

    if (/closed/i.test(segment)) {
      for (const day of days) {
        result[day] = {
          dayOfWeek: day,
          open: '09:00',
          close: '17:00',
          isClosed: true,
        };
      }
      applied = true;
      continue;
    }

    const timeRange = parseTimeRange(segment);
    if (!timeRange) {
      continue;
    }

    for (const day of days) {
      result[day] = {
        dayOfWeek: day,
        open: timeRange.open,
        close: timeRange.close,
        isClosed: false,
      };
    }
    applied = true;
  }

  return applied ? result : null;
}

export async function parseBusinessName(text: string): Promise<string | null> {
  const prompt = `Extract the business name from this message. Return JSON: {"name": string | null}. Message: ${JSON.stringify(text)}`;
  const extracted = await extractWithClaude<{ name: string | null }>(prompt);

  if (extracted?.name && extracted.name.trim()) {
    return extracted.name.trim();
  }

  return normalizeBusinessName(text);
}

export async function parseCategory(text: string): Promise<string | null> {
  const prompt = `Extract the business category from this message. Return JSON: {"category": string | null}. Message: ${JSON.stringify(text)}`;
  const extracted = await extractWithClaude<{ category: string | null }>(prompt);

  if (extracted?.category && extracted.category.trim()) {
    return extracted.category.trim().toLowerCase();
  }

  return normalizeCategory(text);
}

export async function parseServices(text: string): Promise<Array<{ name: string; price: number }> | null> {
  const prompt = `Extract services and prices from this message. Return JSON array: [{"name": string, "price": number}]. Ignore entries without a clear numeric price. Message: ${JSON.stringify(text)}`;
  const extracted = await extractWithClaude<ParsedService[]>(prompt);

  if (Array.isArray(extracted)) {
    const valid = extracted
      .filter((item) => item && typeof item.name === 'string' && Number.isFinite(item.price))
      .map((item) => ({ name: item.name.trim(), price: Number(item.price) }))
      .filter((item) => item.name.length > 0 && item.price > 0);

    if (valid.length > 0) {
      return valid;
    }
  }

  return heuristicParseServices(text);
}

export async function parseHours(
  text: string,
): Promise<Array<{ dayOfWeek: number; open: string; close: string; isClosed: boolean }> | null> {
  const prompt = `Extract weekly opening hours from this message. Return JSON array of 7 items ordered Sunday(0) to Saturday(6). Each item format: {"dayOfWeek": number, "open": "HH:MM", "close": "HH:MM", "isClosed": boolean}. Message: ${JSON.stringify(text)}`;
  const extracted = await extractWithClaude<ParsedHour[]>(prompt);

  if (Array.isArray(extracted) && extracted.length > 0) {
    const normalized = extracted
      .filter(
        (item) =>
          item &&
          Number.isInteger(item.dayOfWeek) &&
          item.dayOfWeek >= 0 &&
          item.dayOfWeek <= 6 &&
          typeof item.open === 'string' &&
          typeof item.close === 'string' &&
          typeof item.isClosed === 'boolean',
      )
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

    if (normalized.length === 7) {
      return normalized;
    }
  }

  return heuristicParseHours(text);
}
