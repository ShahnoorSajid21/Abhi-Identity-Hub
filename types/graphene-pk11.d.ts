/**
 * Minimal ambient declaration for graphene-pk11.
 *
 * The real package depends on pkcs11js, a NATIVE module requiring node-gyp and
 * a C++ toolchain — which is precisely why the HSM adapter cannot be verified
 * on a machine without one.
 *
 * IMPORTANT — what this file does and does not prove. It lets tsc check the
 * INTERNAL consistency of pkcs11-hsm.ts: control flow, our own types, the Hsm
 * port contract. It does NOT validate our usage against graphene's real API,
 * because these signatures are written by us. Only installing the real package
 * on a machine with build tools does that. Do not read a green typecheck here
 * as "the HSM integration is correct".
 */
declare module 'graphene-pk11' {
  export enum ObjectClass { SECRET_KEY = 4 }
  export enum SessionFlag { SERIAL_SESSION = 4, RW_SESSION = 2 }
  export enum UserType { USER = 1 }
  export enum KeyGenMechanism { AES = 0x1080 }
  export enum KeyType { AES = 0x1f }

  export class AesGcmParams {
    constructor(iv: Buffer, aad?: Buffer, tagBits?: number);
  }

  export interface Key {
    getAttribute(template: Record<string, unknown>): Record<string, unknown> & {
      extractable?: boolean;
      value?: Buffer;
    };
  }

  export interface Cipher { once(data: Buffer): Buffer }
  export interface Sign { once(data: Buffer): Buffer }

  export interface SearchResult {
    length: number;
    items(index: number): { toType<T>(): T };
  }

  export interface Session {
    login(pin: string, userType: UserType): void;
    logout(): void;
    close(): void;
    find(template: Record<string, unknown>): SearchResult;
    generateKey(mech: KeyGenMechanism, template: Record<string, unknown>): Key;
    generateRandom(size: number): Buffer;
    createSign(mech: string, key: Key): Sign;
    createCipher(mech: { name: string; params: AesGcmParams }, key: Key): Cipher;
    createDecipher(mech: { name: string; params: AesGcmParams }, key: Key): Cipher;
  }

  export interface Slot { open(flags: number): Session }

  export class Module {
    static load(path: string, name: string): Module;
    initialize(): void;
    finalize(): void;
    getSlots(index: number): Slot;
  }
}
