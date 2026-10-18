/**
 * Structurally valid PNG, JPEG and WebP files for the logo metadata tests, with optional
 * metadata (text chunks, EXIF, XMP, comments) carrying a marker string to look for.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** A 1×1 PNG; `metadata` adds tEXt, iTXt, zTXt, eXIf and tIME chunks holding it. */
export function pngWith(metadata?: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  const extra = metadata
    ? [
        pngChunk('tEXt', Buffer.from(`Comment\0${metadata}`, 'latin1')),
        pngChunk('iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${metadata}`)),
        pngChunk('zTXt', Buffer.from(`Author\0\0${metadata}`, 'latin1')),
        pngChunk('eXIf', Buffer.from(`MM\0*${metadata}`, 'latin1')),
        pngChunk('tIME', Buffer.from([7, 234, 10, 18, 12, 0, 0])),
      ]
    : [];
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

/** A baseline JPEG; `metadata` adds APP1 EXIF and XMP, APP13 IPTC and a comment holding it. */
export function jpegWith(metadata?: string): Buffer {
  const app0 = jpegSegment(0xe0, Buffer.from([...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  const extra = metadata
    ? [
        jpegSegment(0xe1, Buffer.from(`Exif\0\0MM\0*${metadata}`, 'latin1')),
        jpegSegment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${metadata}`)),
        jpegSegment(0xed, Buffer.from(`Photoshop 3.0\0${metadata}`)),
        jpegSegment(0xfe, Buffer.from(metadata)),
      ]
    : [];
  const sof = jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
  const sos = jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    ...extra,
    sof,
    sos,
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), // scan data with a stuffed 0xFF
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** An extended WebP (VP8X); `metadata` adds EXIF and XMP chunks holding it and sets their flags. */
export function webpWith(metadata?: string): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUInt8(metadata ? 0x08 | 0x04 : 0, 0);
  const chunks = [
    webpChunk('VP8X', vp8x),
    webpChunk('VP8 ', Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 1, 0, 1, 0, 0])),
    ...(metadata
      ? [webpChunk('EXIF', Buffer.from(metadata)), webpChunk('XMP ', Buffer.from(metadata))]
      : []),
  ];
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
