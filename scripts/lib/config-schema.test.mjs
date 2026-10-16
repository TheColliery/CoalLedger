import { test } from 'node:test';
import assert from 'node:assert';
import { CONFIG_SCHEMA, validateValue, validateConfig, clampedRead } from './config-schema.mjs';

test('every schema key carries a valid default (the clamp target)', () => {
  for (const spec of CONFIG_SCHEMA) {
    assert.notStrictEqual(spec.def, undefined, `${spec.key} has no def`);
    assert.strictEqual(validateValue(spec, spec.def), null, `${spec.key} default fails its own spec`);
  }
});

test('standard-system keys keep the CoalMine shapes (one flock, one color)', () => {
  const lang = CONFIG_SCHEMA.find((s) => s.key === 'language');
  assert.deepStrictEqual(lang.values, ['auto', 'th', 'en', 'ja', 'zh', 'es']);
  assert.strictEqual(lang.def, 'auto');
  const um = CONFIG_SCHEMA.find((s) => s.key === 'updateMode');
  assert.deepStrictEqual(um.values, ['ask', 'auto', 'remind', 'off']);
  assert.strictEqual(um.def, 'ask');
  const ud = CONFIG_SCHEMA.find((s) => s.key === 'updateCheckDays');
  assert.strictEqual(ud.min, 1);
  assert.strictEqual(ud.max, 365);
  assert.strictEqual(ud.def, 14);
});

test('CoalLedger keys: mode enum, canary toggles, gated doc-leak, severity floor', () => {
  const mode = CONFIG_SCHEMA.find((s) => s.key === 'coalledgerMode');
  assert.deepStrictEqual(mode.values, ['auto', 'manual', 'off']);
  assert.strictEqual(mode.def, 'auto');
  const dc = CONFIG_SCHEMA.find((s) => s.key === 'disabledCanaries');
  assert.strictEqual(dc.type, 'strArr');
  assert.deepStrictEqual(dc.def, []);
  assert.strictEqual(CONFIG_SCHEMA.find((s) => s.key === 'docLeak').def, true, 'doc-leak ships ON by default (a private-only project turns it off)');
  const sf = CONFIG_SCHEMA.find((s) => s.key === 'severityFloor');
  assert.deepStrictEqual(sf.values, ['low', 'medium', 'high', 'critical']);
  assert.strictEqual(sf.def, 'low');
  const qf = CONFIG_SCHEMA.find((s) => s.key === 'quickVsFull');
  assert.deepStrictEqual(qf.values, ['quick', 'full']);
  assert.strictEqual(qf.def, 'quick');
});

test('validateValue: bounds, types, and the strArr shape', () => {
  const int = { type: 'int', min: 1, max: 365 };
  assert.strictEqual(validateValue(int, 14), null);
  assert.ok(validateValue(int, 0));
  assert.ok(validateValue(int, 366));
  assert.ok(validateValue(int, 1.5));
  assert.ok(validateValue(int, 'x'));
  const en = { type: 'enum', values: ['auto', 'manual', 'off'] };
  assert.strictEqual(validateValue(en, 'AUTO'), null, 'enums compare case-insensitively');
  assert.ok(validateValue(en, 'sideways'));
  const b = { type: 'bool' };
  assert.strictEqual(validateValue(b, true), null);
  assert.ok(validateValue(b, 'true'));
  const arr = { type: 'strArr' };
  assert.strictEqual(validateValue(arr, []), null);
  assert.strictEqual(validateValue(arr, ['doc-structure']), null);
  assert.ok(validateValue(arr, 'doc-structure'));
  assert.ok(validateValue(arr, [1]));
});

test('validateConfig reports unknown keys and bad values, never throws', () => {
  const errors = validateConfig({ coalledgerMode: 'auto', nonsense: 1, updateCheckDays: 999 });
  assert.ok(errors.some((e) => e.includes("'nonsense'")));
  assert.ok(errors.some((e) => e.includes("'updateCheckDays'")));
  assert.strictEqual(validateConfig({ coalledgerMode: 'auto' }).length, 0);
  assert.deepStrictEqual(validateConfig(null), ['config must be a JSON object']);
  assert.deepStrictEqual(validateConfig([]), ['config must be a JSON object']);
});

test('clampedRead: valid passes through, invalid degrades to the default', () => {
  assert.strictEqual(clampedRead({ updateCheckDays: 30 }, 'updateCheckDays'), 30);
  assert.strictEqual(clampedRead({ updateCheckDays: 0 }, 'updateCheckDays'), 14, 'updateCheckDays:0 must NOT mean nag-every-session');
  assert.strictEqual(clampedRead({}, 'updateCheckDays'), 14);
  assert.strictEqual(clampedRead(undefined, 'updateCheckDays'), 14);
  assert.deepStrictEqual(clampedRead({ disabledCanaries: 'oops' }, 'disabledCanaries'), []);
  assert.deepStrictEqual(clampedRead({ disabledCanaries: ['Doc-Structure'] }, 'disabledCanaries'), ['doc-structure'], 'strArr entries normalize to lowercase');
});

test('clampedRead normalizes enum case and clamps unknown enum values', () => {
  assert.strictEqual(clampedRead({ coalledgerMode: 'OFF' }, 'coalledgerMode'), 'off');
  assert.strictEqual(clampedRead({ coalledgerMode: 'sideways' }, 'coalledgerMode'), 'auto');
  assert.strictEqual(clampedRead({ severityFloor: 'HIGH' }, 'severityFloor'), 'high');
});

test('clampedRead on an unknown key returns undefined (programming error, loud in tests)', () => {
  assert.strictEqual(clampedRead({}, 'noSuchKey'), undefined);
});
