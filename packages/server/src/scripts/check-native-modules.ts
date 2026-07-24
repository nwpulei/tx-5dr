import { pathToFileURL } from 'node:url';

/**
 * Native module diagnostic script — runs as an isolated child process.
 *
 * Sequentially attempts to import each native module used by the server.
 * The parent process (electron-main) reads stdout line-by-line to determine
 * which modules loaded and which failed or crashed the process.
 *
 * Protocol (one line per event, flushed immediately):
 *   CHECKING:<module>   — about to load <module>
 *   OK:<module>         — import succeeded
 *   FAIL:<module>:<msg> — import threw a JS error (process still alive)
 *   DONE               — all checks finished
 *
 * If the process dies between CHECKING:X and the corresponding OK/FAIL,
 * module X caused a fatal crash (e.g. native binding segfault).
 */

export const NATIVE_MODULES = [
  'audify',
  'serialport',
  'bcrypt',
  'node-datachannel',
  'rubato-fft-node',
  'hamlib',
  'icom-wlan-node',
  'node-wav',
  'onnxruntime-node',
  'wsjtx-lib',
];

export const DEGRADABLE_NATIVE_MODULES = new Set([
  'node-datachannel',
]);

/**
 * Upstream onnxruntime-node stopped shipping macOS Intel (darwin/x64) prebuilds
 * after 1.23.2. Treat that specific missing-binding failure as degradable so the
 * rest of the app can still start; DeepCW simply reports unavailable.
 * Other onnxruntime load failures (e.g. Windows VC runtime) remain blocking.
 */
export function isMissingDarwinX64OnnxBindingError(message: string): boolean {
  return /darwin[/\\]x64[/\\]onnxruntime_binding\.node/.test(message);
}

export function isDegradableNativeModuleFailure(moduleName: string, errorMessage?: string): boolean {
  if (DEGRADABLE_NATIVE_MODULES.has(moduleName)) {
    return true;
  }
  return moduleName === 'onnxruntime-node'
    && typeof errorMessage === 'string'
    && isMissingDarwinX64OnnxBindingError(errorMessage);
}

export type NativeModuleImporter = (moduleName: string) => Promise<unknown>;
export type NativeModuleLineWriter = (line: string) => void;

function defaultWriteLine(line: string): void {
  process.stdout.write(line + '\n');
}

export async function runNativeModulePreflight({
  importer = (moduleName: string) => import(moduleName),
  writeLine = defaultWriteLine,
}: {
  importer?: NativeModuleImporter;
  writeLine?: NativeModuleLineWriter;
} = {}): Promise<boolean> {
  let blockingFailure = false;

  for (const mod of NATIVE_MODULES) {
    writeLine(`CHECKING:${mod}`);
    try {
      await importer(mod);
      writeLine(`OK:${mod}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isDegradableNativeModuleFailure(mod, msg)) {
        blockingFailure = true;
      }
      // Keep message on a single line so the parent parser stays simple
      writeLine(`FAIL:${mod}:${msg.replace(/\n/g, ' ')}`);
    }
  }
  writeLine('DONE');
  return !blockingFailure;
}

export async function main(): Promise<number> {
  const allOk = await runNativeModulePreflight();
  return allOk ? 0 : 1;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((err) => {
    defaultWriteLine(`ERROR:${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
