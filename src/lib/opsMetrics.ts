type CounterName =
  | 'webhookAuthFailures'
  | 'outboundDeliveryFailures'
  | 'rateLimitBlocks'
  | 'spamBlocks';

type Counters = Record<CounterName, number>;

const counters: Counters = {
  webhookAuthFailures: 0,
  outboundDeliveryFailures: 0,
  rateLimitBlocks: 0,
  spamBlocks: 0,
};

export function incrementCounter(name: CounterName): void {
  counters[name] += 1;
}

export function getOpsMetrics(): Counters {
  return { ...counters };
}

export function resetOpsMetrics(): void {
  counters.webhookAuthFailures = 0;
  counters.outboundDeliveryFailures = 0;
  counters.rateLimitBlocks = 0;
  counters.spamBlocks = 0;
}
