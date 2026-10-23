/**
 * Minimal i18n: English source strings are the keys; Spanish translations
 * live in a dictionary. Missing translations fall back to English. `{name}`
 * placeholders are replaced from `vars`.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'es';
const KEY = 'archflow:lang';

const ES: Record<string, string> = {
  // top bar & general
  '+ Element': '+ Elemento',
  '+ Relation': '+ Relación',
  '+ Free view': '+ Vista libre',
  History: 'Historial',
  Export: 'Exportar',
  Import: 'Importar',
  Verify: 'Verificar',
  'Infrastructure & deployment': 'Infraestructura y despliegue',
  'Data & databases': 'Datos y bases de datos',
  'Business flows': 'Flujos de negocio',
  'Execution & sequence': 'Ejecución y secuencia',
  'Free view': 'Vista libre',
  'Architecture overview': 'Vista general',
  Dependencies: 'Dependencias',
  'No model loaded': 'Sin modelo cargado',
  'service disconnected': 'servicio desconectado',
  valid: 'válido',
  invalid: 'inválido',
  'no-model': 'sin modelo',
  Language: 'Idioma',
  'Connecting to the Archflow service…': 'Conectando con el servicio de Archflow…',
  Cancel: 'Cancelar',
  Save: 'Guardar',
  Create: 'Crear',
  Close: 'Cerrar',
  Saved: 'Guardado',
  // sidebar
  'Find by name, ID or code path': 'Buscar por nombre, ID o ruta de código',
  'No matches': 'Sin resultados',
  Map: 'Mapa',
  'Architecture map': 'Mapa de arquitectura',
  'Saved views': 'Vistas guardadas',
  Views: 'Vistas',
  default: 'por defecto',
  'Show deleted': 'Mostrar eliminados',
  'Reset to automatic layout': 'Volver al orden automático',
  'View settings': 'Ajustes de la vista',
  Reorder: 'Reordenar',
  'This view is incomplete.': 'Esta vista está incompleta.',
  // map
  'Zoom in on a container to reveal its content, or use ▸.': 'Acércate a un contenedor para ver su contenido, o usa ▸.',
  '{n} inside': '{n} dentro',
  'Expand': 'Expandir',
  'Collapse': 'Contraer',
  'No elements to show yet. Declare them in the UI or with the Archflow skill.': 'Aún no hay elementos. Decláralos en la interfaz o con la skill de Archflow.',
  '{n} relations': '{n} relaciones',
  // panel
  'Select an element or relation to see its details.': 'Selecciona un elemento o relación para ver su detalle.',
  'What it is and what it is for': 'Qué es y para qué sirve',
  'Where it is used / what it uses': 'Dónde se usa / qué usa',
  'How it works': 'Cómo funciona',
  'More details': 'Más detalles',
  'Not documented': 'No documentado',
  'Uses': 'Usa',
  'Used by': 'Lo usan',
  'Passes through': 'Pasa por',
  'Calls / depends on': 'Llama / depende de',
  'Called by / depended on by': 'Lo llaman / dependen de él',
  'Contains': 'Contiene',
  'Part of': 'Forma parte de',
  'None declared': 'Ninguno declarado',
  Nothing: 'Nada',
  'Business rules': 'Reglas de negocio',
  Steps: 'Pasos',
  Flows: 'Flujos',
  Decisions: 'Decisiones',
  Notes: 'Notas',
  'Source code': 'Código fuente',
  'No code reference': 'Sin referencia de código',
  Provenance: 'Procedencia',
  Tags: 'Etiquetas',
  'Appears in views': 'Aparece en vistas',
  'Defined in': 'Definido en',
  'Not shown in the current view.': 'No se muestra en la vista actual.',
  Deleted: 'Eliminado',
  Deprecated: 'Obsoleto',
  Edit: 'Editar',
  'Add note': 'Añadir nota',
  Delete: 'Eliminar',
  Restore: 'Restaurar',
  'Hide from this view': 'Ocultar en esta vista',
  'Show in this view': 'Mostrar en esta vista',
  'Style in this view:': 'Estilo en esta vista:',
  'Relations between these elements': 'Relaciones entre estos elementos',
  'Functional dependencies involved': 'Dependencias funcionales implicadas',
  'Not part of any declared flow': 'No forma parte de ningún flujo declarado',
  'None linked': 'Ninguna vinculada',
  'No evidence recorded': 'Sin evidencia registrada',
  None: 'Ninguna',
  'No view': 'Ninguna vista',
  Description: 'Descripción',
  Responsibility: 'Responsabilidad',
  // issues
  'Migrate the model': 'Migrar el modelo',
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, es: ES };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export type T = (text: string, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
}

const Ctx = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    return {
      lang,
      setLang: (l) => {
        setLangState(l);
        try {
          localStorage.setItem(KEY, l);
        } catch {
          /* storage unavailable: the choice lasts for this page only */
        }
      },
      t: (text, vars) => {
        let out = dict[text] ?? text;
        for (const [k, v] of Object.entries(vars ?? {})) out = out.replaceAll(`{${k}}`, String(v));
        return out;
      },
    };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  return (
    <select aria-label={t('Language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="lang-select">
      <option value="es">ES</option>
      <option value="en">EN</option>
    </select>
  );
}
