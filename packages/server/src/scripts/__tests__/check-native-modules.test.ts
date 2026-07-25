import { describe, expect, it } from 'vitest';

import {
  NATIVE_MODULES,
  isDegradableNativeModuleFailure,
  isMissingDarwinX64OnnxBindingError,
  runNativeModulePreflight,
} from '../check-native-modules.js';

describe('native module preflight list', () => {
  it('includes onnxruntime-node so Windows VC runtime issues surface at startup', () => {
    expect(NATIVE_MODULES).toContain('onnxruntime-node');
  });

  it('returns success when all modules import', async () => {
    const lines: string[] = [];
    const ok = await runNativeModulePreflight({
      importer: async () => ({}),
      writeLine: (line) => lines.push(line),
    });

    expect(ok).toBe(true);
    expect(lines).toContain('DONE');
    expect(lines.some((line) => line.startsWith('FAIL:'))).toBe(false);
  });

  it('returns failure when a required module import fails', async () => {
    const lines: string[] = [];
    const ok = await runNativeModulePreflight({
      importer: async (moduleName) => {
        if (moduleName === 'audify') {
          throw new Error('GLIBCXX_3.4.32 not found');
        }
        return {};
      },
      writeLine: (line) => lines.push(line),
    });

    expect(ok).toBe(false);
    expect(lines).toContain('FAIL:audify:GLIBCXX_3.4.32 not found');
    expect(lines).toContain('DONE');
  });

  it('returns success when only a degradable module import fails', async () => {
    const lines: string[] = [];
    const ok = await runNativeModulePreflight({
      importer: async (moduleName) => {
        if (moduleName === 'node-datachannel') {
          throw new Error('optional realtime transport failed');
        }
        return {};
      },
      writeLine: (line) => lines.push(line),
    });

    expect(ok).toBe(true);
    expect(lines).toContain('FAIL:node-datachannel:optional realtime transport failed');
    expect(lines).toContain('DONE');
  });

  it('treats missing darwin/x64 onnxruntime binding as degradable', async () => {
    const missingBindingError = "Cannot find module '../bin/napi-v6/darwin/x64/onnxruntime_binding.node'";
    expect(isMissingDarwinX64OnnxBindingError(missingBindingError)).toBe(true);
    expect(isDegradableNativeModuleFailure('onnxruntime-node', missingBindingError)).toBe(true);
    expect(isDegradableNativeModuleFailure('onnxruntime-node', 'The specified module could not be found.')).toBe(false);

    const lines: string[] = [];
    const ok = await runNativeModulePreflight({
      importer: async (moduleName) => {
        if (moduleName === 'onnxruntime-node') {
          throw new Error(missingBindingError);
        }
        return {};
      },
      writeLine: (line) => lines.push(line),
    });

    expect(ok).toBe(true);
    expect(lines.some((line) => line.startsWith('FAIL:onnxruntime-node:'))).toBe(true);
  });

  it('keeps non-darwin onnxruntime failures blocking', async () => {
    const lines: string[] = [];
    const ok = await runNativeModulePreflight({
      importer: async (moduleName) => {
        if (moduleName === 'onnxruntime-node') {
          throw new Error('VCRUNTIME140.dll was not found');
        }
        return {};
      },
      writeLine: (line) => lines.push(line),
    });

    expect(ok).toBe(false);
  });
});
