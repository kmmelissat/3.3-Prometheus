# Análisis: instrumentación de `GET /orders/:id`

## 1. Valor de `route`

Se usó `"/orders/:id"`, la operación lógica, y no la URL concreta. Con `/orders/ord-1001` se crearía una serie nueva por cada orden consultada y la cardinalidad crecería sin límite. Con la plantilla solo hay una serie por método y código de estado.

## 2. Counter para solicitudes procesadas

Las solicitudes procesadas solo se acumulan y nunca bajan, que es el comportamiento de un Counter (`orders_http_requests_total`). Si la aplicación se reinicia, vuelve a 0 y Prometheus lo detecta como reinicio al calcular tasas.

## 3. Gauge para solicitudes activas

El número de solicitudes en curso sube cuando llega una y baja cuando termina, así que representa un valor del instante. Eso es un Gauge (`orders_http_requests_in_progress`). En `npm run concurrent` llegó a 5 y volvió a 0.

## 4. Histogram para duración

La duración es una distribución, no un único valor. El Histogram guarda buckets acumulativos (`0.05 … 2`), `_sum` y `_count`, y permite ver cuántas solicitudes superaron un umbral. Por ejemplo, las respuestas 404 (~0.26 s) son más lentas que las 200 (~0.12 s), y una media lo escondería. La unidad es segundos, por eso el sufijo `_seconds`.

## 5. Labels conservados y descartados

- **Conservados:** `method`, `route` y `status_code`. Tienen pocos valores posibles y permiten distinguir, por ejemplo, 200 de 404.
- **Descartados:** el `id` de la orden (cardinalidad alta; pertenece a logs o trazas) y cualquier identificador o dato del usuario.
- El Gauge solo lleva `route`, porque el código de estado no se conoce hasta que la solicitud termina.

## 6. `/metrics` frente a la serie almacenada en Prometheus

- `/metrics` muestra solo el estado actual de la aplicación en ese momento, por ejemplo `orders_http_requests_total{method="GET",route="/orders/:id",status_code="200"} 8`.
- Prometheus hace scrape a intervalos y guarda cada valor con su marca de tiempo, formando una serie temporal con historial.
- Prometheus también agrega los labels `job="orders-api"` e `instance="orders-api:3000"`, que la aplicación no define.

## 7. Información temporal para calcular una tasa

Un valor suelto de un Counter (por ejemplo 8) no indica velocidad. Se necesitan al menos dos muestras con su timestamp y una ventana de tiempo:

```text
tasa ≈ (valor final − valor inicial) / segundos transcurridos
```

En PromQL sería `rate(orders_http_requests_total[1m])`, tema de la clase 3.4.
