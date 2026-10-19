import { test, expect } from 'vitest';
import { createDb } from './harness';
test('migrations aplicam', async () => { const db = await createDb(); expect((await db.query('select 1 as x')).rows).toEqual([{ x: 1 }]); }, 120000);
