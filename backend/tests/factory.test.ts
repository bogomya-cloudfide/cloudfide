import { afterEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

it('answers the health check after querying the database', async () => {
  const { database, app } = setup();
  const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('fails the health check when the database is unreachable', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('connection refused'));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection refused' }));
});

it('serves tasks through the full app', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
});

it('serves the OpenAPI specification and hides x-powered-by', async () => {
  const { app } = setup();
  const response = await request(app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('openapi');
  expect(response.headers['x-powered-by']).toBeUndefined();
});

it('answers 404 for unknown routes', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/nope');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});

it('answers 422 for malformed JSON', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{bad');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});

it('answers 413 for an oversized body', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});

it('answers 500 without leaking a database failure', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(new Error('connection refused'));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection refused' }));
});
