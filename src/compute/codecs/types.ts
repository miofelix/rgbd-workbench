import type { NumericDataType } from "@/domain/codec-registry";
export interface RawDescriptor {
  shape: [number, number];
  dataType: NumericDataType;
  endianness: "little" | "big";
}
