function normalise(values: string[]) {
  return values
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0 && !["SERIAL", "SERIAL NUMBER", "SERIAL_NUMBER"].includes(value));
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read Excel files. Import the serial list as CSV instead.");
  }
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(file: Uint8Array, name: string) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let end = -1;
  for (let offset = file.length - 22; offset >= Math.max(0, file.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("The Excel file is not a valid .xlsx workbook.");
  let cursor = view.getUint32(end + 16, true);
  const entries = view.getUint16(end + 10, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("The Excel file is not a valid .xlsx workbook.");
    const compression = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const entryName = decoder.decode(file.slice(cursor + 46, cursor + 46 + fileNameLength));
    cursor += 46 + fileNameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("The Excel file is not a valid .xlsx workbook.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = file.slice(dataStart, dataStart + compressedSize);
    if (compression === 0) return compressed;
    if (compression === 8) return inflateRaw(compressed);
    throw new Error("The Excel file uses unsupported compression. Save it as CSV or a standard .xlsx file.");
  }
  return null;
}

function valueFromCell(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.textContent ?? "";
  const value = cell.querySelector("v")?.textContent ?? "";
  return type === "s" ? sharedStrings[Number(value)] ?? "" : value;
}

async function parseXlsx(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const [sharedXml, sheetXml] = await Promise.all([
    readZipEntry(bytes, "xl/sharedStrings.xml"),
    readZipEntry(bytes, "xl/worksheets/sheet1.xml"),
  ]);
  if (!sheetXml) throw new Error("The workbook has no first worksheet to import.");
  const parser = new DOMParser();
  const sharedStrings = sharedXml
    ? Array.from(parser.parseFromString(decoder.decode(sharedXml), "application/xml").querySelectorAll("si")).map((item) => item.textContent ?? "")
    : [];
  const sheet = parser.parseFromString(decoder.decode(sheetXml), "application/xml");
  const values = Array.from(sheet.querySelectorAll("row")).map((row) => {
    const firstCell = row.querySelector("c");
    return firstCell ? valueFromCell(firstCell, sharedStrings) : "";
  });
  return normalise(values);
}

export async function readSerialImport(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return parseXlsx(file);
  if (["csv", "txt"].includes(extension ?? "")) return normalise((await file.text()).split(/[\r\n,;\t]+/));
  throw new Error("Upload a CSV, TXT, or .xlsx Excel file containing one serial number per row.");
}

export function splitSerialInput(value: string) {
  return normalise(value.split(/[\r\n,;\t]+/));
}
