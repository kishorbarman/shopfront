import type { InboundMessage } from '../models/types';
import {
  addMessage,
  checkRateLimit,
  getState,
  setState,
  type ConversationState,
} from './conversationState';

function createInitialState(): ConversationState {
  return {
    mode: 'onboarding',
    onboardingStep: 1,
    lastMessageAt: new Date().toISOString(),
  };
}

export async function processMessage(message: InboundMessage): Promise<string> {
  const rateLimit = await checkRateLimit(message.from);

  if (!rateLimit.allowed) {
    return "You're sending messages too quickly. Please slow down and try again in a minute.";
  }

  const state = (await getState(message.from)) ?? createInitialState();

  await addMessage(message.from, 'user', message.body);

  state.lastMessageAt = new Date().toISOString();
  await setState(message.from, state);

  console.log('Conversation state', {
    phone: message.from,
    mode: state.mode,
    onboardingStep: state.onboardingStep,
    shopId: state.shopId ?? null,
  });

  const response = `Got your message (${state.mode}): ${message.body}`;
  await addMessage(message.from, 'agent', response);

  return response;
}
