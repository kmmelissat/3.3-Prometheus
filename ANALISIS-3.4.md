# Análisis PromQL de `orders-api` (3.4)

Valores obtenidos con las consultas de referencia, evaluados al final de cada fase del escenario (`npm run promql:scenario`, cinco fases de 80 s).

| Fase | Comportamiento | Tasa total (30 s) | Proporción 5xx | Media POST | p95 POST |
|---|---|---|---|---|---|
| A | 1 req/s, normal | 1.0 | 0 | 0.084 s | 0.098 s |
| B | 4 req/s, normal | 4.0 | 0 | 0.083 s | 0.098 s |
| C | 4 req/s, normal + payment-timeout | 4.0 | 0.25 | 0.393 s | 0.950 s |
| D | 4 req/s, slow | 4.0 | 0 | 0.354 s | 0.487 s |
| E | 1 req/s, normal | 1.0 | 0 | 0.085 s | 0.098 s |

En las fases A y B la consulta de 5xx devuelve vacío porque aún no existe ninguna serie con 504; equivale a 0.

## 1. Tasa total

```promql
sum(rate(orders_http_requests_total[30s]))
```

La menor actividad es ≈1 req/s (fases A y E) y la mayor ≈4 req/s (fases B, C y D).

## 2. Tasa por `status_code`

```promql
sum by (status_code) (rate(orders_http_requests_total[30s]))
```

Los 504 aparecen solo en la fase C (2:40 a 4:00), con ≈1 req/s. En ese intervalo: 200 ≈ 2, 201 ≈ 1 y 504 ≈ 1 req/s.

## 3. Proporción de respuestas 5xx

```promql
sum(rate(orders_http_requests_total{status_code=~"5.."}[1m]))
/
sum(rate(orders_http_requests_total[1m]))
```

≈0.25 en la fase C (1 de cada 4 solicitudes) y 0 en el resto.

## 4. `rate[30s]` frente a `rate[2m]`

En la transición A→B (de 1 a 4 req/s):

| Tiempo | `[30s]` | `[2m]` |
|---|---|---|
| t+85 s | 1.0 | 0.68 |
| t+100 s | 2.76 | 1.20 |
| t+120 s | 4.0 | 1.89 |
| t+160 s | 4.0 | 2.95 |

La ventana de 30 s sigue el cambio en unos 40 s. La de 2 m lo suaviza y tarda más en alcanzar el valor real. Al final del escenario, en la fase E, la de 30 s ya marca 1.0 mientras que la de 2 m todavía marca 2.06. La ventana corta es más reactiva pero más ruidosa; la larga es más estable pero retrasa.

## 5. Duración media de `POST /orders`

```promql
sum(rate(orders_http_request_duration_seconds_sum{route="/orders"}[1m]))
/
sum(rate(orders_http_request_duration_seconds_count{route="/orders"}[1m]))
```

≈0.08 s en A, B y E; sube a ≈0.39 s en C y a ≈0.35 s en D.

## 6. p95 de `POST /orders`

```promql
histogram_quantile(0.95,
  sum by (le) (
    rate(orders_http_request_duration_seconds_bucket{route="/orders"}[1m])
  )
)
```

≈0.098 s en las fases normales, ≈0.95 s en C y ≈0.49 s en D.

## 7. Media frente a p95 en los intervalos de mayor duración

- **Fase C:** la media (0.39 s) queda muy por debajo del p95 (0.95 s). La mezcla de respuestas 201 (~0.08 s) con las 504 (~0.70 s) diluye el extremo en la media.
- **Fase D:** todas las POST son lentas (~0.35 s), así que media y p95 se acercan.
- El p95 muestra la cola de la distribución que la media oculta.

## 8. Mecanismos técnicos posibles y evidencia adicional

El aumento de duración es compatible con una dependencia lenta (por ejemplo el pago), un timeout, saturación de CPU o de conexiones, o bloqueo de I/O.

Para discriminar entre ellos haría falta:

- métricas por dependencia o por etapa de la solicitud;
- CPU, memoria y conexiones del contenedor (por ejemplo con cAdvisor);
- logs o trazas por solicitud;
- el Gauge de solicitudes en curso, para ver si se acumulan.
