// Hot reload: tsc em watch + node --watch no build incremental.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const isWin = process.platform === 'win32';
const tsc = spawn(isWin ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
  stdio: 'inherit',
  shell: isWin,
});

let app;
const startApp = () => {
  if (app || !existsSync('dist/main.js')) return;
  app = spawn(process.execPath, ['--enable-source-maps', '--watch', 'dist/main.js'], { stdio: 'inherit' });
};
const timer = setInterval(() => {
  startApp();
  if (app) clearInterval(timer);
}, 1000);

const stop = () => {
  tsc.kill();
  app?.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
