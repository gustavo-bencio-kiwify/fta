import "exceljs";

declare module "exceljs" {
  interface Xlsx {
    // ExcelJS aceita Buffer/Uint8Array/ArrayBuffer na prática,
    // mas os tipos podem estar restritos em algumas versões
    load(data: Buffer | Uint8Array | ArrayBuffer): Promise<unknown>;
  }
}
