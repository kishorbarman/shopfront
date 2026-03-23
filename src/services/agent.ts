import type { Hour, Notice, Service, Shop } from '@prisma/client';

import config from '../config';
import { classifyIntent, isPhotoIntentFromMedia } from '../agent/classifier';
import {
  extractMutationEntities,
  formatQueryResponse,
  type MutationIntent,
} from '../agent/extractors';
import type { IntentCategory } from '../agent/intents';
import { runOnboarding } from '../agent/onboarding';
import { routeMessage } from '../agent/router';
import { AgentParseError, DatabaseError, RateLimitError, SpamGuardError, ValidationError } from '../lib/errors';
import logger from '../lib/logger';
import { reportError } from '../lib/observability';
import { incrementCounter } from '../lib/opsMetrics';
import { prisma } from '../lib/prisma';
import { findIdentityByExternalUserId, upsertChannelIdentity } from './channelIdentity';
import type { InboundMessage } from '../models/types';
import { addImagesToGallery, downloadAndStoreImages, type StoredImage } from './mediaStorage';
import { rebuildSite } from './siteBuilder';
import { createTelegramLinkCode, isTelegramLinkCodeRequest } from './telegramLinking';
import {
  addService,
  addNotice,
  deleteWebsiteAndData,
  removeNotice,
  removeService,
  updateContact,
  updateHours,
  updateService,
} from './shopUpdater';
import {
  addMessage,
  checkRateLimit,
  checkSpamGuard,
  clearConversationData,
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

function normalizeDeletionMessage(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isDeleteWebsiteRequest(text: string): boolean {
  const normalized = normalizeDeletionMessage(text);

  if (normalized === 'delete my website') {
    return true;
  }

  return /(delete|remove|erase)\s+(my\s+)?(website|site|page|shop|business page)/.test(normalized);
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

function parseOperationalCommand(text: string): 'status' | 'site' | 'support' | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === '/status' || normalized === 'status') return 'status';
  if (normalized === '/site' || normalized === 'site') return 'site';
  if (normalized === '/support' || normalized === 'support') return 'support';
  return null;
}

function buildSiteUrl(slug: string): string {
  return config.BASE_URL.replace(/\/$/, '') + '/s/' + slug;
}

function describeHourChanges(changes: Array<{ dayOfWeek: number; openTime?: string; closeTime?: string; isClosed?: boolean }>): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const lines = changes.map((change) => {
    const day = dayNames[change.dayOfWeek] ?? `Day ${change.dayOfWeek}`;
    if (change.isClosed) return `${day}: Closed`;
    if (change.openTime && change.closeTime) return `${day}: ${change.openTime}-${change.closeTime}`;
    if (change.openTime) return `${day}: opens at ${change.openTime}`;
    if (change.closeTime) return `${day}: closes at ${change.closeTime}`;
    return `${day}: Updated`;
  });
  return lines.join('; ');
}

type ShopContext = Shop & {
  services: Pick<Service, 'name' | 'price'>[];
  hours: Pick<Hour, 'dayOfWeek' | 'openTime' | 'closeTime' | 'isClosed'>[];
  notices: Notice[];
};

async function loadShopContextByPhone(phone: string): Promise<ShopContext | null> {
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

async function loadShopContextById(shopId: string): Promise<ShopContext | null> {
  return prisma.shop.findUnique({
    where: { id: shopId },
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

async function loadShopContext(message: InboundMessage): Promise<ShopContext | null> {
  if (message.channel === 'telegram' && message.externalUserId) {
    const identity = await findIdentityByExternalUserId('telegram', message.externalUserId);
    if (identity) {
      return loadShopContextById(identity.shopId);
    }
  }

  return loadShopContextByPhone(message.from);
}

async function refreshShopContext(
  message: InboundMessage,
  existingShop: ShopContext | null,
): Promise<ShopContext | null> {
  if (existingShop) {
    return loadShopContextById(existingShop.id);
  }

  return loadShopContext(message);
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
    const requestedServices = Array.isArray(data.services)
      ? data.services
      : [{ name: data.name, price: Number(data.price), description: data.description }];

    const createdServices = [] as Array<{ name: string; price: string }>;

    for (const service of requestedServices) {
      const created = await addService(shop.id, {
        name: service.name,
        price: Number(service.price),
        description: service.description,
      });
      createdServices.push({ name: created.name, price: created.price.toString() });
    }

    const response =
      createdServices.length === 1
        ? `Done! ${createdServices[0].name} ($${createdServices[0].price}) added to your menu.`
        : `Done! Added ${createdServices.length} services: ${createdServices
            .map((service) => `${service.name} ($${service.price})`)
            .join(', ')}.`;

    return {
      response,
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
    const detail = Array.isArray(data.changes) ? describeHourChanges(data.changes) : 'Hours updated.';
    return {
      response: 'Updated! Hours changed: ' + detail,
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
      response: 'Got it! Closure notice posted: "' + data.message + '".',
      state: { ...state, mode: 'active', pendingAction: undefined },
    };
  }

  if (intent === 'update_contact') {
    await updateContact(shop.id, data.field, data.value);
    return {
      response: 'Updated! ' + data.field + ' is now ' + data.value + '.',
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
      response: 'Done! Notice is live: "' + data.message + '".',
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
    const spamGuard = await checkSpamGuard(message.from, message.channel, message.body);
    if (!spamGuard.allowed) {
      incrementCounter('spamBlocks');
      logger.warn(
        {
          event: 'spam_blocked',
          phone: message.from,
          channel: message.channel,
          duplicateCount: spamGuard.count,
        },
        'Message blocked by spam guard',
      );
      throw new SpamGuardError('User tripped duplicate-message spam guard.');
    }

    const rateLimit = await checkRateLimit(message.from, message.channel);

    if (!rateLimit.allowed) {
      incrementCounter('rateLimitBlocks');
      logger.warn(
        {
          event: 'rate_limit_blocked',
          phone: message.from,
          channel: message.channel,
          limit: rateLimit.limit,
          count: rateLimit.count,
        },
        'Message blocked by channel rate limit',
      );
      throw new RateLimitError('User exceeded per-channel rate limit.');
    }

    existingShop = await loadShopContext(message);

    state = await getState(message.from);
    if (!state) {
      state = existingShop ? createStateForKnownShop(existingShop.id) : createStateForUnknownShop();
    }

    await addMessage(message.from, 'user', message.body);

    const operationalCommand = parseOperationalCommand(message.body);
    if (operationalCommand) {
      let response: string;

      if (operationalCommand === 'support') {
        response =
          'Support: I will troubleshoot first. If I am not confident, I escalate to a human specialist. You can also email contact@shopfront.page.';
      } else if (operationalCommand === 'status') {
        if (!existingShop) {
          response =
            'Status: no active shop found for this account yet. Tell me your business name to start onboarding.';
        } else {
          const pending = state.pendingAction?.intent ? ', pending=' + state.pendingAction.intent : '';
          response =
            'Status: ' +
            existingShop.name +
            ' (' +
            existingShop.status +
            '), mode=' +
            state.mode +
            pending +
            '.';
        }
      } else {
        if (!existingShop) {
          response = 'No live site yet. Complete onboarding first and then use this command again.';
        } else {
          response = 'Your live site: ' + buildSiteUrl(existingShop.slug);
        }
      }

      state = {
        ...state,
        mode: existingShop ? 'active' : state.mode,
        shopId: existingShop?.id ?? state.shopId,
        pendingAction: undefined,
        lastMessageAt: new Date().toISOString(),
      };

      await setState(message.from, state);
      await addMessage(message.from, 'agent', response);
      return response;
    }

    let response: string;

    if (
      existingShop &&
      (message.channel === 'sms' || message.channel === 'whatsapp') &&
      isTelegramLinkCodeRequest(message.body)
    ) {
      const code = await createTelegramLinkCode(existingShop.id);
      response =
        'Telegram link code: ' +
        code +
        '. Open Telegram and send /link ' +
        code +
        ' to your Shopfront bot within 10 minutes.';

      state = {
        ...state,
        mode: 'active',
        shopId: existingShop.id,
        pendingAction: undefined,
        lastMessageAt: new Date().toISOString(),
      };

      await setState(message.from, state);
      await addMessage(message.from, 'agent', response);
      return response;
    }

    if (!existingShop || state.mode === 'onboarding') {
      const onboarding = await runOnboarding(message, state);
      state = onboarding.state;
      response = onboarding.response;
    } else {
      if (state.mode === 'awaiting_confirmation' && state.pendingAction) {
        if (state.pendingAction.intent === 'delete_website') {
          const expected = String(state.pendingAction.data.expectedMessage ?? '');
          const incoming = normalizeDeletionMessage(message.body);

          if (incoming === expected) {
            await deleteWebsiteAndData({
              id: existingShop.id,
              phone: existingShop.phone,
              slug: existingShop.slug,
            });

            await clearConversationData(message.from);

            response = 'Done. Your website and related data have been permanently deleted.';
            return response;
          }

          if (isNegative(message.body)) {
            state = {
              ...state,
              mode: 'active',
              pendingAction: undefined,
              lastMessageAt: new Date().toISOString(),
            };
            response = 'Deletion cancelled. Your website is still live.';

            await setState(message.from, state);
            await addMessage(message.from, 'agent', response);
            return response;
          }

          const original = String(state.pendingAction.data.originalMessage ?? 'delete my website');
          response = `To confirm deletion, repeat this exact message: "${original}"`;
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
          try {
            const executed = await executePendingAction(existingShop, state);
            state = {
              ...executed.state,
              shopId: existingShop.id,
              lastMessageAt: new Date().toISOString(),
            };
            response = executed.response;
          } catch (error) {
            const typedError = error instanceof Error ? error : new Error(String(error));

            if (typedError instanceof ValidationError || typedError instanceof AgentParseError) {
              // Prevent stale pending actions from trapping the user in a broken confirmation loop.
              state = {
                ...state,
                mode: 'active',
                pendingAction: undefined,
                shopId: existingShop.id,
                lastMessageAt: new Date().toISOString(),
              };
              response = "I couldn't apply that confirmation safely. Please restate the change in one message.";

              await setState(message.from, state);
              await addMessage(message.from, 'agent', response);
              return response;
            }

            throw error;
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

      if (isDeleteWebsiteRequest(message.body)) {
        const originalMessage = message.body.trim();
        const expectedMessage = normalizeDeletionMessage(originalMessage);

        state = {
          ...state,
          mode: 'awaiting_confirmation',
          shopId: existingShop.id,
          pendingAction: {
            intent: 'delete_website',
            data: {
              expectedMessage,
              originalMessage,
            },
            confirmationMessage: `Repeat this exact message to permanently delete your website: "${originalMessage}"`,
          },
          lastMessageAt: new Date().toISOString(),
        };

        response = `This is permanent. To confirm deletion, repeat this exact message: "${originalMessage}"`;

        await setState(message.from, state);
        await addMessage(message.from, 'agent', response);
        return response;
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
        const refreshed = (await refreshShopContext(message, existingShop)) ?? existingShop;
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

        const transientState: ConversationState = {
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

        const executed = await executePendingAction(existingShop, transientState);
        response = executed.response;
        state = {
          ...executed.state,
          shopId: existingShop.id,
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

      existingShop = await loadShopContext(message);
      if (existingShop) {
        state.shopId = existingShop.id;
      }
    }

    await setState(message.from, state);

    if (message.channel === 'telegram' && message.externalUserId && state.shopId) {
      await upsertChannelIdentity(state.shopId, {
        channel: 'telegram',
        externalUserId: message.externalUserId,
        externalSpaceId: message.externalSpaceId,
        phone: message.from,
      });
    }

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
