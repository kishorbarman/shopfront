import pino from 'pino';

import config from '../config';

const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { service: 'shopfront' },
});

export default logger;
