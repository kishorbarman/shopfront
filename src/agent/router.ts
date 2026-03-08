import type { Shop } from '@prisma/client';

import type { InboundMessage } from '../models/types';
import type { ConversationState } from '../services/conversationState';
import type { ClassificationResult } from './intents';

const FALLBACK_UNKNOWN =
  'I can help with your services, hours, and photos. What would you like to update?';

export async function routeMessage(
  _message: InboundMessage,
  classification: ClassificationResult,
  state: ConversationState,
  shop: Shop,
): Promise<string> {
  void state;
  void shop;

  if (classification.needsClarification) {
    return (
      classification.clarificationQuestion ??
      'Can you clarify what you want to update: services, hours, notices, contact, or photos?'
    );
  }

  switch (classification.intent) {
    case 'add_service':
      return "I'll add that service for you. (not implemented yet)";
    case 'update_service':
      return "I'll update that service. (not implemented yet)";
    case 'remove_service':
      return "I'll remove that service. (not implemented yet)";
    case 'update_hours':
      return "I'll update your hours. (not implemented yet)";
    case 'temp_closure':
      return "I'll add a temporary closure notice. (not implemented yet)";
    case 'update_contact':
      return "I'll update your contact details. (not implemented yet)";
    case 'update_photo':
      return "I'll update your photo. (not implemented yet)";
    case 'add_notice':
      return "I'll add that notice for you. (not implemented yet)";
    case 'remove_notice':
      return "I'll remove that notice. (not implemented yet)";
    case 'query':
      return 'Let me look that up. (not implemented yet)';
    case 'greeting':
      return `Hey! I'm here to help with your services, hours, notices, and photos. What would you like to update?`;
    case 'help':
      return 'I can add/update/remove services, update hours, post notices, update contact info, and manage photos. What should I update?';
    case 'unknown':
    default:
      return FALLBACK_UNKNOWN;
  }
}
