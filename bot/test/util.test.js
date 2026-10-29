// Pruebas de las utilidades del bot: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock, backoffMs, createJournal, createRateLimiter, createRecent, groupByTenant, lockIsStale, RotatingFile
} from '../src/util.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'bot-test-'));

test('backoffMs crece y se detiene en el tope', () => {
  assert.equal(backoffMs(0, 1000, 8000), 1000);
  assert.equal(backoffMs(1, 1000, 8000), 2000);
  assert.equal(backoffMs(3, 1000, 8000), 8000);
  assert.equal(backoffMs(50, 2000, 300000), 300000);
  assert.equal(backoffMs(-1, 1000, 8000), 1000);
});

test('límite por remitente: 5 cada 10 minutos', () => {
  let t = 0;
  const rl = createRateLimiter({ max: 5, windowMs: 600000, now: () => t });
  for (let i = 0; i < 5; i++) assert.equal(rl.hit('a'), true);
  assert.equal(rl.hit('a'), false);
  assert.equal(rl.hit('b'), true, 'otro remitente no se ve afectado');
  t = 600001;
  assert.equal(rl.hit('a'), true, 'pasada la ventana vuelve a entrar');
  t = 2000000;
  rl.prune();
  assert.equal(rl.size(), 0);
});

test('marcas que vencen: recuerda por un tiempo y con tope', () => {
  let t = 0;
  const r = createRecent({ ttlMs: 1000, max: 2, now: () => t });
  r.add('a');
  assert.equal(r.has('a'), true);
  assert.equal(r.has('b'), false);
  t = 999;
  assert.equal(r.has('a'), true);
  t = 1000;
  assert.equal(r.has('a'), false, 'pasado el tiempo se olvida');
  r.add('a'); r.add('b'); r.add('c');
  assert.equal(r.size(), 2, 'no guarda más de max');
  assert.equal(r.has('a'), false, 'se olvida la más vieja');
  t = 5000;
  r.prune();
  assert.equal(r.size(), 0);
});

test('groupByTenant conserva el orden', () => {
  const g = groupByTenant([{ id: 1, tenant_id: 'x' }, { id: 2, tenant_id: 'y' }, { id: 3, tenant_id: 'x' }]);
  assert.deepEqual([...g.keys()], ['x', 'y']);
  assert.deepEqual(g.get('x').map((r) => r.id), [1, 3]);
  assert.equal(groupByTenant(null).size, 0);
});

test('lockIsStale: pid muerto, archivo viejo o pid vivo', () => {
  const now = 1_000_000;
  assert.equal(lockIsStale(null), true);
  assert.equal(lockIsStale({ pid: 99, mtimeMs: now }, { now, alive: () => false }), true);
  assert.equal(lockIsStale({ pid: 99, mtimeMs: now - 10000 }, { now, alive: () => true }), false);
  assert.equal(lockIsStale({ pid: 99, mtimeMs: now - 200000 }, { now, alive: () => true }), true, 'pid reutilizado');
});

test('candado: el segundo no entra; se libera; se recupera uno abandonado', () => {
  const dir = tmp();
  const file = join(dir, 'bot.lock');
  const a = acquireLock(file);
  assert.equal(a.ok, true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
  // Otro proceso "vivo" con el candado
  writeFileSync(file, JSON.stringify({ pid: 4242 }));
  const b = acquireLock(file, { alive: () => true });
  assert.equal(b.ok, false);
  assert.equal(b.holder.pid, 4242);
  assert.equal(a.touch(), false, 'el primero detecta que ya no es suyo');
  // Abandonado: pid muerto
  const c = acquireLock(file, { alive: () => false });
  assert.equal(c.ok, true);
  assert.equal(c.touch(), true);
  c.release();
  assert.equal(existsSync(file), false);
  // Abandonado: pid vivo pero sin tocar hace mucho (pid reutilizado)
  writeFileSync(file, JSON.stringify({ pid: 4242 }));
  const old = new Date(Date.now() - 600000);
  utimesSync(file, old, old);
  const d = acquireLock(file, { alive: () => true });
  assert.equal(d.ok, true);
  d.release();
  // Archivo dañado y viejo
  writeFileSync(file, '{roto');
  utimesSync(file, old, old);
  assert.equal(acquireLock(file).ok, true);
});

test('diario: guarda, sobrevive a reinicios y se borra al vaciarse', () => {
  const dir = tmp();
  const file = join(dir, 'diario.json');
  const j = createJournal(file);
  assert.equal(j.size(), 0);
  j.add({ id: 'm1', ok: true });
  j.add({ id: 'm2', ok: false, error: 'x' });
  j.add({ id: 'm1', ok: true });
  assert.equal(j.size(), 2);
  const j2 = createJournal(file);
  assert.deepEqual(j2.list().map((e) => [e.id, e.ok, e.error]), [['m2', false, 'x'], ['m1', true, null]]);
  assert.equal(j2.has('m2'), true);
  j2.remove('m1');
  j2.remove('m2');
  assert.equal(existsSync(file), false);
  writeFileSync(file, 'no es json');
  assert.equal(createJournal(file).size(), 0);
});

test('registro: rota por tamaño y por día, y guarda solo los más recientes', () => {
  const dir = tmp();
  let day = new Date(2026, 9, 21, 10);
  const f = new RotatingFile(join(dir, 'bot.log'), { maxBytes: 100, keep: 2, now: () => day });
  f.write('a'.repeat(60) + '\n');
  f.write('b'.repeat(60) + '\n');            // pasa de 100: rota
  assert.deepEqual(readdirSync(dir).sort(), ['bot-2026-10-21.log', 'bot.log']);
  day = new Date(2026, 9, 22, 1);
  f.write('c\n');                             // otro día: rota
  assert.ok(readdirSync(dir).includes('bot-2026-10-21-1.log'));
  assert.equal(readFileSync(join(dir, 'bot.log'), 'utf8'), 'c\n');
  f.write('d'.repeat(120) + '\n');
  f.write('e\n');
  assert.equal(readdirSync(dir).filter((x) => x !== 'bot.log').length, 2, 'keep = 2');
});
