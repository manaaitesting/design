/**
 * Bringing images in.
 *
 * Files become data URIs and travel inside the CRDT, so they sync to every
 * collaborator and survive a reload with no storage service and no upload
 * endpoint. The trade is document size, hence the ceiling — past it, a hosted
 * URL is the honest answer rather than a multi-megabyte paste everyone
 * downloads on connect.
 */
export const MAX_INLINE_BYTES = 1_500_000;

export interface LoadedImage {
  src: string;
  width: number;
  height: number;
  name: string;
}

export async function readImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name || 'That file'} is not an image.`);
  }
  if (file.size > MAX_INLINE_BYTES) {
    throw new Error(
      `${file.name || 'Image'} is ${(file.size / 1_000_000).toFixed(1)}MB — over the ${(MAX_INLINE_BYTES / 1_000_000).toFixed(1)}MB inline limit. Host it and paste the URL instead.`,
    );
  }

  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });

  const size = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 240, height: 160 });
    img.src = src;
  });

  return { src, ...size, name: file.name?.replace(/\.[^.]+$/, '') || 'Image' };
}

/** Scales an image down to fit comfortably on the canvas. */
export function fitOnCanvas(width: number, height: number, max = 480): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** Pulls image files out of a paste or drop, ignoring everything else. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file?.type.startsWith('image/')) files.push(file);
  }
  if (!files.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) files.push(file);
    }
  }
  return files;
}
