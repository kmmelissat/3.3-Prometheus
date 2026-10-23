# Respuestas de revisión — 3.6 OpenTelemetry

## 1. ¿Qué diferencia existe entre una traza y un span?

Un **span** es una operación individual con nombre, inicio, duración, atributos, estado y un padre opcional. Por ejemplo, `order.create` o `POST /authorize`.

Una **traza** es el conjunto de spans que pertenecen a una misma ejecución, unidos por el mismo `trace_id` y organizados en un árbol por sus relaciones padre-hijo.

En este sistema, un `POST /orders` produce una traza con unos 15 spans repartidos entre `orders-api` y `payment-api`.

## 2. ¿Qué funciones cumplen `trace_id` y `span_id`?

- `trace_id` identifica la ejecución completa. Todos los spans de una solicitud lo comparten, sin importar el servicio. Sirve para agrupar la evidencia y para correlacionar con logs.
- `span_id` identifica un span concreto dentro de la traza. Cada span tiene el suyo.

La relación padre-hijo se expresa guardando en el hijo el `span_id` del padre (`parentSpanContext.spanId`). Así se reconstruye el árbol.

## 3. ¿Qué problema resuelve la propagación de contexto entre `orders-api` y `payment-api`?

Cada servicio es un proceso distinto, así que no comparten memoria. Sin propagación, `payment-api` empezaría una traza nueva con otro `trace_id` y no habría forma de saber que su trabajo pertenece a la solicitud de `orders-api`.

La instrumentación automática inyecta el contexto en la cabecera HTTP `traceparent` de la llamada saliente. `payment-api` la extrae y crea su span servidor como hijo del span cliente.

Se comprobó en los logs: el span servidor `POST /authorize` de `payment-api` tenía el mismo `traceId`, un `id` propio y `parentSpanContext` con el `spanId` del span cliente de `orders-api` e `isRemote: true`. No se escribió ningún `traceparent` a mano.

## 4. ¿Qué diferencia existe entre un span CLIENT y un span SERVER?

- **CLIENT** (`kind: 2`) representa la llamada saliente vista desde quien la hace. En `orders-api` es el `fetch()` hacia `http://payment-api:3000/authorize`. Mide el tiempo que `orders-api` espera la respuesta. Este span puede llamarse solo `POST`, y se reconoce por `url.full`.
- **SERVER** (`kind: 1`) representa la recepción de una solicitud vista desde quien la atiende. Son `POST /orders` en `orders-api` y `POST /authorize` en `payment-api`.

Una misma llamada HTTP entre servicios genera ambos: el cliente en un proceso y el servidor en otro, enlazados por la propagación de contexto. Los spans manuales como `order.create` son internos (`kind: 0`).

## 5. ¿Qué puede obtenerse mediante instrumentación automática y qué requiere instrumentación manual?

**Automática:** conoce las librerías, es decir HTTP, Express y la red. Produce `POST /orders`, el cliente `POST` hacia `/authorize`, `POST /authorize`, los middleware y `tcp.connect`. También propaga el contexto.

**Manual:** conoce el significado del negocio, que la librería no puede inferir. Aquí son `order.create` y `payment.authorize`, junto con sus atributos (`order.scenario`, `order.result`, `payment.scenario`, `payment.result`), el estado ERROR según el resultado de la operación y el evento `payment.timeout.detected`.

## 6. ¿Qué diferencia existe entre un atributo de span y un atributo de recurso?

- **Atributo de recurso:** describe quién produjo la telemetría y es el mismo para todos los spans de un proceso. Ejemplos: `service.name=payment-api`, `service.version=3.6`, `deployment.environment.name=class`. Se configura con `OTEL_SERVICE_NAME` y `OTEL_RESOURCE_ATTRIBUTES`.
- **Atributo de span:** describe una operación concreta. Ejemplo: `payment.scenario=slow`, que aparece solo en el span `payment.authorize` de esa ejecución.

En una solicitud de prueba, `service.name=payment-api` apareció en los 7 spans de `payment-api`, mientras que `payment.scenario=slow` apareció en uno solo.

## 7. ¿Qué función cumple `service.name`?

Identifica el servicio que produjo cada span. Los backends como Jaeger lo usan para agrupar, filtrar y mostrar la traza por servicio (en Jaeger aparecen `orders-api` y `payment-api` como servicios distintos).

Debe ser **estable**: si cambia entre despliegues o entre réplicas, la evidencia de un mismo servicio se fragmenta. Sin él, el SDK asigna un nombre genérico por defecto y no se distingue de dónde viene cada span.

## 8. ¿Qué diferencia existe entre OpenTelemetry Collector y Jaeger?

- **Collector:** es un intermediario de la telemetría. Recibe datos por OTLP, los procesa (aquí `batch`) y los exporta a uno o varios destinos (aquí `debug` y Jaeger). No almacena ni ofrece interfaz para explorar trazas.
- **Jaeger:** es el backend. Almacena las trazas y ofrece una interfaz (`http://localhost:16686`) y una API para consultarlas.

Separarlos permite que las aplicaciones solo conozcan el endpoint OTLP del Collector. Cambiar de Jaeger a otro backend se hace en la configuración del Collector, sin tocar el código ni las imágenes de los servicios.

## 9. ¿Por qué una traza lenta no demuestra por sí sola la causa de la latencia?

Una traza dice **dónde** se observa el tiempo, no **por qué** se consumió. Por ejemplo, `POST /orders` de 356 ms con `payment.authorize` de 350 ms permite afirmar que casi todo el tiempo está dentro del camino de autorización.

No permite concluir si la CPU estaba saturada, si hubo espera de red, contención o bloqueo por I/O. Esas hipótesis necesitan más evidencia, como métricas de recursos o logs.

En este sistema, la demora es deliberada: `payment-api` espera 80, 350 o 700 ms según el escenario. No debe interpretarse como saturación ni como una red lenta.

Además, con sampling puede que no se conserven todas las trazas, y la ausencia de una traza no prueba que la operación no ocurrió.

## 10. ¿Qué relación puede establecerse entre métricas, logs y trazas durante una investigación?

Cada señal responde algo distinto:

| Señal | Responde |
|---|---|
| Métrica | Cuántas solicitudes, qué proporción de 5xx, cómo cambia el p95 |
| Traza | Qué operaciones formaron una ejecución y dónde se fue el tiempo |
| Log | Qué eventos quedaron registrados en una solicitud o error |

Una investigación típica empieza en Grafana con un p95 elevado, identifica el intervalo problemático, pasa a una traza lenta y, con su `trace_id`, llega a los logs relacionados. También puede ir al revés: un log de error con `trace_id` lleva a la traza completa.

La correlación solo funciona si cada señal conserva suficiente contexto, como el `trace_id`, para pasar a la siguiente.
