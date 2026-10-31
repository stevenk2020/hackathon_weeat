import { pool, query } from './db.mjs';
import { purgeTraces } from './askTrace.mjs';

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
try {
  if (option('--purge')) await purgeTraces(Math.max(1, Number(option('--purge')) || 30));
  const values = [];
  const where = [];
  if (option('--session')) { values.push(option('--session')); where.push(`session_id=$${values.length}`); }
  if (option('--user')) { values.push(Number(option('--user'))); where.push(`user_id=$${values.length}`); }
  if (argv.includes('--errors')) where.push(`status <> 'ok'`);
  values.push(Math.min(100, Math.max(1, Number(option('--n')) || 10)));
  const rows = await query(`SELECT * FROM public.weeat_ai_trace ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT $${values.length}`, values);
  if (argv.includes('--json')) console.log(JSON.stringify(rows.rows, null, 2));
  else for (const row of rows.rows) {
    console.log(`[${row.created_at.toISOString()}] ${row.status} user=${row.user_id} session=${row.session_id}`);
    console.log(`Q: ${row.user_message}\nA: ${row.answer || ''}`);
    console.log(`models=${row.models.join(',')} tokens=${row.prompt_tokens}+${row.completion_tokens} ms=${row.duration_ms}`);
    for (const step of row.steps || []) if (step.type === 'tool') console.log(`  ${step.name} ${JSON.stringify(step.args)} -> ${JSON.stringify(step.result)}`);
  }
} catch (error) { console.error('Ask log failed:', error.code || error.name); process.exitCode = 1; }
finally { await pool.end(); }
