import dotenv from 'dotenv';

dotenv.config();

type NodeEnv = 'development' | 'production';

type AppConfig = {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_SMS_NUMBER: string;
  TWILIO_WHATSAPP_NUMBER: string;
  GEMINI_API_KEY: string;
  SENTRY_DSN: string;
  BASE_URL: string;
  SITE_OUTPUT_DIR: string;
  SKIP_TWILIO_VALIDATION: boolean;
  SKIP_TWILIO_SEND: boolean;
  MOCK_LLM: boolean;
};

function requiredString(name: string, env: NodeJS.ProcessEnv, errors: string[]): string {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`Missing required environment variable: ${name}`);
    return '';
  }
  return value;
}

function requiredPort(name: string, env: NodeJS.ProcessEnv, errors: string[]): number {
  const raw = requiredString(name, env, errors);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    errors.push(`Invalid ${name}: expected integer between 1 and 65535, received "${raw}"`);
    return 3000;
  }
  return value;
}

function parseBoolean(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveSiteOutputDir(env: NodeJS.ProcessEnv, nodeEnv: NodeEnv): string {
  const configured = env.SITE_OUTPUT_DIR?.trim();
  if (configured) {
    return configured;
  }

  return nodeEnv === 'production' ? '/tmp/sites' : 'public/sites';
}

function resolveMockLlm(env: NodeJS.ProcessEnv): boolean {
  return parseBoolean('MOCK_LLM', env) || parseBoolean('MOCK_ANTHROPIC', env);
}


function resolveGeminiApiKey(env: NodeJS.ProcessEnv): string {
  return env.GEMINI_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim() || '';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  const nodeEnv = requiredString('NODE_ENV', env, errors);
  const NODE_ENV: NodeEnv = nodeEnv === 'production' ? 'production' : 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'production') {
    errors.push(`Invalid NODE_ENV: expected "development" or "production", received "${nodeEnv}"`);
  }

  const mockLlm = resolveMockLlm(env);

  const config: AppConfig = {
    NODE_ENV,
    PORT: requiredPort('PORT', env, errors),
    DATABASE_URL: requiredString('DATABASE_URL', env, errors),
    REDIS_URL: requiredString('REDIS_URL', env, errors),
    TWILIO_ACCOUNT_SID: requiredString('TWILIO_ACCOUNT_SID', env, errors),
    TWILIO_AUTH_TOKEN: requiredString('TWILIO_AUTH_TOKEN', env, errors),
    TWILIO_SMS_NUMBER: requiredString('TWILIO_SMS_NUMBER', env, errors),
    TWILIO_WHATSAPP_NUMBER: requiredString('TWILIO_WHATSAPP_NUMBER', env, errors),
    GEMINI_API_KEY: mockLlm ? resolveGeminiApiKey(env) : resolveGeminiApiKey(env) || requiredString('GEMINI_API_KEY', env, errors),
    SENTRY_DSN: env.SENTRY_DSN?.trim() ?? '',
    BASE_URL: requiredString('BASE_URL', env, errors),
    SITE_OUTPUT_DIR: resolveSiteOutputDir(env, NODE_ENV),
    SKIP_TWILIO_VALIDATION: parseBoolean('SKIP_TWILIO_VALIDATION', env),
    SKIP_TWILIO_SEND: parseBoolean('SKIP_TWILIO_SEND', env),
    MOCK_LLM: mockLlm,
  };

  if (config.NODE_ENV === 'production' && !config.SENTRY_DSN) {
    errors.push('Missing required environment variable in production: SENTRY_DSN');
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }

  return config;
}

const config = loadConfig();

export default config;
export type { AppConfig, NodeEnv };
