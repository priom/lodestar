import Ajv, {ErrorObject} from "ajv";
import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {readOpenApiSpec} from "../../openApiParser.js";
import {routes} from "../../../src/beacon/index.js";
// Import all testData and merge below
import {testData as beaconTestData} from "./testData/beacon.js";
import {testData as configTestData} from "./testData/config.js";
import {testData as debugTestData} from "./testData/debug.js";
import {testData as lightclientTestData} from "./testData/lightclient.js";
import {testData as nodeTestData} from "./testData/node.js";
import {testData as validatorTestData} from "./testData/validator.js";

const ajv = new Ajv({
  // strict: true,
  // strictSchema: true,
  allErrors: true,
});

ajv.addKeyword({
  keyword: "example",
  validate: () => true,
  errors: false,
});

const openApiSpec = readOpenApiSpec();

const testDatas = {
  ...beaconTestData,
  ...configTestData,
  ...debugTestData,
  ...lightclientTestData,
  ...nodeTestData,
  ...validatorTestData,
};

const routesData = {
  ...routes.beacon.routesData,
  ...routes.config.routesData,
  ...routes.debug.routesData,
  ...routes.lightclient.routesData,
  ...routes.node.routesData,
  ...routes.validator.routesData,
};

const reqSerializers = {
  ...routes.beacon.getReqSerializers(config),
  ...routes.config.getReqSerializers(),
  ...routes.debug.getReqSerializers(),
  ...routes.lightclient.getReqSerializers(),
  ...routes.node.getReqSerializers(),
  ...routes.validator.getReqSerializers(),
};

const returnTypes = {
  ...routes.beacon.getReturnTypes(),
  ...routes.config.getReturnTypes(),
  ...routes.debug.getReturnTypes(),
  ...routes.lightclient.getReturnTypes(),
  ...routes.node.getReturnTypes(),
  ...routes.validator.getReturnTypes(),
};

for (const [operationId, routeSpec] of openApiSpec.entries()) {
  describe(operationId, () => {
    const {requestSchema, responseOkSchema} = routeSpec;
    const routeId = operationId as keyof typeof testDatas;
    const testData = testDatas[routeId];

    it(`${operationId}_route`, function () {
      const routeData = routesData[routeId];
      expect(routeData.method.toLowerCase()).to.equal(routeSpec.method.toLowerCase(), "Wrong method");
      expect(routeData.url).to.equal(routeSpec.url, "Wrong url");
    });

    if (requestSchema != null) {
      it(`${operationId}_request`, function () {
        const reqJson = reqSerializers[routeId].writeReq(...(testData.args as [never]));

        if (operationId === "publishBlock" || operationId === "publishBlindedBlock") {
          // For some reason AJV invalidates valid blocks if multiple forks are defined with oneOf
          // `.data - should match exactly one schema in oneOf`
          // Dropping all definitions except (phase0) pases the validation
          if (routeSpec.requestSchema?.oneOf) {
            routeSpec.requestSchema = routeSpec.requestSchema?.oneOf[0];
          }
        }

        // Validate response
        validateSchema(routeSpec.requestSchema, reqJson, "request");
      });
    }

    if (responseOkSchema) {
      it(`${operationId}_response`, function () {
        const resJson = returnTypes[operationId as keyof typeof returnTypes].toJson(testData.res as any);

        // Patch for getBlockV2
        if (operationId === "getBlockV2") {
          // For some reason AJV invalidates valid blocks if multiple forks are defined with oneOf
          // `.data - should match exactly one schema in oneOf`
          // Dropping all definitions except (phase0) pases the validation
          responseOkSchema.properties?.data.oneOf?.splice(1);
        }

        // Validate response
        validateSchema(responseOkSchema, resJson, "response");
      });
    }
  });
}

function validateSchema(schema: Parameters<typeof ajv.compile>[0], json: unknown, id: string): void {
  let validate: ReturnType<typeof ajv.compile>;

  try {
    validate = ajv.compile(schema);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(schema, null, 2));
    throw e;
  }

  const valid = <boolean>validate(json);
  if (!valid) {
    throw Error(
      [`Invalid ${id} against spec schema`, prettyAjvErrors(validate.errors), JSON.stringify(json)].join("\n\n")
    );
  }
}

function prettyAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors) return "";
  return errors.map((e) => `${e.instancePath ?? "."} - ${e.message}`).join("\n");
}