export type IntentCategory =
  | 'add_service'
  | 'update_service'
  | 'remove_service'
  | 'update_hours'
  | 'temp_closure'
  | 'update_contact'
  | 'update_photo'
  | 'add_notice'
  | 'remove_notice'
  | 'query'
  | 'greeting'
  | 'help'
  | 'unknown';

export interface ClassificationResult {
  intent: IntentCategory;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
  rawEntities?: Record<string, any>;
}

export const SUPPORTED_INTENTS: IntentCategory[] = [
  'add_service',
  'update_service',
  'remove_service',
  'update_hours',
  'temp_closure',
  'update_contact',
  'update_photo',
  'add_notice',
  'remove_notice',
  'query',
  'greeting',
  'help',
  'unknown',
];
