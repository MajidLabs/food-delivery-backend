import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';

const MAX_REDELIVER_ATTEMPTS = 3;

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
