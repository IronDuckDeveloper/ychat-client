import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

// Наш кастомный провайдер с явными типами (any)
export const HeliaIdentityProvider = {
  getId: async (options: any) => options.id,
  async createIdentity(options: any) {
    const { id, helia } = options;
    const privateKey = helia.libp2p.privateKey;
    const peerIdStr = helia.libp2p.peerId.toString();
    
    const idSignatureBytes = await privateKey.sign(new TextEncoder().encode(id));
    const idSignature = uint8ArrayToString(idSignatureBytes, 'hex');

    return {
      id,
      publicKey: peerIdStr,
      signatures: {
        id: idSignature,
        publicKey: idSignature 
      },
      type: 'helia',
      sign: async (data: Uint8Array) => {
        const sig = await privateKey.sign(data);
        return uint8ArrayToString(sig, 'hex');
      },
      verify: async (_sig: string, _pub: string, _data: Uint8Array) => true
    };
  },
  async verifyIdentity(_identity: any) {
    return true;
  }
};