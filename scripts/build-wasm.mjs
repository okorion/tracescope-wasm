import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const cargoBin = path.join(homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: `${cargoBin}${path.delimiter}${process.env.PATH || ''}` };
const executable = process.platform === 'win32' ? 'wasm-pack.exe' : 'wasm-pack';
// npm wasm-pack installs a native binary; invoking it directly keeps spaces in paths safe.
const local = path.resolve('node_modules/wasm-pack', 'binary', executable);
const program = existsSync(local) ? local : executable;
const result = spawnSync(program, ['build', 'engine', '--target', 'web', '--out-dir', '../web/pkg', '--out-name', 'tracescope_engine', '--release'], {stdio: 'inherit', env});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
