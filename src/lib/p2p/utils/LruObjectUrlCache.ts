/**
 * LRU-кэш для автоматического освобождения памяти Object URL.
 * Когда количество элементов превышает maxSize, самые старые URL автоматически
 * удаляются и очищаются из оперативной памяти через URL.revokeObjectURL.
 */
export class LruObjectUrlCache {
  private cache = new Map<string, string>();
  private readonly maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  get(key: string): string | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    // Перемещаем элемент в конец очереди (помечаем как недавно использованный)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item;
  }

  set(key: string, value: string): void {
    // Если ключ уже есть, очищаем старый URL перед перезаписью
    if (this.cache.has(key)) {
      const oldUrl = this.cache.get(key);
      if (oldUrl && oldUrl !== value) {
        URL.revokeObjectURL(oldUrl);
      }
      this.cache.delete(key);
    }

    this.cache.set(key, value);

    // Вытесняем самые старые элементы при превышении лимита
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const oldestUrl = this.cache.get(oldestKey);
        if (oldestUrl) {
          URL.revokeObjectURL(oldestUrl);
        }
        this.cache.delete(oldestKey);
      }
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    const url = this.cache.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      return this.cache.delete(key);
    }
    return false;
  }

  clear(): void {
    for (const url of this.cache.values()) {
      URL.revokeObjectURL(url);
    }
    this.cache.clear();
  }
}