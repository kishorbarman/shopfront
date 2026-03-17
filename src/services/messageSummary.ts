import type { MessageProcessStatus } from '@prisma/client';

import type { ConversationState } from './conversationState';

type SummaryInput = {
  messageBody: string;
  beforeState: ConversationState | null;
  afterState: ConversationState | null;
  updateApplied: boolean;
  status: MessageProcessStatus;
};

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|correct|looks good|right|ok|okay|do it|sure)\b/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(no|nope|cancel|never mind|dont|don't|stop)\b/i.test(text.trim());
}

function formatDay(day: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ?? `Day ${day}`;
}

function formatHoursChanges(changes: unknown): string {
  if (!Array.isArray(changes) || changes.length === 0) {
    return 'updating hours';
  }

  const parts = changes
    .map((raw) => {
      if (!raw || typeof raw !== 'object') {
        return null;
      }

      const change = raw as {
        dayOfWeek?: number;
        openTime?: string;
        closeTime?: string;
        isClosed?: boolean;
      };
      const day = formatDay(change.dayOfWeek ?? -1);

      if (change.isClosed === true) {
        return `${day} to Closed`;
      }

      if (change.openTime && change.closeTime) {
        return `${day} to Open ${change.openTime}-${change.closeTime}`;
      }

      if (change.isClosed === false) {
        return `${day} to Open`;
      }

      if (change.closeTime) {
        return `${day} closing time to ${change.closeTime}`;
      }

      if (change.openTime) {
        return `${day} opening time to ${change.openTime}`;
      }

      return `${day} hours`;
    })
    .filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return 'updating hours';
  }

  return `changing ${parts.join('; ')}`;
}

function formatAction(intent: string, data: Record<string, any> | undefined): string {
  const payload = data ?? {};

  switch (intent) {
    case 'add_service':
      return `adding ${payload.name ?? 'service'} at $${payload.price ?? '?'}`;
    case 'update_service': {
      const name = payload.serviceName ?? 'service';
      const details: string[] = [];
      if (payload.newPrice !== undefined) {
        details.push(`price to $${payload.newPrice}`);
      }
      if (payload.newName) {
        details.push(`name to ${payload.newName}`);
      }
      return details.length > 0 ? `changing ${name} ${details.join(' and ')}` : `changing ${name}`;
    }
    case 'remove_service':
      return `removing ${payload.serviceName ?? 'service'}`;
    case 'update_hours':
      return formatHoursChanges(payload.changes);
    case 'temp_closure':
      return `posting closure notice "${payload.message ?? 'temporary closure'}"`;
    case 'update_contact':
      return `updating ${payload.field ?? 'contact'} to ${payload.value ?? 'new value'}`;
    case 'add_notice':
      return `adding ${payload.type ?? 'info'} notice "${payload.message ?? ''}"`.trim();
    case 'remove_notice':
      return 'removing notice';
    case 'update_photo':
      return payload.useAsMain === false ? 'adding photo to gallery' : 'updating banner photo';
    case 'delete_website':
      return 'deleting website and all related data';
    default:
      return 'processing update';
  }
}

function formatIntentAction(intent: string, data: Record<string, any> | undefined): string {
  return `${intent}: ${formatAction(intent, data)}`;
}

export function summarizeMessageAction(input: SummaryInput): string | undefined {
  if (input.status === 'FAILED') {
    return undefined;
  }

  const beforePending = input.beforeState?.pendingAction;
  const afterPending = input.afterState?.pendingAction;

  if (afterPending) {
    return formatIntentAction(afterPending.intent, afterPending.data);
  }

  if (input.updateApplied && beforePending) {
    return formatIntentAction(beforePending.intent, beforePending.data);
  }

  if (beforePending && !afterPending) {
    if (isNegative(input.messageBody)) {
      return `${beforePending.intent}: cancelled`;
    }

    if (isAffirmative(input.messageBody)) {
      return formatIntentAction(beforePending.intent, beforePending.data);
    }
  }

  return undefined;
}
