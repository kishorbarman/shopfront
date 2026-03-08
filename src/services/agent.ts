import type { Hour, Notice, Service, Shop } from '@prisma/client';

import { classifyIntent, isPhotoIntentFromMedia } from '../agent/classifier';
import {
  extractMutationEntities,
  formatQueryResponse,
  type MutationIntent,
} from '../agent/extractors';
import type { IntentCategory } from '../agent/intents';
import { runOnboarding } from '../agent/onboarding';
import { routeMessage } from '../agent/router';
import { prisma } from '../lib/prisma';
import type { InboundMessage } from '../models/types';
import {
  addService,
  addNotice,
  removeNotice,
  removeService,
  updateContact,
  updateHours,
  updateService,
} from './shopUpdater';
import {
  addMessage,
  checkRateLimit,
  getHistory,
  getState,
  setState,
  type ConversationState,
} from './conversationState';

function createStateForUnknownShop(): ConversationState {
  return {
    mode: 'onboarding',
    onboardingStep: undefined,
    lastMessageAt: new Date().toISOString(),
  };
}

function createStateForKnownShop(shopId: string): ConversationState {
  return {
    mode: 'active',
    shopId,
    lastMessageAt: new Date().toISOString(),
  };
}

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|correct|looks good|right|ok|okay|do it|sure)\b/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(no|nope|cancel|never mind|dont|don't|stop)\b/i.test(text.trim());
}

function isMutationIntent(intent: IntentCategory): intent is MutationIntent {
  return [
    'add_service',
    'update_service',
    'remove_service',
    'update_hours',
    'temp_closure',
    'update_contact',
    'add_notice',
    'remove_notice',
    'update_photo',
  ].includes(intent);
}

type ShopContext = Shop & {
  services: Pick<Service, 'name' | 'price'>[];
  hours: Pick<Hour, 'dayOfWeek' | 'openTime' | 'closeTime' | 'isClosed'>[];
  notices: Notice[];
};

async function loadShopContext(phone: string): Promise<ShopContext | null> {
  return prisma.shop.findUnique({
    where: { phone },
    include: {
      services: {
        where: { isActive: true },
        select: { name: true, price: true },
      },
      hours: {
        select: { dayOfWeek: true, openTime: true, closeTime: true, isClosed: true },
      },
      notices: {
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
    },
  }) as unknown as Promise<ShopContext | null>;
}

async function executePendingAction(
  shop: ShopContext,
  state: ConversationState,
): Promise<{ response: string; state: ConversationState }> {
  const pending = state.pendingAction;
  if (!pending) {
    return {
      response: 'There is no pending action to confirm.',
      state: {
        ...state,
        mode: 'active',
        pendingAction: undefined,
      },
    };
  }

  const intent = pending.intent as IntentCategory;
  const data = pending.data;

  if (intent === 'add_service') {
    const created = await addService(shop.id, {
      name: data.name,
      price: Number(data.price),
      description: data.description,
    });

    return {
      response: `Done! ${created.name} ($${created.price.toString()}) added to your menu.`,
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'update_service') {
    const updated = await updateService(shop.id, data.serviceName, {
      newPrice: data.newPrice !== undefined ? Number(data.newPrice) : undefined,
      newName: data.newName,
    });

    return {
      response: `Updated! ${updated.name} is now $${updated.price.toString()}.`,
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'remove_service') {
    const removed = await removeService(shop.id, data.serviceName);
    return {
      response: `Removed! ${removed.name} is off your menu.`,
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'update_hours') {
    await updateHours(shop.id, data.changes);
    return {
      response: 'Done! Your hours have been updated.',
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'temp_closure') {
    await addNotice(shop.id, {
      message: data.message,
      type: 'closure',
      startsAt: data.startsAt,
      expiresAt: data.expiresAt,
    });

    return {
      response: "Got it! You're marked as closed for that period.",
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'update_contact') {
    await updateContact(shop.id, data.field, data.value);
    return {
      response: `Done! Your ${data.field} has been updated.`,
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'add_notice') {
    await addNotice(shop.id, {
      message: data.message,
      type: data.type ?? 'info',
      startsAt: new Date().toISOString(),
    });

    return {
      response: 'Done! Your notice is now live.',
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'remove_notice') {
    await removeNotice(shop.id, data.noticeId);
    return {
      response: 'Done! The notice has been removed.',
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'update_photo') {
    return {
      response: 'Got it. I saved this photo request. Full photo updates land in Step 8.',
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  return {
    response: "I couldn't execute that action. Let's try again.",
    state: { ...state, mode: 'active', pendingAction: undefined },
  };
}

export async function processMessage(message: InboundMessage): Promise<string> {
  const rateLimit = await checkRateLimit(message.from);

  if (!rateLimit.allowed) {
    return "You're sending messages too quickly. Please slow down and try again in a minute.";
  }

  let existingShop = await loadShopContext(message.from);

  let state = await getState(message.from);
  if (!state) {
    state = existingShop ? createStateForKnownShop(existingShop.id) : createStateForUnknownShop();
  }

  await addMessage(message.from, 'user', message.body);

  let response: string;

  if (!existingShop || state.mode === 'onboarding') {
    const onboarding = await runOnboarding(message, state);
    state = onboarding.state;
    response = onboarding.response;
  } else {
    if (state.mode === 'awaiting_confirmation' && state.pendingAction) {
      if (isAffirmative(message.body)) {
        try {
          const executed = await executePendingAction(existingShop, state);
          state = {
            ...executed.state,
            shopId: existingShop.id,
            lastMessageAt: new Date().toISOString(),
          };
          response = executed.response;
        } catch (error) {
          console.error('Pending action execution failed:', error);
          state = {
            ...state,
            mode: 'active',
            pendingAction: undefined,
            lastMessageAt: new Date().toISOString(),
          };
          response = 'Something went wrong applying that change. Please try again.';
        }

        await setState(message.from, state);
        await addMessage(message.from, 'agent', response);
        return response;
      }

      if (isNegative(message.body)) {
        state = {
          ...state,
          mode: 'active',
          pendingAction: undefined,
          lastMessageAt: new Date().toISOString(),
        };
        response = 'No problem. I cancelled that change. What would you like to do instead?';

        await setState(message.from, state);
        await addMessage(message.from, 'agent', response);
        return response;
      }

      state = {
        ...state,
        mode: 'active',
        pendingAction: undefined,
      };
    }

    const history = await getHistory(message.from);

    let classification = await classifyIntent(
      message.body,
      {
        name: existingShop.name,
        services: existingShop.services.map((service) => service.name),
      },
      history,
      { hasMedia: message.mediaUrls.length > 0 },
    );

    if (isPhotoIntentFromMedia(message.body, message.mediaUrls.length > 0)) {
      classification = {
        ...classification,
        intent: 'update_photo',
        confidence: Math.max(classification.confidence, 0.9),
        needsClarification: false,
      };
    }

    if (classification.intent === 'query') {
      const refreshed = (await loadShopContext(message.from)) ?? existingShop;
      response = formatQueryResponse(message.body, {
        services: refreshed.services.map((service) => ({
          name: service.name,
          price: service.price.toString(),
        })),
        hours: refreshed.hours,
        notices: refreshed.notices.map((notice) => ({
          message: notice.message,
          type: notice.type,
        })),
      });

      state = {
        ...state,
        mode: 'active',
        shopId: existingShop.id,
        lastMessageAt: new Date().toISOString(),
      };
    } else if (isMutationIntent(classification.intent)) {
      const extraction = await extractMutationEntities(classification.intent, message.body, {
        shopName: existingShop.name,
        services: existingShop.services.map((service) => service.name),
        notices: existingShop.notices.map((notice) => ({ id: notice.id, message: notice.message })),
        hasMedia: message.mediaUrls.length > 0,
      });

      if (!extraction.success) {
        response = extraction.clarificationQuestion;
        state = {
          ...state,
          mode: 'active',
          shopId: existingShop.id,
          lastMessageAt: new Date().toISOString(),
        };
      } else {
        response = extraction.confirmationMessage;
        state = {
          ...state,
          mode: 'awaiting_confirmation',
          shopId: existingShop.id,
          pendingAction: {
            intent: extraction.intent,
            data: extraction.data,
            confirmationMessage: extraction.confirmationMessage,
          },
          lastMessageAt: new Date().toISOString(),
        };
      }
    } else {
      response = await routeMessage(message, classification, state, existingShop);
      state = {
        ...state,
        mode: 'active',
        shopId: existingShop.id,
        lastMessageAt: new Date().toISOString(),
      };
    }

    console.log('Intent classification', {
      phone: message.from,
      intent: classification.intent,
      confidence: classification.confidence,
      needsClarification: classification.needsClarification,
    });

    existingShop = await loadShopContext(message.from);
    if (existingShop) {
      state.shopId = existingShop.id;
    }
  }

  await setState(message.from, state);

  console.log('Conversation state', {
    phone: message.from,
    mode: state.mode,
    onboardingStep: state.onboardingStep,
    shopId: state.shopId ?? null,
  });

  await addMessage(message.from, 'agent', response);

  return response;
}
