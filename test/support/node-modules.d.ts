// The AVIF test loads the encoder from node_modules, so it needs three Node
// built-ins. The extension targets the browser and tsconfig limits `types` to
// @webgpu/types, so @types/node is not on the type path; declaring just what
// the test calls keeps Node's globals (and its setTimeout typing) out of the
// extension's source.

declare module "fs/promises" {
  export function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
}

declare module "path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module "url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
