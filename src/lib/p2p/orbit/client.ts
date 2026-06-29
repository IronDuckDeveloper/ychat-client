import { createOrbitDB, Identities } from '@orbitdb/core';
import { HeliaIdentityProvider } from './identity.ts';
import { CONFIG } from '../config.ts';

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