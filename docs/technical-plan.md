# Archflow — Plan técnico del MVP

Fuente de verdad funcional: [`architecture_map_mvp_spec.md`](./architecture_map_mvp_spec.md).
Este documento solo registra decisiones técnicas y su justificación. Se
actualiza al cerrar cada unidad funcional.

## 1. Estado de partida

El repositorio solo contenía `README.md` y `LICENSE` (MIT). No hay código
previo que reutilizar ni convenciones que preservar, salvo la licencia.

## 2. Stack

| Capa | Tecnología | Motivo |
|------|------------|--------|
| Lenguaje | TypeScript (strict) | Contratos tipados compartidos entre servidor y UI. |
| Servicio local | Node.js ≥ 22 (`node:http`, `node:fs`) | Requisito del stack; `fs.watch` recursivo disponible en Linux/macOS/Windows. Sin framework HTTP: la API es pequeña. |
| UI | React + Vite | Requisito del stack. La biblioteca de lienzo se decide en la fase 2. |
| Parser YAML | `yaml` | Conserva posiciones de nodos → errores con línea y columna (AM-004). |
| Validación estructural | `zod` | Esquemas estrictos con rutas de error; los tipos TS se derivan del esquema. |
| Pruebas | `vitest` | Integrado con Vite; sirve para núcleo, servidor y UI. |

Dependencias nuevas solo se añaden cuando la unidad que las usa se implementa.

## 3. Estructura del proyecto

```text
src/
  core/      Modelo, esquema, parseo y validación. Puro e isomórfico:
             sin imports de Node, reutilizable en el navegador (importación).
  node/      Acceso seguro al repositorio autorizado (rutas, lectura, límites).
  cli/       Comando `archflow` (validate; serve en la fase 2).
  server/    (fase 2) Servicio HTTP local, API y vigilancia de archivos.
  web/       (fase 2) Interfaz React.
examples/    Proyecto de ejemplo con un modelo válido (etiquetado como ejemplo).
skill/       (fase 5) Skill de Claude Code.
tests/       Pruebas automatizadas.
```

## 4. Contrato del modelo

Descrito en detalle en [`model-format.md`](./model-format.md). Resumen:

- Directorio `.archflow/` en la raíz del repositorio (decisión: el producto se
  llama Archflow; el spec §8.2 permite ajustar la organización).
- Varios archivos YAML clasificados por ubicación: `manifest.yaml`,
  `overview.yaml`, `decisions.yaml`, `flows/*.yaml`, `views/*.yaml`; cualquier
  otro `.yaml` contiene `elements` y `relations`.
- `schemaVersion` entero en el manifiesto. Versión soportada: `1`.
- Espacio de IDs global y único entre elementos, relaciones, flujos,
  decisiones y vistas. Todas las referencias son por ID.
- Procedencia (`source`, `status`, `evidence`) opcional; su ausencia se
  muestra como desconocida, nunca se rellena.
- Eliminación lógica con `lifecycle: deleted`.
- La distribución visual vive en `views/`, separada de la semántica.

Validación en dos pasos, siempre atómica: (1) sintaxis YAML + estructura
por archivo, (2) referencias e invariantes globales. Si hay algún error, no
se produce modelo: quien llama conserva la última versión válida.

## 5. Detección de cambios y última versión válida (fase 4)

- `fs.watch` recursivo sobre `.archflow/` con *debounce*; ante cualquier
  cambio se relee y valida el conjunto completo (barato a la escala del MVP).
- El servidor mantiene en memoria la última instantánea válida y su hash;
  una instantánea inválida solo publica errores.
- Las escrituras desde la UI llevan el hash de la versión base; si el
  archivo cambió entretanto se detecta el conflicto en vez de sobrescribir.
- Historial en `.archflow/history/` (instantáneas de los archivos antes de
  cada escritura de la aplicación) además de Git.

## 6. Estrategia de pruebas

- Núcleo: modelos válidos e inválidos, IDs duplicados, referencias rotas,
  tipos no soportados, renombrado/traslado conservando IDs, eliminación lógica.
- Node: rutas inexistentes, traversal, enlaces simbólicos que escapan,
  límites de tamaño.
- CLI: códigos de salida y salida legible.
- Fases siguientes: puertos ocupados, vigilancia de archivos, API, UI.

## 7. Riesgos y decisiones abiertas

| Riesgo | Mitigación prevista |
|--------|---------------------|
| "Build compilado descargable" sin exigir compilación: Node no produce un binario nativo de forma trivial. | Fase final: bundle único + Node SEA por plataforma; mínimo aceptable, paquete npm con `dist/` precompilado. Se documentará qué plataformas se prueban realmente. |
| Exportación PDF/PNG fiable sin dependencias pesadas. | P1: SVG nativo desde la vista; PNG vía canvas del navegador; PDF vía impresión del navegador. Documentar limitaciones. |
| Selección de carpeta desde el navegador no expone rutas absolutas. | El usuario escribe la ruta en la UI y el servidor la valida; solo se autoriza ese directorio. |
| Fusión de cambios concurrentes (AM-014, P1). | Detección por hash por archivo primero; fusión por elemento después. |

## 8. Registro de unidades funcionales

| Unidad | Historias | Estado |
|--------|-----------|--------|
| U1 — Esquema, carga y validador + `archflow validate` | AM-003, AM-004 (validación), AM-005, AM-006 (modelo), AM-021 (rutas) | Hecho: 64 pruebas. Pendiente de fases siguientes: mostrar errores y última versión válida en la UI (AM-004/AM-011), diferenciación visual de procedencia (AM-006). |
| U2 — Servicio local (`archflow serve`), puertos, selección de repositorio, vistas derivadas y panel de detalle | AM-001, AM-002, AM-006 (UI), AM-007, AM-008, AM-010, AM-021 | Hecho |
| U3 — Edición desde la UI persistida en los YAML canónicos, conflictos por entidad | AM-009, AM-014 | Hecho |
| U4 — Vigilancia de archivos, última versión válida, historial y restauración | AM-004 (UI), AM-011, AM-013 | Hecho |
| U5 — Skill de Claude Code, `init`, `skill install` y modelo propio de Archflow | AM-012, AM-015, AM-016 | Hecho (validación del comportamiento del agente: protocolo manual en `docs/claude-code-skill.md`) |

### Decisiones de U1

- Validación en dos pasos: si algún archivo falla estructuralmente no se
  comprueban referencias, para no reportar referencias rotas falsas hacia
  entidades de ese archivo.
- Campos desconocidos son error (detecta erratas de personas y agentes); los
  datos libres van en `metadata`.
- Fechas como texto ISO (esquema YAML `core`), sin conversión a `Date`, para
  que el diff de Git sea idéntico al archivo.
- No existen migraciones porque v1 es la primera versión; una versión distinta
  se rechaza sin modificar archivos.
