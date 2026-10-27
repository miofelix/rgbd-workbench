import { Blob as NodeBlob, File as NodeFile } from "node:buffer";

// jsdom's Blob predates arrayBuffer/text and cannot clone fake-indexeddb's host Blob.
// Node's standards-based implementations preserve binary identity through structuredClone.
Object.defineProperty(globalThis, "Blob", { configurable: true, writable: true, value: NodeBlob });
Object.defineProperty(globalThis, "File", { configurable: true, writable: true, value: NodeFile });
