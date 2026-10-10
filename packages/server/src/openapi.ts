/**
 * `/openapi.json`, generated from the route table
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-th.md)
 * clause 11). Pure. Every operation is a `get`; there is no other method to describe.
 *
 * OpenAPI 3.0.3 rather than 3.1, because 3.0 is the version APIM's importer documents fully.
 */

import { ROUTES, type RouteDefinition, type RouteKind } from './routes.ts';

/** The `/api/v1` contract's version. Changes additively (ADR-0055 trade-offs). */
export const API_VERSION = '1.0.0';

const MEDIA_TYPES: Readonly<Record<RouteKind, string>> = Object.freeze({
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  javascript: 'text/javascript',
});

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
};

function operationOf(route: RouteDefinition) {
  const responses: Record<string, unknown> = {};
  for (const [status, description] of Object.entries(route.responses)) {
    if (status === '200') {
      responses[status] = { description, content: { [MEDIA_TYPES[route.kind]]: { schema: route.kind === 'json' ? { type: 'object' } : { type: 'string' } } } };
    } else if (status === '302') {
      responses[status] = { description };
    } else {
      responses[status] = { description, content: { 'application/json': { schema: ERROR_SCHEMA } } };
    }
  }
  return {
    operationId: route.operationId,
    summary: route.summary,
    parameters: route.parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      description: parameter.description,
      schema: parameter.schema,
    })),
    responses,
  };
}

/** The OpenAPI document for {@link ROUTES}. */
export function buildOpenApi(routes: readonly RouteDefinition[] = ROUTES) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    paths[route.path] = { ...(paths[route.path] ?? {}), get: operationOf(route) };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'adrkit server',
      version: API_VERSION,
      description:
        'Read-only REST API over an adrkit decision corpus (ADR-0055). This server authenticates no one: run it on localhost or behind a gateway that does. Only GET and HEAD are served.',
    },
    paths,
  };
}
