const onePixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export async function pngOf(w: number, h: number): Promise<Uint8Array> {
  return new Bun.Image(onePixel).resize(w, h).png().bytes();
}

export async function jpegOf(w: number, h: number): Promise<Uint8Array> {
  return new Bun.Image(onePixel).resize(w, h).jpeg({ quality: 90 }).bytes();
}

export async function webpOf(w: number, h: number): Promise<Uint8Array> {
  return new Bun.Image(onePixel).resize(w, h).webp({ quality: 90 }).bytes();
}

export const gpsMark = "GPSLatitude 48.8584 N";

export async function jpegWithGps(w: number, h: number): Promise<Uint8Array> {
  const jpeg = Buffer.from(await jpegOf(w, h));
  const body = Buffer.from(`Exif\0\0${gpsMark}`, "latin1");

  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);

  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
  return new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]));
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const named = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Bun.hash.crc32(named));

  return Buffer.concat([length, named, crc]);
}

export function pngHeaderOnly(w: number, h: number): Uint8Array {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 6, 0, 0, 0], 8);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk("IHDR", head),
      chunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
