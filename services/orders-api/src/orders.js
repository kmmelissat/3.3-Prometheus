import {
  SpanStatusCode,
  trace
} from "@opentelemetry/api";
import {
  requestsTotal,
  requestsInProgress,
  requestDuration
} from "./metrics.js";

const orders = new Map([
  ["ord-1001", { order_id: "ord-1001", status: "created" }],
  ["ord-1002", { order_id: "ord-1002", status: "created" }],
  ["ord-1003", { order_id: "ord-1003", status: "created" }]
]);

const tracer = trace.getTracer("orders-api");

const supportedScenarios = new Set([
  "normal",
  "slow",
  "payment-timeout"
]);

const paymentApiUrl =
  process.env.PAYMENT_API_URL ?? "http://payment-api:3000";

async function authorizePayment(orderId, scenario) {
  const response = await fetch(`${paymentApiUrl}/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      order_id: orderId,
      scenario
    })
  });

  const body = await response.json().catch(() => ({}));

  return {
    status: response.status,
    ok: response.ok,
    body
  };
}

export async function createOrder(req, res) {
  return tracer.startActiveSpan("order.create", async (span) => {
    const {
      order_id = "ord-generated",
      scenario = "normal"
    } = req.body;

    span.setAttribute("order.scenario", scenario);

    const route = "/orders";

    requestsInProgress.inc({ route });
    const endTimer = requestDuration.startTimer({
      method: req.method,
      route
    });

    try {
      if (!supportedScenarios.has(scenario)) {
        span.setAttribute("order.result", "invalid_scenario");

        return res.status(400).json({
          error: "unknown_scenario",
          supported: [...supportedScenarios]
        });
      }

      const payment = await authorizePayment(order_id, scenario);

      if (!payment.ok) {
        span.setAttribute("order.result", "payment_error");
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `payment-api responded ${payment.status}`
        });

        if (payment.status === 504) {
          return res.status(504).json({
            error: "payment_timeout",
            order_id
          });
        }

        return res.status(502).json({
          error: "payment_error",
          order_id
        });
      }

      const order = {
        order_id,
        status: "created"
      };

      orders.set(order_id, order);
      span.setAttribute("order.result", "created");

      return res.status(201).json(order);
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    } finally {
      const statusCode = String(res.statusCode);

      requestsTotal.inc({
        method: req.method,
        route,
        status_code: statusCode
      });

      requestsInProgress.dec({ route });

      endTimer({
        status_code: statusCode
      });

      span.end();
    }
  });
}

export async function getOrder(req, res) {
  const { id } = req.params;
  const route = "/orders/:id";

  requestsInProgress.inc({ route });
  const endTimer = requestDuration.startTimer({
    method: req.method,
    route
  });

  try {
    const order = orders.get(id);

    if (order) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return res.status(200).json(order);
    }

    await new Promise((resolve) => setTimeout(resolve, 260));
    return res.status(404).json({
      error: "order_not_found",
      order_id: id
    });
  } finally {
    const statusCode = String(res.statusCode);

    requestsTotal.inc({
      method: req.method,
      route,
      status_code: statusCode
    });

    requestsInProgress.dec({ route });

    endTimer({
      status_code: statusCode
    });
  }
}
