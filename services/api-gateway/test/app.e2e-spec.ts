import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

// These are read eagerly while building provider factories (RMQ client
// options, JwtModule), even though no real network connection is made
// until a request actually reaches a controller that uses them.
process.env.RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret';

import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) reports the gateway as up', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('/orders (GET) is rejected without a bearer token', () => {
    return request(app.getHttpServer()).get('/orders').expect(401);
  });
});
