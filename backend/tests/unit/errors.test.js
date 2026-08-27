import { describe, expect, it } from 'vitest';
import {
  RateLimitedError,
  UnprocessableError,
  ValidationError,
  issuesToErrors,
  toProblem,
} from '../../src/shared/errors.js';

const context = { instance: '/v1/publish', requestId: 'req_1' };

describe('toProblem', () => {
  it('renders an application error as an RFC 9457 problem document', () => {
    expect(toProblem(new UnprocessableError('no endpoint matched'), context)).toEqual({
      type: 'urn:hook-tracker:error:unprocessable',
      title: 'Unprocessable request',
      status: 422,
      detail: 'no endpoint matched',
      instance: '/v1/publish',
      requestId: 'req_1',
    });
  });

  it('adds the validation issue list when there is one', () => {
    const problem = toProblem(
      new ValidationError('body failed', [{ path: 'eventType', message: 'required' }]),
      context,
    );

    expect(problem.errors).toEqual([{ path: 'eventType', message: 'required' }]);
  });

  it('never leaks an unexpected error to the client', () => {
    const problem = toProblem(
      new Error('connection string postgres://user:password@host'),
      context,
    );

    expect(problem).toEqual({
      type: 'urn:hook-tracker:error:internal',
      title: 'Internal server error',
      status: 500,
      instance: '/v1/publish',
      requestId: 'req_1',
    });
  });
});

describe('RateLimitedError', () => {
  it('carries the headers the response must set', () => {
    const error = new RateLimitedError('too many', { 'Retry-After': '42' });

    expect(error.status).toBe(429);
    expect(error.type).toBe('urn:hook-tracker:error:rate-limited');
    expect(error.headers).toEqual({ 'Retry-After': '42' });
  });
});

describe('issuesToErrors', () => {
  it('flattens a zod issue path into a dotted string', () => {
    expect(issuesToErrors([{ path: ['payload', 'orderId'], message: 'expected number' }])).toEqual([
      { path: 'payload.orderId', message: 'expected number' },
    ]);
  });
});
