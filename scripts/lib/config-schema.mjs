// Single source of truth for every .coalledger.json key (SKILL-REPO-PATTERN
// Layer 3). Flat key list like CoalMine/CoalWash. verify.mjs validates the
// factory template against it; every runtime read goes through clampedRead so
// an out-of-range or wrong-typed value silently degrades to the factory
// default, never misbehaves.
//
// Spec fields:
//   key     canonical .coalledger.json key
//   type    'bool' | 'int' | 'number' | 'enum' | 'strArr'
//   min/max bounds for 'int'/'number' (inclusive)
//   values  allowed values for 'enum' (compared case-insensitively)
//   def     factory default — the clamp target for any invalid value
//   help    one-line description
//
// Standard-system keys (language / updateMode / updateCheckDays) keep
// CoalMine's schema shapes byte-for-byte (values + bounds + help) — one flock,
// one color. disabledCanaries stays free-form (membership is not validated:
// pinning the name list here would break forward-compat every time a canary
// ships in a later phase).

export const CONFIG_SCHEMA = [
  { key: 'coalledgerMode', type: 'enum', values: ['auto', 'manual', 'off'], def: 'auto', help: 'Master switch: auto = session-start conductor offers the doc canaries; manual = conductor silent, you invoke canaries yourself; off = fully silent' },
  { key: 'language', type: 'enum', values: ['auto', 'th', 'en', 'ja', 'zh', 'es'], def: 'auto', help: 'Language override for prompts and nudges (auto, th, en, ja, zh, es)' },
  { key: 'disabledCanaries', type: 'strArr', def: [], help: "Canary names to disable (e.g. [\"doc-structure\"]); 'conductor' or 'all' silences the conductor entirely" },
  { key: 'severityFloor', type: 'enum', values: ['low', 'medium', 'high', 'critical'], def: 'low', help: 'Report findings at or above this severity (severity is assigned by context in the report step, never mechanically)' },
  { key: 'quickVsFull', type: 'enum', values: ['quick', 'full'], def: 'quick', help: 'Default scan tier for mixed canaries: quick = mechanical layer only (~free, report-only) · full = adds the semantic layer (paid; always a separate consent)' },
  { key: 'docLeak', type: 'bool', def: true, help: 'Enable the #7 doc-leak canary (prose-level public/private boundary; default on — a private-only project turns it off)' },
  { key: 'publicMode', type: 'bool', def: false, help: 'Treat this project’s docs as PUBLIC-facing (raises leak/grounding stakes in severity context)' },
  { key: 'updateMode', type: 'enum', values: ['ask', 'auto', 'remind', 'off'], def: 'ask', help: 'Self-update behavior at session start (ask, auto, remind, off; default: ask)' },
  { key: 'updateCheckDays', type: 'int', min: 1, max: 365, def: 14, help: 'Days between self-update checks/reminders (default: 14)' },
];

// Validate an already-parsed JSON value against a spec.
// Returns an error message fragment ("must be ...") or null when valid.
export function validateValue(spec, v) {
  switch (spec.type) {
    case 'bool':
      return typeof v === 'boolean' ? null : 'must be a boolean';
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
      if (!Number.isInteger(v)) return 'must be an integer';
      if (spec.min != null && v < spec.min) return `must be >= ${spec.min}`;
      if (spec.max != null && v > spec.max) return `must be <= ${spec.max}`;
      return null;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
      if (spec.min != null && v < spec.min) return `must be >= ${spec.min}`;
      if (spec.max != null && v > spec.max) return `must be <= ${spec.max}`;
      return null;
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v.toLowerCase())
        ? null
        : `must be one of: ${spec.values.join(', ')}`;
    case 'strArr':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? null
        : 'must be an array of strings';
    default:
      return `has an unknown spec type '${spec.type}'`;
  }
}

// Validate a full parsed config object (unknown keys are reported, never thrown).
export function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['config must be a JSON object'];
  const byKey = new Map(CONFIG_SCHEMA.map((s) => [s.key, s]));
  for (const [key, v] of Object.entries(cfg)) {
    const spec = byKey.get(key);
    if (!spec) { errors.push(`'${key}' not in schema`); continue; }
    const err = validateValue(spec, v);
    if (err) errors.push(`'${key}' ${err}`);
  }
  return errors;
}

// Clamped read: return the config value for `key` if valid, else the factory
// default (enums normalized to lowercase). An unknown key returns undefined —
// that is a programming error, surfaced loud in tests, silent at runtime.
export function clampedRead(cfg, key) {
  const spec = CONFIG_SCHEMA.find((s) => s.key === key);
  if (!spec) return undefined;
  const v = cfg ? cfg[key] : undefined;
  if (v === undefined || validateValue(spec, v) !== null) return spec.def;
  if (spec.type === 'enum') return v.toLowerCase();
  if (spec.type === 'strArr') return v.map((x) => x.toLowerCase());
  return v;
}
