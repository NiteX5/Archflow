# Architecture Map --- MVP Specification

**Documento:** `architecture_map_mvp_spec.md`\
**Versión:** 1.0\
**Estado:** Especificación inicial para implementación\
**Idioma:** Español\
**Propósito:** Definir un MVP acotado para construir una aplicación
local de visualización, edición y documentación de arquitectura de
software, integrada con repositorios Git y con una skill de Claude Code.

------------------------------------------------------------------------

## 1. Instrucción principal para Claude

Implementa este producto siguiendo esta especificación como fuente de
verdad. El objetivo es entregar un MVP funcional, no una plataforma
completa. No agregues funcionalidades, servicios, abstracciones,
pantallas, archivos, dependencias ni lógica que no sean necesarias para
los requisitos descritos aquí. Antes de crear componentes nuevos, revisa
el repositorio y reutiliza lo existente cuando sea adecuado. Divide el
trabajo en fases pequeñas, valida cada fase con pruebas y actualiza este
documento o los archivos de modelo solo cuando corresponda.

No supongas que un requisito no definido te autoriza a inventar
comportamiento. Para decisiones técnicas necesarias que no cambien el
alcance, elige la solución más sencilla, mantenible y segura, y
documenta brevemente la decisión. Si una decisión cambiaría
sustancialmente la arquitectura o el alcance, detente y presenta las
alternativas antes de implementarla.

**Principio central del producto:** Claude, otro agente de IA o una
persona desarrolladora declara y mantiene el modelo arquitectónico
estructurado. La aplicación valida ese modelo, lo representa
visualmente, permite editarlo, conserva su historial y sincroniza los
cambios. La aplicación no debe generar por sí sola un diagrama completo
mediante análisis automático del código fuente.

## 2. Visión del producto

Crear una herramienta visual que permita comprender y mantener la
arquitectura de un proyecto de software desde una representación
navegable que conecte infraestructura, sistemas, módulos internos,
código, datos, flujos funcionales y documentación.

El producto combina la utilidad de diagramas como Mermaid y draw.io con
un modelo semántico persistente que puede ser leído y actualizado por
Claude Code. El diagrama no es solo una imagen: es una vista editable de
un modelo estructurado con identidades estables, relaciones, notas,
evidencia e historial.

El código fuente no es el contenido principal de la interfaz. Debe poder
consultarse como referencia desde un elemento cuando exista una
ubicación conocida, pero el centro de la experiencia es el mapa visual y
la comprensión de sus relaciones.

### 2.1 Problema que resuelve

En proyectos medianos o grandes, la arquitectura y la documentación se
dispersan entre código, diagramas, decisiones técnicas y conocimiento de
los desarrolladores. Los diagramas estáticos quedan desactualizados y
los agentes de IA pueden perder contexto, duplicar componentes o cambiar
una arquitectura sin mantener su documentación.

La herramienta debe permitir que la arquitectura declarada sea fácil de
explorar por personas y agentes, y que sus cambios queden versionados
junto al repositorio.

### 2.2 Principios del producto

1.  **Modelo estructurado como fuente de verdad visual:** los diagramas
    se renderizan desde datos estructurados; no se guardan únicamente
    como imágenes.
2.  **Declaración explícita antes que inferencia:** los elementos y
    relaciones los declara una persona o un agente autorizado.
3.  **No inventar:** si falta información, marcarla como incompleta o
    desconocida.
4.  **Identidad estable:** cada entidad tiene un ID independiente de su
    nombre, ubicación en el código o posición visual.
5.  **Varias vistas, un modelo:** una entidad puede aparecer en varias
    vistas sin duplicar su identidad.
6.  **Edición manual y asistida:** el usuario puede editar directamente
    la representación y Claude puede editar los archivos del modelo.
7.  **Git-friendly:** el modelo debe ser legible, diffable y versionable
    en el repositorio.
8.  **Cambios reversibles:** conservar historial, admitir restauración y
    no sobrescribir cambios silenciosamente.
9.  **Privacidad local por defecto:** el servicio escucha en localhost y
    no envía código a servicios externos sin autorización explícita.
10. **MVP acotado:** priorizar un flujo local completo y fiable antes de
    colaboración remota, monetización o servicios en la nube.

## 3. Usuarios previstos

El producto debe ser útil para:

-   Desarrolladores individuales que necesitan comprender y documentar
    un proyecto.
-   Equipos de desarrollo que comparten una arquitectura.
-   Arquitectos o líderes técnicos que mantienen vistas y decisiones
    técnicas.
-   Desarrolladores que trabajan con agentes de IA y necesitan
    entregarles contexto estructurado.

No se requiere optimizar inicialmente para un único perfil. La interfaz
debe priorizar claridad, navegación rápida y edición sencilla.

## 4. Alcance del MVP

### 4.1 Incluido

-   Aplicación web local ejecutada mediante un comando.
-   Distribución como build compilado descargable; no exigir al usuario
    compilar el proyecto manualmente.
-   Apertura de la interfaz en el navegador mediante una dirección
    localhost.
-   Selección de repositorio por argumento de línea de comandos o desde
    la interfaz si no se indicó una ruta.
-   Acceso limitado al repositorio autorizado explícitamente.
-   Modelo propio, estructurado, validado y dividido en varios archivos
    por tipo de contenido.
-   IDs estables, relaciones entre archivos y versión de esquema.
-   Visualización de diagramas editables desde el modelo.
-   Edición manual de elementos, relaciones, notas, agrupaciones y
    estilos.
-   Varias vistas derivadas del mismo modelo semántico.
-   Detección de cambios en los archivos del modelo y actualización de
    la interfaz.
-   Validación antes de aplicar cambios; conservar la última versión
    válida ante errores.
-   Historial de cambios, restauración y tratamiento de eliminaciones
    sin perder trazabilidad.
-   Skill de Claude Code que explica cómo leer, verificar y actualizar
    el modelo junto al código.
-   Importación y exportación de Mermaid, draw.io y JSON/YAML, con
    conversión a objetos editables cuando sea compatible.
-   Exportación de vistas a PNG, SVG y PDF.
-   Verificación opcional y acotada del modelo frente al repositorio,
    sin generar diagramas automáticamente.
-   Adaptadores iniciales para TypeScript, JavaScript, SQL/bases de
    datos, Docker/Compose y Terraform, en la medida necesaria para
    verificar estructura y discrepancias.
-   Controles básicos de seguridad local, rutas autorizadas y manejo de
    secretos.

### 4.2 Fuera del MVP

No implementar ahora, salvo que sea estrictamente necesario para los
puntos anteriores:

-   Plataforma SaaS multiusuario completa.
-   Colaboración remota en tiempo real.
-   Cuentas, facturación, pagos o límites comerciales de freemium.
-   Sincronización con una plataforma cloud propietaria.
-   API remota obligatoria para Claude Code.
-   Agentes autónomos que recorran todo el código y creen o reconstruyan
    el diagrama por su cuenta.
-   Generación automática de arquitectura como función principal.
-   Soporte completo para todos los lenguajes y frameworks.
-   Integración con todos los proveedores cloud y herramientas de
    diagramación.
-   Sistema de plugins público.
-   Analítica de producto o telemetría no esencial.

La arquitectura puede permitir ampliaciones futuras, pero no debe
construirse infraestructura anticipada que no se necesite para el MVP.

## 5. Modelo conceptual

El modelo común debe representar, como mínimo, las siguientes categorías
semánticas:

### 5.1 Infraestructura

-   Proveedores y recursos cloud, por ejemplo AWS o Azure.
-   Servidores, contenedores, redes, balanceadores y despliegues.
-   Bases de datos, almacenamiento y recursos de ejecución.
-   Entornos y relaciones de despliegue.

### 5.2 Sistemas y aplicaciones

-   Aplicaciones web, APIs, servicios, sistemas externos e integraciones
    de terceros.
-   Límites de sistema, dominios y agrupaciones.
-   Responsabilidades y dependencias.

### 5.3 Arquitectura interna

-   Módulos, paquetes, controladores, servicios, repositorios,
    interfaces y componentes.
-   Responsabilidades y dependencias entre componentes.
-   Referencias opcionales a rutas o símbolos del código.

### 5.4 Comportamiento del código

-   Funciones y métodos relevantes.
-   Llamadas y dependencias de ejecución declaradas o verificadas.
-   Entradas, salidas, validaciones y reglas de negocio.
-   Referencias a archivos, clases o símbolos cuando estén disponibles.

### 5.5 Flujos funcionales

-   Casos de uso y procesos de negocio.
-   Flujos de ejecución, secuencia, datos y eventos.
-   Participantes, pasos, condiciones y resultados.

### 5.6 Datos y documentación

-   Entidades de datos, tablas, relaciones y persistencia.
-   Notas, decisiones arquitectónicas, requisitos y restricciones.
-   Evidencias, enlaces y referencias a fuentes.
-   Información desconocida, pendiente de verificar o incompleta.

### 5.7 Relaciones

El esquema debe admitir relaciones tipadas y extensibles, por ejemplo:
depende de, llama a, contiene, implementa, despliega en, lee, escribe,
envía datos a, recibe datos de, participa en flujo y se integra con.
Evitar una lista rígida que impida añadir tipos en el futuro, pero
validar los tipos soportados por la versión actual del esquema.

## 6. Vistas y navegación

Todas las vistas deben derivarse del mismo modelo y conservar la
identidad de los elementos. Una entidad que aparezca en la vista
general, la vista de dependencias y un flujo funcional debe ser el mismo
objeto semántico, no tres copias independientes.

### 6.1 Vistas iniciales

1.  **Arquitectura general:** sistemas principales y relaciones
    relevantes.
2.  **Dependencias:** relaciones entre sistemas, módulos y componentes.
3.  **Ejecución y secuencia:** pasos y participantes de un flujo.
4.  **Infraestructura y despliegue:** recursos, entornos y ubicación de
    sistemas.
5.  **Datos y bases de datos:** entidades, tablas, persistencia y flujos
    de datos.
6.  **Flujos de negocio:** casos de uso, procesos, reglas y resultados.
7.  **Vista libre:** diagrama manual que combine elementos y relaciones
    elegidos por el usuario.

Las vistas específicas son presentaciones del modelo declarado, no
productos de un análisis autónomo del código. Cuando no exista
suficiente información para construir una vista, mostrar un estado vacío
o incompleto y explicar qué información falta; no inventar nodos ni
relaciones.

### 6.2 Navegación

-   Permitir acercar/alejar el lienzo y navegar desde una vista general
    a detalles específicos.
-   Permitir abrir el detalle de un elemento y saltar a otras vistas
    donde aparezca.
-   Permitir localizar elementos por nombre, ID o referencia disponible.
-   Mantener selección e identidad del elemento al cambiar de vista.
-   No exigir que todo el proyecto se muestre simultáneamente en un
    único lienzo.

### 6.3 Edición visual

El editor debe combinar libertad visual con semántica subyacente:

-   Crear, editar y eliminar lógicamente elementos y relaciones.
-   Mover y redimensionar elementos; agruparlos en contenedores.
-   Cambiar colores, estilos, iconos y formas.
-   Crear notas y documentación contextual.
-   Organizar y guardar la distribución de cada vista sin cambiar la
    identidad semántica del elemento.
-   Incluir una opción de disposición automática cuando sea viable, sin
    obligar a usarla.

## 7. Panel de detalle del elemento

Al seleccionar un elemento, mostrar según corresponda:

-   Nombre, tipo, ID y descripción.
-   Responsabilidad y contexto.
-   Relaciones entrantes y salientes.
-   Comportamiento o flujo de ejecución relacionado.
-   Reglas de negocio, restricciones y decisiones asociadas.
-   Notas y documentación.
-   Referencia al código fuente, si existe.
-   Estado de sincronización o discrepancia.
-   Procedencia de los datos y estado de verificación.

Los campos que no tengan información deben aparecer como desconocidos,
incompletos o no documentados; no se deben completar con suposiciones
generadas automáticamente.

## 8. Formato estructurado del modelo

### 8.1 Requisitos

El formato propio será el formato canónico. Debe ser legible por
personas y agentes, eficiente en tokens, fácil de comparar en Git,
validable y extensible.

-   Usar varios archivos estructurados separados por tipo de contenido,
    en lugar de un único archivo monolítico.
-   Definir un esquema con versión explícita.
-   Mantener IDs estables para entidades y relaciones cuando
    corresponda.
-   Definir referencias entre archivos de forma clara y validable.
-   Separar datos semánticos de distribución visual cuando sea necesario
    para evitar que un cambio de posición parezca un cambio
    arquitectónico.
-   Conservar notas, referencias, procedencia, estado de verificación e
    historial.
-   Evitar duplicar la definición canónica de una entidad en cada vista.

Claude debe consultar primero el resumen general y después leer solo los
módulos, relaciones y flujos pertinentes a su tarea. Debe poder
consultar el modelo completo cuando el cambio realmente lo requiera.

### 8.2 Organización inicial sugerida

La organización exacta puede ajustarse si el repositorio ya impone una
convención útil, pero debe mantener la separación por responsabilidad.
Una posible estructura inicial es:

``` text
.architecture-map/
  manifest.yaml
  overview.yaml
  systems.yaml
  components/
    <domain-or-module>.yaml
  infrastructure.yaml
  data.yaml
  flows/
    <flow-id>.yaml
  decisions.yaml
  views/
    overview.yaml
    dependencies.yaml
    deployment.yaml
    <custom-view>.yaml
  history/
```

No es obligatorio replicar literalmente este árbol si existe una
alternativa más sencilla y robusta. El formato final debe estar
documentado y validado por esquema.

### 8.3 Identidad estable

-   Cada elemento recibe un ID único y persistente.
-   El ID no debe derivarse exclusivamente del nombre, ruta de archivo o
    posición visual.
-   Renombrar o mover un elemento conserva su ID.
-   Las relaciones hacen referencia a IDs, no a etiquetas de
    presentación.
-   Las referencias rotas deben producir errores claros de validación.
-   No crear automáticamente una segunda entidad si ya existe una
    entidad equivalente declarada; señalar posibles duplicados para
    revisión.

### 8.4 Procedencia y confianza

Los hechos y relaciones relevantes deben poder registrar:

-   Origen: documentado manualmente, declarado por un agente,
    observado/verificado en código o inferido por una herramienta.
-   Evidencia o referencia que respalde el dato, cuando exista.
-   Estado: verificado, inferido o pendiente de revisión.
-   Fecha o revisión de la última verificación cuando sea pertinente.

Una inferencia nunca debe presentarse como hecho confirmado. La falta de
evidencia no debe ocultarse.

### 8.5 Validación y evolución del esquema

-   Validar la estructura y las referencias antes de aplicar una
    actualización.
-   Mantener la última versión válida visible si el archivo editado
    contiene errores.
-   Rechazar la aplicación de cambios inválidos como un conjunto parcial
    silencioso.
-   Mostrar el archivo, campo y problema que causan el error, con
    orientación para corregirlo.
-   Soportar migraciones controladas entre versiones de esquema.
-   Antes de migrar, preservar copia o historial recuperable.
-   Validar el resultado de la migración y conservar IDs, relaciones,
    notas y documentación.
-   Permitir rollback si una migración falla o produce un modelo
    inválido.

### 8.6 Eliminación lógica

La eliminación debe conservar trazabilidad. En lugar de destruir
inmediatamente un elemento:

-   Marcarlo como eliminado u obsoleto.
-   Registrar el cambio en el historial.
-   Actualizar o desactivar sus relaciones activas de forma consistente.
-   Conservar las referencias históricas y documentación relacionada.
-   Permitir restaurarlo sin inventar un ID nuevo si se restaura la
    misma entidad.

## 9. Servicio local y experiencia de ejecución

### 9.1 Distribución y arranque

-   Entregar un build compilado descargable para las plataformas
    objetivo que permita la tecnología seleccionada.
-   El usuario no debe necesitar compilar el proyecto manualmente para
    ejecutarlo.
-   La aplicación se inicia con un comando sencillo.
-   Al iniciar, levanta un servicio web local y permite abrir la
    interfaz en el navegador.
-   El puerto debe ser configurable o seleccionarse automáticamente
    dentro de una estrategia documentada para evitar colisiones.
-   Si el puerto solicitado está ocupado, informar el conflicto y
    aplicar un fallback seguro o pedir una elección explícita; nunca
    fallar sin explicación.
-   Mostrar la dirección local activa.
-   Si se indica la ruta del repositorio como argumento, abrir ese
    proyecto. Si no se indica, permitir seleccionar una carpeta desde la
    interfaz.
-   La aplicación debe funcionar en navegadores modernos y en los
    sistemas operativos compatibles con el runtime elegido. Probar el
    empaquetado en las plataformas que el MVP declare soportadas.

### 9.2 Ejemplo conceptual de uso

El comando final se decidirá al implementar, pero el flujo debe admitir
un uso equivalente a:

``` bash
architecture-map --repo /ruta/al/proyecto
```

Si no se pasa `--repo`, la interfaz debe permitir seleccionar el
repositorio. No asumir una ruta por defecto que conceda acceso a
carpetas no autorizadas.

### 9.3 Límites de acceso

-   Escuchar en `localhost`/loopback por defecto, no en interfaces
    públicas.
-   Restringir operaciones de archivos al repositorio autorizado y a las
    ubicaciones internas explícitamente necesarias.
-   Validar y normalizar rutas para impedir traversal y acceso fuera del
    proyecto autorizado.
-   No ejecutar comandos arbitrarios obtenidos de los archivos del
    modelo.
-   No mostrar ni registrar secretos encontrados en archivos.
-   No enviar código, modelo o contenido del repositorio a servicios
    externos sin autorización explícita e informada.

## 10. Sincronización con archivos y Git

### 10.1 Flujo principal

Claude o el desarrollador modifica los archivos estructurados del modelo
dentro del repositorio. La aplicación detecta los cambios, valida el
conjunto actualizado y, si es válido, refresca las vistas. El modelo se
mantiene junto al código y se versiona con Git.

### 10.2 Reglas de sincronización

-   Detectar cambios externos en los archivos del modelo mientras la
    aplicación está activa.
-   Validar antes de actualizar la vista.
-   Aplicar una actualización válida de forma consistente.
-   Ante errores, conservar la última versión válida y mostrar el error.
-   No sobrescribir silenciosamente ediciones concurrentes.
-   Mantener historial suficiente para comparar y restaurar cambios.
-   El flujo normal de trabajo debe animar a Claude a actualizar el
    modelo en la misma tarea en que modifica la arquitectura o el código
    relevante.

### 10.3 Cambios concurrentes

-   Combinar automáticamente cambios independientes cuando sea seguro.
-   Detectar cambios incompatibles sobre el mismo elemento o relación.
-   Presentar los conflictos reales para revisión humana.
-   No usar una política de último escritor gana para descartar cambios
    silenciosamente.
-   No bloquear todas las ediciones solo para evitar conflictos.

### 10.4 Ediciones desde la interfaz

Las ediciones realizadas en la interfaz deben persistirse en los
archivos canónicos del modelo o en un formato de cambios equivalente que
se aplique a ellos. Debe evitarse mantener una copia visual que diverja
indefinidamente de los archivos versionados.

## 11. Integración con Claude Code

La integración inicial será mediante una **skill de Claude Code**. No se
exige una API remota para el MVP. Claude trabajará directamente con los
archivos del modelo en el repositorio.

### 11.1 Responsabilidades de la skill

La skill debe instruir a Claude para que:

1.  Lea primero el resumen general y el manifiesto del modelo.
2.  Identifique los módulos, elementos, relaciones y flujos relevantes
    para la tarea.
3.  Explore el repositorio real antes de implementar cambios; no confiar
    ciegamente en la documentación existente.
4.  Busque código, módulos o funcionalidades reutilizables antes de
    crear otros nuevos.
5.  Compare el modelo con el código cuando la tarea afecte arquitectura,
    dependencias, rutas, persistencia, infraestructura o reglas de
    negocio.
6.  Actualice los archivos del modelo cuando cambien componentes,
    relaciones, flujos, decisiones o documentación arquitectónica.
7.  Conserve IDs existentes al renombrar o mover entidades.
8.  No invente módulos, dependencias, reglas ni explicaciones sin
    evidencia.
9.  Marque como incompleta o desconocida la información que no pueda
    establecer.
10. Distinga los hechos verificados de las inferencias y señale la
    evidencia disponible.
11. Valide el modelo después de editarlo, usando el validador del
    proyecto si existe.
12. Informe discrepancias, información pendiente y errores de validación
    de forma clara.
13. Evite leer el modelo completo si el cambio puede resolverse
    consultando un subconjunto pertinente, pero amplíe la lectura cuando
    el alcance lo requiera.
14. Informe al final qué archivos de código y modelo cambió, qué
    validaciones ejecutó y qué quedó pendiente.

### 11.2 Regla contra generación autónoma del diagrama

La skill no debe ordenar a la aplicación reconstruir automáticamente
toda la arquitectura a partir del código. Claude puede descubrir
información durante la exploración y declarar cambios en el modelo, pero
debe conservar la evidencia, revisar entidades existentes, evitar
duplicados y marcar incertidumbre. La aplicación representa y valida el
modelo que se le entrega.

### 11.3 Uso eficiente del contexto

-   Leer el overview antes que los detalles.
-   Consultar solo módulos y relaciones relevantes por defecto.
-   Seguir referencias para expandir el contexto cuando sea necesario.
-   Permitir una lectura completa cuando la tarea afecte arquitectura
    transversal.
-   No omitir dependencias críticas únicamente para ahorrar tokens.

## 12. Importación, exportación e interoperabilidad

### 12.1 Formato nativo

El formato estructurado propio es el canónico y debe preservar
semántica, IDs, relaciones, procedencia, notas, documentación y versión
de esquema.

### 12.2 Formatos iniciales

-   Mermaid: importación y exportación de los tipos de diagramas
    compatibles.
-   draw.io: importación y exportación de elementos y relaciones
    compatibles.
-   JSON/YAML: importación y exportación del modelo estructurado.
-   PNG/SVG/PDF: exportación de las vistas visuales.
-   Repositorio Git: acceso a archivos autorizados para verificar y
    mantener el modelo, no generación autónoma de diagramas.

### 12.3 Conversión segura

-   Convertir nodos, conexiones, etiquetas y agrupaciones compatibles a
    objetos nativos editables.
-   Preservar metadatos del archivo de origen cuando algunos elementos
    no puedan convertirse completamente.
-   Advertir sobre elementos no compatibles o pérdidas potenciales antes
    de confirmar una importación.
-   No descartar información silenciosamente.
-   Validar el resultado antes de reemplazar o fusionar el modelo
    actual.
-   La importación debe permitir revisar el resultado antes de confirmar
    cambios destructivos.

Si alguna interoperabilidad resulta demasiado costosa para la primera
entrega, implementar el núcleo del modelo y la validación primero, y
documentar explícitamente la función pendiente en lugar de fingir
compatibilidad completa.

## 13. Verificación del modelo frente al código

El análisis de código es una función de verificación, no el motor
principal de creación del diagrama.

### 13.1 Objetivo

Ayudar a detectar diferencias entre lo que el modelo declara y lo que se
puede observar en el repositorio: referencias que ya no existen,
dependencias que parecen haber cambiado, rutas o tablas no documentadas,
configuraciones de infraestructura y otros desajustes pertinentes.

### 13.2 Cobertura inicial

-   TypeScript y JavaScript.
-   SQL y estructuras de bases de datos presentes en el repositorio.
-   Docker y Docker Compose.
-   Terraform.

La cobertura inicial puede limitarse a los datos que se puedan verificar
de forma fiable. La arquitectura debe permitir incorporar analizadores
adicionales mediante adaptadores sin modificar el modelo semántico
central.

### 13.3 Restricciones

-   No crear automáticamente diagramas completos a partir del análisis.
-   No presentar inferencias como hechos.
-   Adjuntar evidencia o referencias cuando sea posible.
-   Marcar los resultados inferidos como pendientes de revisión.
-   No cambiar el modelo automáticamente por una discrepancia sin que
    una persona o agente autorizado la revise y declare el cambio.
-   No ampliar el alcance a un análisis estático exhaustivo de todos los
    lenguajes en el MVP.

## 14. Requisitos no funcionales

### 14.1 Rendimiento y escalabilidad

-   Cargar primero el resumen y la vista solicitada, sin requerir
    renderizar todo el modelo.
-   Evitar bloquear la interfaz durante validaciones o importaciones de
    tamaño razonable.
-   Mantener un modelo que pueda crecer por módulos y archivos.
-   Establecer límites razonables y mensajes claros para archivos o
    proyectos demasiado grandes.

### 14.2 Fiabilidad

-   No perder la última versión válida del modelo por una edición
    inválida.
-   No guardar relaciones rotas como si fueran válidas.
-   Preservar IDs, notas e historial durante migraciones y
    restauraciones.
-   Probar rutas de error además del flujo exitoso.

### 14.3 Usabilidad

-   Interfaz visual clara y navegable.
-   Errores de validación comprensibles para desarrolladores.
-   Estados visibles para cambios pendientes, conflictos y
    discrepancias.
-   La edición manual debe ser posible sin necesitar Claude.

### 14.4 Privacidad y seguridad

-   Local-first por defecto.
-   Acceso limitado al repositorio seleccionado.
-   Servicio local no expuesto a la red por defecto.
-   No enviar datos externos sin consentimiento explícito.
-   Evitar registrar secretos o contenidos sensibles.
-   No ejecutar contenido del modelo como código.

## 15. Historias de usuario y criterios de aceptación

Las historias siguientes definen el alcance verificable. Las prioridades
son: **P0** imprescindible para el núcleo del MVP; **P1** importante,
pero puede implementarse después de estabilizar el núcleo. Una función
P1 no debe retrasar una entrega local funcional.

### Épica A --- Ejecutar y conectar un proyecto

#### AM-001 --- Iniciar la aplicación local (P0)

**Como** desarrollador, **quiero** iniciar la herramienta con un
comando, **para** abrir y trabajar con un proyecto sin compilar
manualmente la aplicación.

Criterios de aceptación: - Existe un build distribuible y una
instrucción de arranque documentada. - El comando inicia el servicio
local y proporciona una dirección para abrir en el navegador. - La
aplicación escucha en loopback por defecto. - Si el puerto está ocupado,
se informa el problema y se aplica un fallback seguro o se solicita una
elección. - La aplicación muestra la dirección y el puerto activos.

#### AM-002 --- Conectar un repositorio (P0)

**Como** desarrollador, **quiero** indicar una ruta en el comando o
seleccionar una carpeta desde la interfaz, **para** cargar el modelo de
un proyecto.

Criterios de aceptación: - Se acepta una ruta de repositorio por
argumento de comando. - Si no se entrega una ruta, la interfaz permite
seleccionar una carpeta. - La aplicación muestra qué repositorio está
activo. - La aplicación no accede a otras carpetas fuera de las
autorizadas. - Una ruta inexistente o sin permisos produce un mensaje
comprensible.

### Épica B --- Modelo estructurado y validación

#### AM-003 --- Cargar un modelo dividido en archivos (P0)

**Como** desarrollador, **quiero** que la arquitectura esté guardada en
varios archivos estructurados, **para** mantenerla legible, modular y
versionable en Git.

Criterios de aceptación: - La aplicación detecta y carga el formato
nativo del proyecto. - El formato incluye una versión de esquema. - Los
archivos pueden referenciar elementos de otros archivos mediante IDs. -
Las referencias se validan y se informa cuando están rotas. - El modelo
se puede leer sin depender de una base de datos remota.

#### AM-004 --- Validar cambios del modelo (P0)

**Como** desarrollador, **quiero** que cada actualización se valide
antes de mostrarse, **para** evitar que un archivo inválido corrompa la
vista.

Criterios de aceptación: - Se validan estructura, tipos, IDs y
referencias. - Si el modelo nuevo es inválido, la interfaz conserva
visible la última versión válida. - Se muestra el archivo y el campo o
referencia que provocó el error cuando sea posible. - No se aplica
silenciosamente una parte del cambio inválido. - Tras corregir el
archivo, la aplicación puede volver a validar y actualizarse.

#### AM-005 --- Mantener IDs estables (P0)

**Como** desarrollador, **quiero** que los elementos conserven su ID al
cambiar de nombre o ubicación, **para** preservar relaciones, notas e
historial.

Criterios de aceptación: - Renombrar un elemento no genera un ID
nuevo. - Mover la definición a otro archivo no rompe su identidad. - Las
relaciones apuntan a IDs estables. - Los IDs duplicados o las
referencias inexistentes son errores de validación.

#### AM-006 --- Registrar procedencia y nivel de verificación (P0)

**Como** desarrollador, **quiero** distinguir hechos documentados,
hechos verificados e inferencias, **para** no confundir suposiciones con
arquitectura confirmada.

Criterios de aceptación: - El modelo permite registrar el origen y
estado de verificación de hechos y relaciones pertinentes. - Se pueden
adjuntar referencias o evidencias cuando existan. - La interfaz
diferencia visualmente los estados sin ocultar incertidumbre. - La falta
de información se muestra como desconocida o incompleta.

### Épica C --- Visualización y edición

#### AM-007 --- Explorar la arquitectura visualmente (P0)

**Como** desarrollador, **quiero** ver los elementos y sus relaciones en
un lienzo navegable, **para** entender el sistema sin leer todos los
archivos del proyecto.

Criterios de aceptación: - Se representa el modelo válido mediante
nodos, relaciones y agrupaciones. - El usuario puede acercar, alejar y
desplazarse por el lienzo. - Seleccionar un elemento abre su panel de
detalle. - La vista refleja los datos del modelo, no una imagen
independiente.

#### AM-008 --- Consultar varias vistas del mismo modelo (P0)

**Como** desarrollador, **quiero** cambiar entre vistas de arquitectura,
dependencias, infraestructura, datos y flujos, **para** entender
distintas dimensiones del mismo sistema.

Criterios de aceptación: - Existe una vista general y soporte para las
vistas específicas iniciales. - Un elemento conserva su ID entre
vistas. - Desde un elemento se puede navegar a otras vistas donde
aparezca. - Una vista con datos insuficientes indica que está incompleta
en vez de inventar elementos.

#### AM-009 --- Crear y editar diagramas manualmente (P0)

**Como** desarrollador, **quiero** crear y modificar elementos y
relaciones desde la interfaz, **para** documentar la arquitectura sin
depender de un agente de IA.

Criterios de aceptación: - Puedo crear, editar y eliminar lógicamente
elementos y relaciones. - Puedo mover, redimensionar, agrupar y cambiar
estilos de los elementos. - Puedo añadir notas y documentación
contextual. - Los cambios se guardan en el modelo canónico o en una
operación de cambios que se aplique a este. - La interfaz no mantiene
una copia visual permanentemente separada de los archivos canónicos.

#### AM-010 --- Consultar el detalle de un elemento (P0)

**Como** desarrollador, **quiero** consultar la responsabilidad,
relaciones, notas y referencias de un elemento, **para** entender su
función y contexto.

Criterios de aceptación: - El panel muestra los campos disponibles y sus
estados de completitud. - Muestra relaciones relevantes y referencias a
código cuando existan. - Diferencia información verificada, inferida y
pendiente de revisión. - Los campos desconocidos no se completan
automáticamente con supuestos.

### Épica D --- Sincronización e historial

#### AM-011 --- Reflejar cambios hechos por Claude en los archivos (P0)

**Como** desarrollador, **quiero** que la aplicación detecte cambios en
los archivos del modelo, **para** ver las actualizaciones declaradas por
Claude sin reconstruir manualmente el diagrama.

Criterios de aceptación: - La aplicación detecta cambios externos
mientras está abierta. - Valida el modelo actualizado antes de
renderizarlo. - Los cambios válidos se reflejan sin reiniciar el
servicio cuando sea posible. - Los cambios inválidos mantienen visible
la última versión válida y muestran el error.

#### AM-012 --- Mantener el modelo junto al código (P0)

**Como** desarrollador, **quiero** que Claude actualice el modelo como
parte de los cambios relevantes de código, **para** mantener
documentación y arquitectura sincronizadas en Git.

Criterios de aceptación: - La skill explica cuándo y cómo actualizar los
archivos del modelo. - Los cambios del modelo son legibles en diffs de
Git. - El resultado de una tarea de Claude informa qué archivos del
modelo fueron actualizados y qué validaciones se ejecutaron. - La
aplicación detecta los cambios y los refleja tras validarlos.

#### AM-013 --- Restaurar elementos y cambios anteriores (P0)

**Como** desarrollador, **quiero** recuperar elementos o versiones
anteriores, **para** corregir eliminaciones y modificaciones
accidentales.

Criterios de aceptación: - Las eliminaciones se conservan como registros
lógicos o en el historial. - Es posible restaurar un elemento eliminado
preservando su identidad cuando sea la misma entidad. - El historial
permite identificar el cambio y volver a una versión válida. - La
restauración valida el resultado antes de aplicarlo.

#### AM-014 --- Resolver cambios concurrentes sin pérdida silenciosa (P1)

**Como** desarrollador, **quiero** que los cambios independientes se
integren y los conflictos reales se muestren, **para** evitar perder
ediciones.

Criterios de aceptación: - Los cambios independientes se pueden combinar
cuando no alteran la misma información de forma incompatible. - Los
conflictos se presentan para revisión. - No se descartan cambios con una
política silenciosa de último escritor gana. - Las versiones previas
siguen siendo recuperables.

### Épica E --- Skill de Claude Code

#### AM-015 --- Instalar y usar la skill del proyecto (P0)

**Como** desarrollador que trabaja con Claude Code, **quiero** una skill
que explique el modelo y sus reglas, **para** que Claude lo mantenga
correctamente durante el desarrollo.

Criterios de aceptación: - La skill está incluida en el repositorio y
tiene instrucciones de instalación/uso. - Lee el overview antes de
cargar detalles. - Consulta solo los módulos relevantes por defecto y
amplía el contexto cuando sea necesario. - Explora el código real antes
de implementar cambios. - Busca reutilización antes de crear componentes
nuevos. - Actualiza y valida el modelo cuando corresponda. - Preserva
IDs y no inventa hechos o relaciones. - Informa discrepancias y datos
pendientes.

#### AM-016 --- Evitar que la skill invente arquitectura (P0)

**Como** desarrollador, **quiero** que Claude documente solo lo que
puede justificar y marque lo desconocido, **para** confiar en el mapa
arquitectónico.

Criterios de aceptación: - Las relaciones nuevas requieren una
declaración sustentada en evidencia o una indicación explícita de que
son inferidas. - Las inferencias quedan marcadas para revisión. - Los
datos no conocidos se dejan incompletos. - La skill no solicita
reconstruir automáticamente todo el diagrama desde el código.

### Épica F --- Importación y exportación

#### AM-017 --- Importar y exportar el formato nativo (P0)

**Como** desarrollador, **quiero** importar y exportar el modelo
estructurado, **para** respaldarlo y manipularlo desde herramientas
compatibles.

Criterios de aceptación: - El formato nativo incluye versión de
esquema. - La importación valida IDs, tipos y relaciones. - La
exportación preserva semántica, documentación y procedencia
disponibles. - Los errores se muestran antes de sustituir el modelo
actual.

#### AM-018 --- Exportar una vista a PNG, SVG o PDF (P1)

**Como** desarrollador, **quiero** exportar una vista visual, **para**
compartirla en documentación o presentaciones.

Criterios de aceptación: - Puedo exportar la vista actual a los formatos
implementados. - La exportación conserva legibilidad, textos y
conexiones dentro de las limitaciones del formato. - Los errores de
exportación se comunican sin afectar el modelo.

#### AM-019 --- Intercambiar diagramas Mermaid y draw.io (P1)

**Como** desarrollador, **quiero** importar y exportar diagramas Mermaid
y draw.io, **para** reutilizar diagramas existentes y compartirlos con
otras herramientas.

Criterios de aceptación: - Se convierten a objetos editables los nodos,
conexiones, etiquetas y agrupaciones compatibles. - Se informa de
elementos que no se puedan convertir completamente. - Se preserva
información de origen cuando sea necesario. - No se pierde información
silenciosamente ni se reemplaza el modelo actual sin revisión.

### Épica G --- Verificación de discrepancias

#### AM-020 --- Comparar el modelo con el repositorio (P1)

**Como** desarrollador, **quiero** detectar discrepancias entre el
modelo y el código, **para** saber qué documentación podría estar
desactualizada.

Criterios de aceptación: - El análisis inicial cubre solo los tipos de
información implementados de forma fiable para TypeScript, JavaScript,
SQL, Docker/Compose y Terraform. - Los resultados muestran evidencia
cuando esté disponible. - Los resultados inferidos se distinguen de los
verificados. - La herramienta no crea ni modifica automáticamente
diagramas a partir de los resultados. - El usuario o un agente
autorizado revisa y declara los cambios al modelo.

### Épica H --- Seguridad local

#### AM-021 --- Proteger el repositorio local (P0)

**Como** desarrollador, **quiero** que la herramienta solo opere sobre
el repositorio autorizado y no exponga el servicio, **para** reducir
riesgos de seguridad.

Criterios de aceptación: - El servicio escucha en localhost por
defecto. - Las rutas se validan para impedir acceso fuera del
repositorio autorizado. - La aplicación no ejecuta comandos contenidos
en el modelo. - No se transmiten archivos a servicios externos sin
consentimiento explícito. - Los mensajes y logs no revelan secretos
detectados en archivos.

## 16. Criterios globales de aceptación del MVP

El MVP se considera listo para una primera entrega cuando se cumpla lo
siguiente:

1.  Se puede descargar y ejecutar el build con un comando documentado.
2.  El servicio local inicia, informa su dirección y abre la interfaz en
    el navegador.
3.  El repositorio se puede indicar en el comando o seleccionar desde la
    interfaz.
4.  Se puede cargar un modelo nativo repartido en varios archivos.
5.  El modelo se valida y se representa en un lienzo editable.
6.  Se pueden crear y modificar manualmente elementos, relaciones y
    notas.
7.  Un mismo elemento aparece en varias vistas manteniendo su identidad.
8.  La aplicación detecta cambios externos de Claude o de una persona en
    los archivos del modelo y refleja cambios válidos.
9.  Un modelo inválido no destruye ni reemplaza la última versión válida
    visible.
10. Renombrar o mover una entidad no cambia su ID.
11. La eliminación conserva historial y permite restauración.
12. La skill de Claude Code enseña a leer el modelo, explorar el
    repositorio, reutilizar código y actualizar archivos estructurados.
13. El flujo de trabajo deja el modelo y el código razonablemente
    sincronizados mediante cambios explícitos en el repositorio.
14. El servicio local no queda expuesto a la red por defecto y respeta
    los límites de acceso a archivos.
15. La compatibilidad de plataformas declarada está probada para el
    build distribuido.
16. Las capacidades de importación/exportación que se declaren completas
    están probadas; las limitaciones restantes se documentan claramente.

## 17. Plan de implementación recomendado

Implementar en fases pequeñas, manteniendo el producto ejecutable al
final de cada fase.

### Fase 1 --- Esquema, modelo y validador

-   Definir el esquema nativo versionado.
-   Definir IDs, tipos de entidad, relaciones, procedencia, estados y
    referencias.
-   Definir organización de archivos y ejemplos mínimos.
-   Implementar validación estructural y referencial.
-   Implementar errores comprensibles y pruebas para modelos válidos e
    inválidos.
-   Documentar el formato para personas y agentes.

**Salida:** modelo nativo documentado, ejemplo de proyecto y validador
probado.

### Fase 2 --- Servicio local y visualización inicial

-   Implementar arranque local, selección de repositorio y manejo de
    puertos.
-   Implementar lectura segura del modelo.
-   Renderizar la vista general y el panel de detalle.
-   Mostrar estados de carga, error e información incompleta.

**Salida:** aplicación local que abre y visualiza un modelo válido.

### Fase 3 --- Editor y vistas

-   Implementar edición manual de elementos, relaciones y notas.
-   Implementar distribución visual y estilos básicos.
-   Implementar las vistas iniciales a partir del mismo modelo.
-   Asegurar identidad estable entre vistas.

**Salida:** editor visual funcional que guarda en el modelo canónico.

### Fase 4 --- Sincronización e historial

-   Detectar cambios externos en archivos del modelo.
-   Validar y actualizar la interfaz sin reiniciar cuando sea posible.
-   Conservar última versión válida ante errores.
-   Implementar historial, eliminación lógica y restauración.
-   Implementar manejo inicial de conflictos.

**Salida:** el modelo se puede mantener desde Git, la interfaz y Claude
sin pérdida silenciosa.

### Fase 5 --- Skill de Claude Code

-   Crear la skill y documentar su instalación.
-   Incluir reglas de exploración del código, reutilización,
    actualización del modelo y validación.
-   Probarla con cambios de ejemplo que añadan, renombren y modifiquen
    relaciones.
-   Verificar que no invente datos ni duplique entidades.

**Salida:** Claude puede actualizar el modelo como parte de una tarea de
desarrollo.

### Fase 6 --- Importación, exportación y verificación

-   Añadir importación/exportación nativa JSON/YAML.
-   Añadir exportación visual.
-   Implementar intercambio Mermaid y draw.io dentro del alcance
    compatible.
-   Implementar detectores de discrepancias acotados para las
    tecnologías iniciales.
-   Documentar limitaciones y añadir pruebas de regresión.

**Salida:** interoperabilidad y verificación iniciales sin convertir el
producto en un generador autónomo de diagramas.

## 18. Estrategia mínima de pruebas

Las pruebas deben cubrir, como mínimo:

-   Validación de modelo correcto e incorrecto.
-   IDs duplicados, referencias rotas y tipos no soportados.
-   Renombrado y traslado de una entidad conservando ID y relaciones.
-   Actualización externa de archivos válidos e inválidos.
-   Conservación de la última versión válida tras errores.
-   Eliminación lógica, restauración e historial.
-   Restricción de acceso a rutas fuera del repositorio autorizado.
-   Manejo de puertos ocupados.
-   Renderizado y navegación de varias vistas con la misma identidad.
-   Importación/exportación sin pérdida silenciosa de información
    compatible.
-   Skill de Claude con casos de añadir, modificar y retirar
    componentes.
-   Comportamiento ante inferencias y datos incompletos.

No declarar una fase completada solo porque la aplicación compila. Debe
haber pruebas pertinentes y una verificación manual del flujo principal.

## 19. Decisiones pendientes que no bloquean el inicio

No detener la implementación para ampliar el producto. Elegir defaults
sencillos y documentarlos cuando sea necesario:

-   Framework visual y biblioteca de canvas.
-   Runtime y empaquetado multiplataforma.
-   Detalle exacto de la organización final de archivos, manteniendo los
    principios de la sección 8.
-   Mecanismo concreto de detección de cambios en archivos según el
    sistema operativo.
-   Formatos y tipos exactos de diagramas soportados en la primera
    versión de importación.
-   Estrategia de distribución de builds y actualización de versiones.

La plataforma de colaboración cloud, el modelo comercial freemium y
otros requerimientos de una segunda parte quedan expresamente fuera de
este documento y se definirán en una especificación posterior.

## 20. Definición de terminado

Una historia está terminada cuando:

-   Cumple sus criterios de aceptación.
-   Incluye pruebas apropiadas.
-   Los errores y estados límite relevantes están manejados.
-   La documentación necesaria está actualizada.
-   No introduce funcionalidades ajenas al alcance.
-   El código respeta la arquitectura y convenciones existentes del
    repositorio.
-   Cualquier limitación conocida queda descrita de forma explícita.

El MVP completo está terminado cuando se cumplen los criterios globales
de la sección 16 y el flujo principal puede demostrarse desde un
repositorio limpio hasta una arquitectura visual editable, actualizada
desde los archivos estructurados y mantenida con ayuda de la skill de
Claude Code.
