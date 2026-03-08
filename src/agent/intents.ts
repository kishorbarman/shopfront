export const INTENTS = [
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
] as const;

export type IntentCategory = (typeof INTENTS)[number];
