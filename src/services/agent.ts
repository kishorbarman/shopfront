import { classifyIntent, isPhotoIntentFromMedia } from '../agent/classifier';
import { runOnboarding } from '../agent/onboarding';
import { routeMessage } from '../agent/router';
import { prisma } from '../lib/prisma';
import type { InboundMessage } from '../models/types';
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

export async function processMessage(message: InboundMessage): Promise<string> {
  const rateLimit = await checkRateLimit(message.from);

  if (!rateLimit.allowed) {
    return "You're sending messages too quickly. Please slow down and try again in a minute.";
  }

  const existingShop = await prisma.shop.findUnique({
    where: { phone: message.from },
    include: {
      services: {
        where: { isActive: true },
        select: { name: true },
      },
    },
  });

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

    response = await routeMessage(message, classification, state, existingShop);
    state = {
      ...state,
      mode: 'active',
      shopId: existingShop.id,
      lastMessageAt: new Date().toISOString(),
    };

    console.log('Intent classification', {
      phone: message.from,
      intent: classification.intent,
      confidence: classification.confidence,
      needsClarification: classification.needsClarification,
    });
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
