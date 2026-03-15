import { Prisma } from '@prisma/client';

import config from '../config';
import { prisma } from '../lib/prisma';
import { rebuildSite } from '../services/siteBuilder';
import type { InboundMessage } from '../models/types';
import type { ConversationState } from '../services/conversationState';
import { parseBusinessName, parseCategory, parseHours, parseServices } from './parsers';

type OnboardingService = { name: string; price: number };
type OnboardingHour = { dayOfWeek: number; open: string; close: string; isClosed: boolean };

interface OnboardingDraft {
  name?: string;
  category?: string;
  services?: OnboardingService[];
  hours?: OnboardingHour[];
  address?: string;
}

interface CompletedOnboarding {
  shopId: string;
  slug: string;
}

interface OnboardingResult {
  response: string;
  state: ConversationState;
}

const WELCOME_MESSAGE =
  "Hey! I'm Shopfront - I'll get your page live in a few minutes. What's your business called?";

function getDraft(state: ConversationState): OnboardingDraft {
  if (state.pendingAction?.intent !== 'onboarding_draft') {
    return {};
  }

  return state.pendingAction.data as OnboardingDraft;
}

function withDraft(state: ConversationState, draft: OnboardingDraft): ConversationState {
  return {
    ...state,
    pendingAction: {
      intent: 'onboarding_draft',
      data: draft as Record<string, unknown>,
      confirmationMessage: 'Onboarding draft in progress',
    },
  };
}

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|correct|looks good|right|ok|okay|do it|sure)\b/i.test(text.trim());
}

function formatServicesForConfirmation(services: OnboardingService[]): string {
  const lines = services.map((service) => `- ${service.name} - $${service.price}`);
  return [`Here's what I've got:`, ...lines, 'Look right?'].join('\n');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'shop';
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.shop.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function ensureCompleteDraft(draft: OnboardingDraft): {
  name: string;
  category: string;
  services: OnboardingService[];
  hours: OnboardingHour[];
  address: string;
} {
  const { name, category, services, hours, address } = draft;

  if (!name || !category || !services || !hours || !address) {
    throw new Error('Onboarding draft is incomplete.');
  }

  return { name, category, services, hours, address };
}

async function completeOnboarding(phone: string, draft: OnboardingDraft): Promise<CompletedOnboarding> {
  const completeDraft = ensureCompleteDraft(draft);

  return prisma.$transaction(async (tx) => {
    const existingShop = await tx.shop.findUnique({
      where: { phone },
      select: { id: true, slug: true },
    });

    const slug = existingShop?.slug ?? (await generateUniqueSlug(completeDraft.name));

    const shop = existingShop
      ? await tx.shop.update({
          where: { id: existingShop.id },
          data: {
            name: completeDraft.name,
            category: completeDraft.category,
            address: completeDraft.address,
            status: 'ACTIVE',
          },
        })
      : await tx.shop.create({
          data: {
            name: completeDraft.name,
            slug,
            category: completeDraft.category,
            phone,
            address: completeDraft.address,
            status: 'ACTIVE',
          },
        });

    await tx.service.deleteMany({ where: { shopId: shop.id } });
    await tx.hour.deleteMany({ where: { shopId: shop.id } });

    await tx.service.createMany({
      data: completeDraft.services.map((service, index) => ({
        shopId: shop.id,
        name: service.name,
        price: new Prisma.Decimal(service.price),
        sortOrder: index + 1,
        isActive: true,
      })),
    });

    await tx.hour.createMany({
      data: completeDraft.hours.map((hour) => ({
        shopId: shop.id,
        dayOfWeek: hour.dayOfWeek,
        openTime: hour.open,
        closeTime: hour.close,
        isClosed: hour.isClosed,
      })),
    });

    return { shopId: shop.id, slug: shop.slug };
  });
}

export async function runOnboarding(
  message: InboundMessage,
  state: ConversationState,
): Promise<OnboardingResult> {
  const step = state.onboardingStep ?? 1;
  const draft = getDraft(state);

  if (!state.onboardingStep) {
    return {
      response: WELCOME_MESSAGE,
      state: withDraft(
        {
          ...state,
          mode: 'onboarding',
          onboardingStep: 1,
          lastMessageAt: new Date().toISOString(),
        },
        draft,
      ),
    };
  }

  if (step === 1) {
    const name = await parseBusinessName(message.body);
    if (!name) {
      return {
        response: "I didn't catch the business name. What's your business called?",
        state: withDraft(state, draft),
      };
    }

    const updatedDraft = { ...draft, name };
    return {
      response: `What kind of business is ${name} - barber, salon, restaurant, or something else?`,
      state: withDraft(
        {
          ...state,
          onboardingStep: 2,
          lastMessageAt: new Date().toISOString(),
        },
        updatedDraft,
      ),
    };
  }

  if (step === 2) {
    const category = await parseCategory(message.body);
    if (!category) {
      return {
        response: "I couldn't parse the category. Is it barber, salon, restaurant, or something else?",
        state: withDraft(state, draft),
      };
    }

    const updatedDraft = { ...draft, category };
    return {
      response:
        "List your services and prices however feels natural. Like: 'Haircut $25, Fade $30'",
      state: withDraft(
        {
          ...state,
          onboardingStep: 3,
          lastMessageAt: new Date().toISOString(),
        },
        updatedDraft,
      ),
    };
  }

  if (step === 3) {
    const services = await parseServices(message.body);
    if (!services || services.length === 0) {
      return {
        response:
          "I couldn't parse the services yet. Try something like: Haircut $25, Fade $30, Beard Trim $15",
        state: withDraft(state, draft),
      };
    }

    const updatedDraft = { ...draft, services };
    return {
      response: formatServicesForConfirmation(services),
      state: withDraft(
        {
          ...state,
          onboardingStep: 4,
          lastMessageAt: new Date().toISOString(),
        },
        updatedDraft,
      ),
    };
  }

  if (step === 4) {
    if (isAffirmative(message.body)) {
      return {
        response: "What are your hours? Like: 'Mon-Fri 9-6, Sat 10-4, closed Sunday'",
        state: withDraft(
          {
            ...state,
            onboardingStep: 5,
            lastMessageAt: new Date().toISOString(),
          },
          draft,
        ),
      };
    }

    const services = await parseServices(message.body);
    if (!services || services.length === 0) {
      return {
        response: "Please resend your corrected services with prices, and I'll confirm again.",
        state: withDraft(state, draft),
      };
    }

    const updatedDraft = { ...draft, services };
    return {
      response: formatServicesForConfirmation(services),
      state: withDraft(state, updatedDraft),
    };
  }

  if (step === 5) {
    const hours = await parseHours(message.body);
    if (!hours || hours.length !== 7) {
      return {
        response:
          "I couldn't parse your hours. Try: Mon-Fri 9-6, Sat 10-4, closed Sunday.",
        state: withDraft(state, draft),
      };
    }

    const updatedDraft = { ...draft, hours };
    return {
      response: "What's your address? Helps customers find you.",
      state: withDraft(
        {
          ...state,
          onboardingStep: 6,
          lastMessageAt: new Date().toISOString(),
        },
        updatedDraft,
      ),
    };
  }

  if (step === 6) {
    const address = message.body.trim();
    if (!address) {
      return {
        response: "I didn't catch the address. What's your business address?",
        state: withDraft(state, draft),
      };
    }

    const updatedDraft = { ...draft, address };
    const { shopId, slug } = await completeOnboarding(message.from, updatedDraft);
    await rebuildSite(shopId);

    return {
      response: `Your page is live! ${config.BASE_URL.replace(/\/$/, '')}/s/${slug} - You can update anything anytime, just text me.`,
      state: {
        ...state,
        mode: 'active',
        onboardingStep: undefined,
        pendingAction: undefined,
        shopId,
        lastMessageAt: new Date().toISOString(),
      },
    };
  }

  return {
    response: WELCOME_MESSAGE,
    state: withDraft(
      {
        ...state,
        mode: 'onboarding',
        onboardingStep: 1,
        lastMessageAt: new Date().toISOString(),
      },
      draft,
    ),
  };
}
