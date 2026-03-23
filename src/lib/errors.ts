export class AgentParseError extends Error {
  constructor(message = 'Failed to parse message') {
    super(message);
    this.name = 'AgentParseError';
  }
}

export class AgentConfidenceError extends Error {
  constructor(message = 'Classification confidence too low') {
    super(message);
    this.name = 'AgentConfidenceError';
  }
}

export class DatabaseError extends Error {
  constructor(message = 'Database operation failed') {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class MessagingError extends Error {
  constructor(message = 'Messaging operation failed') {
    super(message);
    this.name = 'MessagingError';
  }
}

export class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class SpamGuardError extends Error {
  constructor(message = 'Potential spam detected') {
    super(message);
    this.name = 'SpamGuardError';
  }
}

export class ValidationError extends Error {
  constructor(message = 'Validation failed') {
    super(message);
    this.name = 'ValidationError';
  }
}
