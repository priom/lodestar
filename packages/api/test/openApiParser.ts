import fs from "node:fs";

/** "getBlockRoot" */
type OperationId = string;
/** "/eth/v1/beacon/blocks/{block_id}/root" */
type RouteUrl = string;
/** "get" | "post" */
type HttpMethod = string;

type JsonSchema = {
  type: "object";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  oneOf?: JsonSchema[];
};

type OpenApiJson = {
  paths: Record<RouteUrl, Record<HttpMethod, RouteDefinition>>;
};

type Content = {
  /** `"application/json"` */
  [contentType: string]: {
    schema: JsonSchema;
  };
};

type RouteDefinition = {
  /** "getBlockRoot" */
  operationId: string;
  parameters: {
    name: string;
    in: "path" | "query";
    schema: JsonSchema;
  }[];
  responses: {
    /** `"200"` | `"500"` */
    [statusCode: string]: {
      content?: Content;
    };
  };
  requestBody?: {
    content?: Content;
  };
};

export type RouteSpec = {
  url: RouteUrl;
  method: HttpMethod;
  responseOkSchema: JsonSchema | undefined;
  requestSchema: JsonSchema;
};

export type ReqSchema = {
  params?: JsonSchema;
  query?: JsonSchema;
  body?: JsonSchema;
};

enum StatusCode {
  ok = "200",
}

enum ContentType {
  json = "application/json",
}

const openApiJson = JSON.parse(
  fs.readFileSync("/home/lion/Code/eth2.0/lodestar/packages/api/beacon-node-oapi.json", "utf8")
) as OpenApiJson;

export function readOpenApiSpec(): Map<OperationId, RouteSpec> {
  const routes = new Map<OperationId, RouteSpec>();

  for (const [routeUrl, routesByMethod] of Object.entries(openApiJson.paths)) {
    for (const [httpMethod, routeDefinition] of Object.entries(routesByMethod)) {
      const responseOkSchema = routeDefinition.responses[StatusCode.ok]?.content?.[ContentType.json]?.schema;

      // Force all properties to have required, else ajv won't validate missing properties
      if (responseOkSchema) {
        try {
          requireAll(responseOkSchema);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log(responseOkSchema);
          throw e;
        }
      }

      const requestSchema = buildReqSchema(routeDefinition);
      requireAll(requestSchema);

      routes.set(routeDefinition.operationId, {
        url: routeUrl,
        method: httpMethod,
        responseOkSchema,
        requestSchema,
      });
    }
  }

  return routes;
}

function requireAll(schema: JsonSchema): void {
  if (schema.type === "object" && schema.properties) {
    schema.required = Object.keys(schema.properties);

    for (const value of Object.values(schema.properties)) {
      requireAll(value);
    }
  }
}

function buildReqSchema(routeDefinition: RouteDefinition): JsonSchema {
  const reqSchemas: ReqSchema = {};

  // "parameters": [{
  //     "name": "block_id",
  //     "in": "path",
  //     "required": true,
  //     "example": "head",
  //     "schema": {
  //       "type": "string"
  //     },
  // }],

  // "parameters": [{
  //     "name": "slot",
  //     "in": "query",
  //     "required": false,
  //     "schema": {
  //       "type": "string",
  //     }
  // }],

  for (const parameter of routeDefinition.parameters ?? []) {
    switch (parameter.in) {
      case "path":
        if (!reqSchemas.params) reqSchemas.params = {type: "object", properties: {}};
        if (!reqSchemas.params.properties) reqSchemas.params.properties = {};
        reqSchemas.params.properties[parameter.name] = parameter.schema;
        break;

      case "query":
        if (!reqSchemas.query) reqSchemas.query = {type: "object", properties: {}};
        if (!reqSchemas.query.properties) reqSchemas.query.properties = {};
        reqSchemas.query.properties[parameter.name] = parameter.schema;
        break;

      // case "header"
    }
  }

  const requestJsonSchema = routeDefinition.requestBody?.content?.[ContentType.json].schema;

  if (requestJsonSchema) {
    reqSchemas.body = requestJsonSchema;
  }

  return {
    type: "object",
    properties: reqSchemas as Record<string, JsonSchema>,
  };
}

// All routes implemented
// - Correct URL
// - Correct method
// - Correct query?
// - Correct body?
// - Correct return type