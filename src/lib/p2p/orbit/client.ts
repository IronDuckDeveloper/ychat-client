import { createOrbitDB, Identities, useAccessController } from '@orbitdb/core';
import { HeliaIdentityProvider } from './identity.ts';
import { CONFIG } from '../config.ts';
import { RateLimitedAccessController } from './rateLimitedAccessController.ts';

// Регистрируем кастомный AccessController один раз при загрузке модуля —
// ДО первого orbitdb.open(). Без этого при открытии комнаты по уже
// существующему адресу orbitdb.js не сможет резолвить тип из манифеста
// (getAccessController(acType) бросит "not supported").
useAccessController(RateLimitedAccessController as any);

// Храним синглтон инстанса OrbitDB, чтобы не создавать его заново при смене комнат
let orbitdbInstance: any = null;

export async function getOrbitDB(helia: any) {
  if (orbitdbInstance) return orbitdbInstance;

  try {
    const peerIdString = helia.libp2p.peerId.toString();

    // Регистрируем провайдер напрямую в менеджере Identities
    const identities = await Identities({ 
      ipfs: helia,
      identities: {
        helia: HeliaIdentityProvider
      }
    });
    
    console.log(`🔑 [OrbitDB] Создаем Identity через Helia ключи для: ${peerIdString}`);

    const identity = await identities.createIdentity({
      id: peerIdString,
      type: 'helia',
      helia: helia
    });

    orbitdbInstance = await createOrbitDB({ 
      ipfs: helia,
      identity: identity, 
      directory: `${CONFIG.ORBITDB_DIR}/${peerIdString}`
    });

    return orbitdbInstance;
  } catch (error) {
    console.error('❌ [OrbitDB] Ошибка инициализации:', error);
    throw error;
  }
}
