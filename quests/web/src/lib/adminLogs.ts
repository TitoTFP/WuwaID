export function formatAdminLogBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=utf-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  try {
    return encoded ? decodeURIComponent(encoded) : plain || fallback;
  } catch {
    return fallback;
  }
}
