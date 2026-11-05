import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Verifiers receive a copy, never permission to mutate the saved candidate. */
export async function copyVerificationTree(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async file => {
      if (path.relative(source, file).split(path.sep).includes('.git')) return false;
      if ((await fs.lstat(file)).isSymbolicLink()) throw Error('Verification copy refuses filesystem links');
      return true;
    },
  });
  return destination;
}

export async function assertVerificationInputsUnchanged(source, copy, files) {
  const fingerprint = async file => {
    const stat = await fs.lstat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Verification changed an input file type');
    return createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  };
  for (const file of files) {
    if ((await fingerprint(path.join(source, file))) !== (await fingerprint(path.join(copy, file))))
      throw Error('Verification mutated a candidate input: ' + file);
  }
}

/** Redaction happens before this function; excerpts disclose every omitted character. */
export function diagnosticExcerpt(text, limit = 20000) {
  if (text.length <= limit) return { text, truncated: false, totalCharacters: text.length, omittedCharacters: 0 };
  const half = Math.floor(limit / 2);
  return {
    text: text.slice(0, half) + '\n[... middle omitted; see full diagnostic file ...]\n' + text.slice(-half),
    truncated: true,
    totalCharacters: text.length,
    omittedCharacters: text.length - 2 * half,
  };
}
