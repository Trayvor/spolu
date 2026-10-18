import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software authenticator for server tests of passkeys (ADR 0050): makes real ES256 key pairs,
 * attestation objects (`none`) and signed assertions, so the server's WebAuthn library checks
 * them exactly as a browser's. The e2e test uses Chromium's virtual authenticator instead.
 */

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

export type SoftPasskey = {
  id: string;
  userHandle: string;
  rpId: string;
  privateKey: KeyObject;
  counter: number;
};

const sha256 = (data: Uint8Array | string) =>
  new Uint8Array(createHash('sha256').update(data).digest());
const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(bytes));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function uint32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function clientData(type: string, challenge: string, origin: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

export type CeremonyOptions = {
  /** The page's origin the browser would put in clientDataJSON. */
  origin?: string;
  /** The RP ID whose hash goes into authenticatorData. */
  rpId?: string;
  /** User verified (the UV flag); default true. */
  userVerified?: boolean;
};

/** `navigator.credentials.create()`: a new discoverable ES256 passkey for the options. */
export function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
  {
    origin = 'http://localhost:3000',
    rpId = options.rp.id ?? 'localhost',
    userVerified = true,
  }: CeremonyOptions = {},
): { response: RegistrationResponseJSON; passkey: SoftPasskey } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]),
  );
  const credentialId = new Uint8Array(randomBytes(16));
  const flags = UP | (userVerified ? UV : 0) | BE | BS | AT;
  const authData = concat(
    sha256(rpId),
    new Uint8Array([flags]),
    uint32(0),
    new Uint8Array(16), // aaguid
    new Uint8Array([0, credentialId.length]),
    credentialId,
    cose,
  );
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]) as Parameters<typeof isoCBOR.encode>[0],
  );
  const id = b64(credentialId);
  return {
    response: {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    },
    passkey: { id, userHandle: options.user.id, rpId, privateKey, counter: 0 },
  };
}

/**
 * `navigator.credentials.get()` with `passkey`: a signed assertion for the options. `counter`
 * sets the signature counter sent (default: the passkey's, unchanged, as synced passkeys do).
 */
export function signInWithPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  passkey: SoftPasskey,
  {
    origin = 'http://localhost:3000',
    rpId = passkey.rpId,
    userVerified = true,
    counter = passkey.counter,
    userHandle = passkey.userHandle,
  }: CeremonyOptions & { counter?: number; userHandle?: string } = {},
): AuthenticationResponseJSON {
  const flags = UP | (userVerified ? UV : 0) | BE | BS;
  const authData = concat(sha256(rpId), new Uint8Array([flags]), uint32(counter));
  const data = clientData('webauthn.get', options.challenge, origin);
  const signature = sign('sha256', concat(authData, sha256(data)), passkey.privateKey);
  return {
    id: passkey.id,
    rawId: passkey.id,
    type: 'public-key',
    response: {
      clientDataJSON: b64(data),
      authenticatorData: b64(authData),
      signature: b64(new Uint8Array(signature)),
      userHandle,
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}
