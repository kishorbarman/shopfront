import * as Sentry from '@sentry/node';

import config from '../config';
import logger from './logger';

type ReportOptions = {
  tags?: Record<string, string | number | boolean | undefined>;
  extra?: Record<string, unknown>;
};

let sentryInitialized = false;

export function initSentry(): void {
  if (sentryInitialized || !config.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: 0.1,
  });

  sentryInitialized = true;
  logger.info({ event: 'sentry_initialized' }, 'Sentry initialized');
}

export function reportError(error: unknown, options?: ReportOptions): void {
  if (!sentryInitialized) {
    return;
  }

  Sentry.withScope((scope) => {
    if (options?.tags) {
      for (const [key, value] of Object.entries(options.tags)) {
        if (value !== undefined) {
          scope.setTag(key, String(value));
        }
      }
    }

    if (options?.extra) {
      for (const [key, value] of Object.entries(options.extra)) {
        scope.setExtra(key, value);
      }
    }

    Sentry.captureException(error);
  });
}

export function triggerOperationalAlert(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const error = new Error(code + ': ' + message);

  logger.error(
    {
      event: 'alert_triggered',
      code,
      message,
      ...(details ?? {}),
    },
    'Operational alert triggered',
  );

  reportError(error, {
    tags: {
      alertCode: code,
      severity: 'high',
    },
    extra: details,
  });
}

export { Sentry };
