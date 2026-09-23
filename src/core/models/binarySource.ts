/**
 * Read-only access to the original file bytes. A browser `File`/`Blob`
 * satisfies this structurally, so the core never depends on DOM types.
 */
export interface BinarySource {
  readonly size: number;
  readonly type: string;
  readonly name?: string;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
