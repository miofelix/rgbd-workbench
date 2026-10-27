/** Copy a typed-array view into a standalone, transferable ArrayBuffer. */
export function asArrayBuffer(data: ArrayBufferView): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Read a Blob without relying on Response's incomplete jsdom implementation. */
export async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Blob read failed"));
      reader.onload = () => {
        if (!(reader.result instanceof ArrayBuffer)) reject(new Error("Blob result is not binary"));
        else resolve(reader.result);
      };
      reader.readAsArrayBuffer(blob);
    });
  }
  throw new Error("This environment cannot read Blob bytes");
}
