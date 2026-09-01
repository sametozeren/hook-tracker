import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/api/openapi/document.js';
import { DELIVERY_STATUS_VALUES } from '../../src/shared/delivery-status.js';
import { EVENT_TYPE_PATTERN } from '../../src/shared/event-types.js';

const document = createOpenApiDocument();

const DOCUMENTED_PATHS = [
  '/v1/publish',
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/refresh',
  '/v1/auth/logout',
  '/v1/auth/me',
  '/v1/projects',
  '/v1/projects/{projectId}',
  '/v1/projects/{projectId}/members',
  '/v1/projects/{projectId}/members/{userId}',
  '/v1/projects/{projectId}/api-keys',
  '/v1/projects/{projectId}/api-keys/{keyId}',
  '/v1/projects/{projectId}/endpoints',
  '/v1/endpoints/{endpointId}',
  '/v1/endpoints/{endpointId}/rotate-secret',
  '/v1/endpoints/{endpointId}/enable',
  '/v1/endpoints/{endpointId}/disable',
  '/v1/endpoints/{endpointId}/test',
  '/v1/projects/{projectId}/deliveries',
  '/v1/projects/{projectId}/deliveries/bulk-replay',
  '/v1/projects/{projectId}/stats',
  '/v1/deliveries/{deliveryId}',
  '/v1/deliveries/{deliveryId}/replay',
  '/health',
  '/ready',
  '/metrics',
  '/docs',
  '/openapi.json',
];

function parameterNamed(operation, name) {
  return operation.parameters.find((parameter) => parameter.name === name);
}

describe('createOpenApiDocument', () => {
  it('covers every path the API contract lists', () => {
    expect(Object.keys(document.paths).sort()).toEqual([...DOCUMENTED_PATHS].sort());
  });

  it('declares both authentication schemes and puts each on its own routes', () => {
    expect(Object.keys(document.components.securitySchemes)).toEqual(['apiKey', 'userJwt']);
    expect(document.paths['/v1/publish'].post.security).toEqual([{ apiKey: [] }]);
    expect(document.paths['/v1/deliveries/{deliveryId}'].get.security).toEqual([{ userJwt: [] }]);
  });

  it('leaves the operational routes unauthenticated', () => {
    expect(document.paths['/metrics'].get.security).toBeUndefined();
    expect(document.paths['/health'].get.security).toBeUndefined();
  });

  it('documents the failure codes the contract lists for publish', () => {
    expect(Object.keys(document.paths['/v1/publish'].post.responses)).toEqual([
      '202',
      '400',
      '401',
      '409',
      '413',
      '422',
      '429',
    ]);
  });

  it('renders errors as problem documents', () => {
    const unauthorized = document.paths['/v1/publish'].post.responses['401'];

    expect(unauthorized.content['application/problem+json'].schema).toEqual({
      $ref: '#/components/schemas/Problem',
    });
  });

  // The point of generating rather than writing the document: a constraint that
  // only exists in the zod schema has to show up here without a second edit.
  it('takes the publish body straight from the schema the route validates with', () => {
    const body = document.paths['/v1/publish'].post.requestBody.content['application/json'].schema;

    expect(body.properties.eventType.pattern).toBe(EVENT_TYPE_PATTERN.source);
    expect(body.properties.eventType.maxLength).toBe(64);
    expect(body.required).toEqual(['eventType', 'payload']);
    expect(body.additionalProperties).toBe(false);
  });

  it('takes the delivery filters from the query schema, coercion included', () => {
    const operation = document.paths['/v1/projects/{projectId}/deliveries'].get;

    expect(parameterNamed(operation, 'limit').schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: 50,
    });

    expect(parameterNamed(operation, 'status').schema.enum).toEqual([...DELIVERY_STATUS_VALUES]);
    expect(parameterNamed(operation, 'projectId').in).toBe('path');
  });

  it('resolves every schema reference it emits', () => {
    const referenced = [
      ...new Set(
        [...JSON.stringify(document).matchAll(/#\/components\/schemas\/(\w+)/g)].map(
          (match) => match[1],
        ),
      ),
    ];

    expect(referenced.filter((name) => !(name in document.components.schemas))).toEqual([]);
  });
});
