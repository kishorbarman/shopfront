import { prisma } from '../lib/prisma';
import type { InboundMessage } from '../models/types';
import {
  addMessage,
  checkRateLimit,
  getState,
  setState,
  type ConversationState,
} from './conversationState';
import { runOnboarding } from '../agent/onboarding';

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
    select: { id: true },
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
    state.lastMessageAt = new Date().toISOString();
    response = `Got your message (${state.mode}): ${message.body}`;
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
