import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Copy only explicitly selected, screened inputs; live sources remain outside the review root. */
export async function snapshotReviewInputs(spec, config, { readSource, readImage, hash }) {
  const originalRoot = await fs.realpath(spec.root);
  const files = [];
  for (const relative of spec.files) {
    const source = await readSource(originalRoot, relative, config.blockedLiterals ?? []);
    files.push({ path: relative, bytes: Buffer.from(source.content), sha256: source.sha256 });
  }
  for (const relative of spec.images ?? []) {
    const image = await readImage(originalRoot, relative);
    const bytes = await fs.readFile(path.resolve(originalRoot, relative));
    if (hash(bytes) !== image.sha256) throw Error('Image changed during snapshot');
    files.push({ path: relative, bytes, sha256: image.sha256 });
  }
  const root = path.join(path.resolve(config.stateRoot), 'review-inputs', spec.id, randomUUID());
  await fs.mkdir(root, { recursive: true });
  for (const file of files) {
    const destination = path.resolve(root, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.bytes, { flag: 'wx' });
  }
  return { root, originalRootHash: hash(originalRoot) };
}
