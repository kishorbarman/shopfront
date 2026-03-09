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
import { AgentParseError, DatabaseError, RateLimitError } from '../lib/errors';
import logger from '../lib/logger';
import { reportError } from '../lib/observability';
import { prisma } from '../lib/prisma';
import type { InboundMessage } from '../models/types';
import { addImagesToGallery, downloadAndStoreImages, type StoredImage } from './mediaStorage';
import { rebuildSite } from './siteBuilder';
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

type PhotoTarget = 'banner' | 'gallery' | 'unknown';

function detectPhotoTarget(text: string): PhotoTarget {
  const lower = text.toLowerCase();

  if (/(banner|main photo|profile|hero|cover)/.test(lower)) {
    return 'banner';
  }

  if (/(gallery|album|add this photo|add this image|portfolio)/.test(lower)) {
    return 'gallery';
  }

  return 'unknown';
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

async function applyPhotoSelection(
  shopId: string,
  target: Exclude<PhotoTarget, 'unknown'>,
  storedImages: StoredImage[],
): Promise<string> {
  if (storedImages.length === 0) {
    throw new AgentParseError('No images available to apply.');
  }

  if (target === 'banner') {
    const first = storedImages[0];
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        photoUrl: first.url,
      },
    });
    await rebuildSite(shopId);

    return 'Done! Your new banner photo is live.';
  }

  await addImagesToGallery(shopId, storedImages);
  await rebuildSite(shopId);
  return storedImages.length === 1
    ? 'Done! I added this photo to your gallery.'
    : `Done! I added ${storedImages.length} photos to your gallery.`;
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
    const target: Exclude<PhotoTarget, 'unknown'> = data.useAsMain === false ? 'gallery' : 'banner';
    const images = Array.isArray(data.images) ? (data.images as StoredImage[]) : [];
    const response = await applyPhotoSelection(shop.id, target, images);

    return {
      response,
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  return {
    response: "I couldn't execute that action. Let's try again.",
    state: { ...state, mode: 'active', pendingAction: undefined },
  };
}

async function handleMediaForKnownShop(
  shop: ShopContext,
  state: ConversationState,
  message: InboundMessage,
): Promise<{ response: string; state: ConversationState } | null> {
  if (message.mediaUrls.length === 0) {
    return null;
  }

  let storedImages: StoredImage[];
  try {
    storedImages = await downloadAndStoreImages(shop.id, message.mediaUrls);
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        event: 'error',
        type: 'MediaProcessingError',
        phone: message.from,
        shopId: shop.id,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Media processing failed',
    );

    return {
      response: 'I could not process that image. Please send a JPEG, PNG, or WebP under 10MB.',
      state: {
        ...state,
        mode: 'active',
        shopId: shop.id,
        lastMessageAt: new Date().toISOString(),
      },
    };
  }

  const target = detectPhotoTarget(message.body);

  if (target === 'banner' || target === 'gallery') {
    const response = await applyPhotoSelection(shop.id, target, storedImages);
    return {
      response,
      state: {
        ...state,
        mode: 'active',
        shopId: shop.id,
        pendingAction: undefined,
        lastMessageAt: new Date().toISOString(),
      },
    };
  }

  return {
    response: 'Nice photo! Should I use this as your main banner, or add it to your gallery?',
    state: {
      ...state,
      mode: 'awaiting_confirmation',
      shopId: shop.id,
      pendingAction: {
        intent: 'update_photo',
        data: {
          awaitingPhotoTarget: true,
          images: storedImages,
        },
        confirmationMessage: 'Choose banner or gallery.',
      },
      lastMessageAt: new Date().toISOString(),
    },
  };
}

function wrapDatabaseError(error: unknown): DatabaseError {
  const typedError = error instanceof Error ? error : new Error(String(error));
  return new DatabaseError(typedError.message);
}

export async function processMessage(message: InboundMessage): Promise<string> {
  let existingShop: ShopContext | null = null;
  let state: ConversationState | null = null;
  let lastIntent: IntentCategory | undefined;

  try {
    const rateLimit = await checkRateLimit(message.from);

    if (!rateLimit.allowed) {
      throw new RateLimitError('User exceeded per-phone rate limit.');
    }

    existingShop = await loadShopContext(message.from);

    state = await getState(message.from);
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
        if (state.pendingAction.intent === 'update_photo' && state.pendingAction.data.awaitingPhotoTarget) {
          const choice = detectPhotoTarget(message.body);
          const storedImages = Array.isArray(state.pendingAction.data.images)
            ? (state.pendingAction.data.images as StoredImage[])
            : [];

          if (choice === 'banner' || choice === 'gallery') {
            response = await applyPhotoSelection(existingShop.id, choice, storedImages);

            state = {
              ...state,
              mode: 'active',
              pendingAction: undefined,
              shopId: existingShop.id,
              lastMessageAt: new Date().toISOString(),
            };

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
            response = 'No problem, I cancelled the photo update. Send another image any time.';

            await setState(message.from, state);
            await addMessage(message.from, 'agent', response);
            return response;
          }

          response = 'Please say "banner" to set your main photo, or "gallery" to add it to your gallery.';
          state = {
            ...state,
            mode: 'awaiting_confirmation',
            shopId: existingShop.id,
            lastMessageAt: new Date().toISOString(),
          };

          await setState(message.from, state);
          await addMessage(message.from, 'agent', response);
          return response;
        }

        if (isAffirmative(message.body)) {
          const executed = await executePendingAction(existingShop, state);
          state = {
            ...executed.state,
            shopId: existingShop.id,
            lastMessageAt: new Date().toISOString(),
          };
          response = executed.response;

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

      const mediaHandled = await handleMediaForKnownShop(existingShop, state, message);
      if (mediaHandled) {
        state = mediaHandled.state;
        response = mediaHandled.response;

        await setState(message.from, state);
        await addMessage(message.from, 'agent', response);
        return response;
      }

      const history = await getHistory(message.from);
      const classificationStartedAt = Date.now();

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

      lastIntent = classification.intent;

      logger.info(
        {
          event: 'intent_classified',
          phone: message.from,
          intent: classification.intent,
          confidence: classification.confidence,
          durationMs: Date.now() - classificationStartedAt,
        },
        'Intent classification completed',
      );

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
          throw new AgentParseError(extraction.reason);
        }

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
      } else {
        response = await routeMessage(message, classification, state, existingShop);
        state = {
          ...state,
          mode: 'active',
          shopId: existingShop.id,
          lastMessageAt: new Date().toISOString(),
        };
      }

      existingShop = await loadShopContext(message.from);
      if (existingShop) {
        state.shopId = existingShop.id;
      }
    }

    await setState(message.from, state);

    logger.info(
      {
        event: 'conversation_state_updated',
        phone: message.from,
        mode: state.mode,
        onboardingStep: state.onboardingStep,
        shopId: state.shopId ?? null,
      },
      'Conversation state updated',
    );

    await addMessage(message.from, 'agent', response);

    return response;
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));

    logger.error(
      {
        event: 'error',
        type: typedError.name,
        phone: message.from,
        shopId: state?.shopId ?? existingShop?.id,
        intent: lastIntent,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Agent pipeline failed',
    );

    reportError(typedError, {
      tags: {
        shopId: state?.shopId ?? existingShop?.id,
        intent: lastIntent,
        channel: message.channel,
      },
      extra: {
        phone: message.from,
        twilioSid: message.id,
      },
    });

    if (typedError instanceof DatabaseError || typedError.name === 'PrismaClientKnownRequestError') {
      throw wrapDatabaseError(typedError);
    }

    throw typedError;
  }
}
