import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("payment-api");

const delay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const scenarioDelay = {
  normal: 80,
  slow: 350,
  "payment-timeout": 700
};

export async function authorizePayment(req, res) {
  const {
    order_id = "ord-generated",
    scenario = "normal"
  } = req.body;

  return tracer.startActiveSpan("payment.authorize", async (span) => {
    span.setAttribute("payment.scenario", scenario);

    try {
      if (!(scenario in scenarioDelay)) {
        span.setAttribute("payment.result", "invalid_scenario");

        return res.status(400).json({
          error: "unknown_scenario",
          supported: Object.keys(scenarioDelay)
        });
      }

      await delay(scenarioDelay[scenario]);

      if (scenario === "payment-timeout") {
        span.setAttribute("payment.result", "timeout");
        span.addEvent("payment.timeout.detected", {
          "payment.timeout_ms": scenarioDelay[scenario]
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "payment timeout"
        });

        return res.status(504).json({
          error: "payment_timeout",
          order_id
        });
      }

      span.setAttribute("payment.result", "authorized");

      return res.status(200).json({
        order_id,
        status: "authorized"
      });
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
