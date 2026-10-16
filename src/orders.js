import {
  requestsTotal,
  requestsInProgress,
  requestDuration
} from "./metrics.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const orders = new Map([
  ["ord-1001", { order_id: "ord-1001", status: "created" }],
  ["ord-1002", { order_id: "ord-1002", status: "created" }],
  ["ord-1003", { order_id: "ord-1003", status: "created" }]
]);

const scenarioDelay = {
  normal: 80,
  slow: 350,
  "payment-timeout": 700
};

export async function createOrder(req, res) {
  const {
    order_id = "ord-generated",
    scenario = "normal"
  } = req.body;

  const route = "/orders";

  requestsInProgress.inc({ route });

  const endTimer = requestDuration.startTimer({
    method: req.method,
    route
  });

  try {
    if (!(scenario in scenarioDelay)) {
      return res.status(400).json({
        error: "unknown_scenario",
        supported: Object.keys(scenarioDelay)
      });
    }

    await delay(scenarioDelay[scenario]);

    if (scenario === "payment-timeout") {
      return res.status(504).json({
        error: "payment_timeout",
        order_id
      });
    }

    const order = {
      order_id,
      status: "created"
    };

    orders.set(order_id, order);

    return res.status(201).json(order);
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

export async function getOrder(req, res) {
  const { id } = req.params;
  const order = orders.get(id);

  // TODO ACTIVIDAD:
  // Incorporar GET /orders/:id a las tres familias de métricas existentes.
  // La selección del valor de route forma parte de la actividad.

  if (order) {
    await delay(120);
    return res.status(200).json(order);
  }

  await delay(260);
  return res.status(404).json({
    error: "order_not_found",
    order_id: id
  });
}
