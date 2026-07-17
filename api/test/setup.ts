// Mock infra clients so unit tests import pure logic without opening real
// Redis/Postgres connections.
import { vi } from 'vitest';

vi.mock('ioredis', () => {
  class FakeRedis {
    on() {
      return this;
    }
    async ping() {
      return 'PONG';
    }
    async get() {
      return null;
    }
    async set() {
      return 'OK';
    }
    async call() {
      throw new Error('unknown command');
    }
    disconnect() {}
    async quit() {}
  }
  return { default: FakeRedis };
});

vi.mock('pg', () => {
  class Pool {
    on() {}
    async query() {
      return { rows: [] };
    }
    async end() {}
  }
  return { default: { Pool }, Pool };
});
