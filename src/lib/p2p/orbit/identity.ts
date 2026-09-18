import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { peerIdFromString } from '@libp2p/peer-id';
import { unmarshalPublicKey } from '@libp2p/crypto/keys';

const type = 'helia';

const verifyIdentity = async (identity: any) => {
  try {
    const peerId = peerIdFromString(identity.id);
    if (!peerId.publicKey) return false;

    const publicKey = unmarshalPublicKey(peerId.publicKey);

    // publicKey (внутренний, secp256k1) + signatures.id (его подпись) — конкатенация строк
    const dataString = identity.publicKey + identity.signatures.id;
    const dataBytes = new TextEncoder().encode(dataString);

    const sigBytes = Uint8Array.from(
      identity.signatures.publicKey.match(/.{1,2}/g).map((b: string) => parseInt(b, 16))
    );

    const result = await publicKey.verify(dataBytes, sigBytes);
    return result;
  } catch (err) {
    console.warn('⚠️ [HeliaIdentityProvider] Ошибка верификации (не блокирует):', err);
    return false;
  }
};

export const HeliaIdentityProvider = ({ helia, privateKey }: { helia: any; privateKey: any }) => async () => {
  const peerIdStr = helia.libp2p.peerId.toString();

  // Детерминировано из seed — всегда один и тот же id при том же сиде,
  // на любом устройстве, в любой вкладке, без всякого локального кэша.
  const getId = async () => peerIdStr;

  const signIdentity = async (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const sig = await privateKey.sign(bytes);
    return uint8ArrayToString(sig, 'hex');
  };

  return { type, getId, signIdentity };
};

(HeliaIdentityProvider as any).verifyIdentity = verifyIdentity;
(HeliaIdentityProvider as any).type = type;