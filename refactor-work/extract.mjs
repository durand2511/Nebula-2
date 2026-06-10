const pg = await import('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js');
const fs = await import('node:fs');
const Client = pg.default?.Client || pg.Client;
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query("SELECT path, content FROM project_files WHERE project_id=97 ORDER BY path");
let total = 0;
for (const r of rows) {
  fs.writeFileSync('refactor-work/raw/' + r.path, r.content);
  total += r.content.length;
}
console.log('wrote', rows.length, 'files, total bytes', total);
await c.end();
