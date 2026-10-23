const {
  NodeSDK
} = require("@opentelemetry/sdk-node");

const {
  OTLPTraceExporter
} = require(
  "@opentelemetry/exporter-trace-otlp-http"
);

const {
  getNodeAutoInstrumentations
} = require(
  "@opentelemetry/auto-instrumentations-node"
);

function ignoreInfrastructureRequests(req) {
  const path = (req.url ?? "").split("?")[0];

  return (
    path === "/health" ||
    path === "/metrics"
  );
}

const sdk = new NodeSDK({
  traceExporter:
    new OTLPTraceExporter(),

  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingRequestHook:
          ignoreInfrastructureRequests
      }
    })
  ]
});

sdk.start();

async function shutdown() {
  try {
    await sdk.shutdown();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);