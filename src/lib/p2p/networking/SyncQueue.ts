// src/networking/SyncQueue.ts
import { syncContactHistory } from "../services/contactsService";

export class P2PSyncQueue {
  private queue: { contact: any; contactsDb: any }[] = [];
  private activeCount = 0;
  // Сет для отслеживания контактов, которые УЖЕ в очереди или обрабатываются
  private pendingIds = new Set<string>(); 
  private readonly CONCURRENCY_LIMIT = 3;

  constructor() {}

  add(contact: any, contactsDb: any) {
    // 1. ПРОВЕРКА: Если этот контакт уже в очереди, просто игнорируем запрос
    if (this.pendingIds.has(contact.id)) {
      console.log(`⏳ [Queue] Контакт ${contact.nickname || contact.id} уже в очереди, пропускаем.`);
      return;
    }

    // 2. Добавляем в Set
    this.pendingIds.add(contact.id);
    this.queue.push({ contact, contactsDb });
    this.processNext();
  }

  private async processNext() {
    if (this.activeCount >= this.CONCURRENCY_LIMIT || this.queue.length === 0) return;

    this.activeCount++;
    const item = this.queue.shift();
    if (!item) return;

    try {
      await syncContactHistory(item.contact, item.contactsDb);
    } catch (err) {
      console.error(`❌ Ошибка очереди для ${item.contact?.nickname}:`, err);
    } finally {
      // 3. Важно: удаляем из Set ТОЛЬКО ПОСЛЕ завершения работы
      this.pendingIds.delete(item.contact.id);
      this.activeCount--;
      this.processNext(); 
    }
  }
}

export const globalSyncQueue = new P2PSyncQueue();