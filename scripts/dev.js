// Sobe API (com reload) e Vite juntos em modo de desenvolvimento.
import { spawn } from 'node:child_process';

const procs = [
  ['api', process.execPath, ['--watch-path=server', 'server/index.js']],
  ['web', process.execPath, ['node_modules/vite/bin/vite.js']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const prefix = name === 'api' ? '\x1b[36m[api]\x1b[0m ' : '\x1b[35m[web]\x1b[0m ';
  const pipe = (stream, out) => stream.on('data', (d) => out.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}encerrado (${code}).`);
    shutdown(code ?? 0);
  });
  return p;
});

function shutdown(code) {
  for (const p of procs) if (!p.killed) p.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
