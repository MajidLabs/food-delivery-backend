import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';

const MAX_REDELIVER_ATTEMPTS = 3;

/**
 * Message-level retry for RabbitMQ event consumers running in manual-ack
 * mode. On failure the message is re-queued with an incremented
 * `x-retry-count` header. Once MAX_REDELIVER_ATTEMPTS is reached the message
 * is nacked without requeue, which routes it to the queue's configured
 * dead-letter-exchange (see infra/rabbitmq/definitions.json).
 *
 * This is a "redelivery count" style retry (no delay between attempts). The
 * in-process `withRetry` exponential-backoff utility is layered underneath
 * business logic that talks to flaky external systems; this helper adds a
 * second, message-durable layer so failures survive a process restart.
 */
export async function handleWithRetry(
  context: RmqContext,
  handler: () => Promise<void>,
  logger: Logger,
): Promise<void> {
  const channel = context.getChannelRef();
  const message = context.getMessage();

  try {
    await handler();
    channel.ack(message);
  } catch (error) {
    const headers = message.properties?.headers ?? {};
    const attempt = (headers['x-retry-count'] ?? 0) + 1;

    logger.error(
      `Handler failed (attempt ${attempt}/${MAX_REDELIVER_ATTEMPTS}): ${error?.message ?? error}`,
    );

    if (attempt >= MAX_REDELIVER_ATTEMPTS) {
      logger.error(
        'Max retries exceeded — sending message to dead-letter queue',
      );
      channel.nack(message, false, false);
      return;
    }

    channel.ack(message);
    channel.sendToQueue(message.fields.routingKey, message.content, {
      headers: { ...headers, 'x-retry-count': attempt },
      persistent: true,
    });
  }
}
