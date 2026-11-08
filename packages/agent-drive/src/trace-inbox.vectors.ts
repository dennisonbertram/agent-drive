// Frozen trace inbox v1 / envelope v2 vectors. Permanent compatibility guards: never regenerate.
// Fixed IVs: inbox wrap iv = bytes 1..12, envelope iv = bytes 101..112.
export const vector = {
  driveKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  fileKey: '__79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA',
  driveId: '11111111-2222-4333-8444-555555555555',
  keyId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  inboxJwk: {
    kty: 'EC',
    crv: 'P-256',
    d: '_WFcut_0yRr3_eUBKdze7PxJlfOns5wxY3x15mbh2e8',
    x: '_z1rg-KbrsyVrPPUOn8zNoyqvfWkKXl-6beLwdj88-g',
    y: 'CF2_RS-AtuWbnen4rXjLW25TG5nGWsYpSHAr5dTHq14',
  },
  ephemeralJwk: {
    kty: 'EC',
    crv: 'P-256',
    d: 'I9qQNNpEgVw_5mU5M9ZoUlh1Narzcy6shCK6Qt_jzro',
    x: '5nFCpKgsedzqs9ota4v_1ZMqfjxZeGCXOC82vEEiNAI',
    y: 'ngf730xJH88N7zQa61AUtapb3E5WVFRGie712Xlbmc0',
  },
  inboxIv: Uint8Array.from({ length: 12 }, (_, i) => i + 1),
  envelopeIv: Uint8Array.from({ length: 12 }, (_, i) => i + 101),
  publicKey:
    'BP89a4Pim67Mlazz1Dp_MzaMqr31pCl5fum3i8HY_PPoCF2_RS-AtuWbnen4rXjLW25TG5nGWsYpSHAr5dTHq14',
  wrappedPrivateKey:
    'AQECAwQFBgcICQoLDDVr3dftlMCVSqVJwVjd1ypDRenUESWe-KJe_iDzhh3HheWf_5PUsCVvWHP_MiYdXLcqkQwo0KOCkc6Q_Ax9QeoRnNLMHrVeoksWT0eQu-E8c_ylhBH9xL9JoBqhnQuECu64hco0hdaZBj6ZeBSzN0wuYbxFOIE8Frh2n5WnCOtuxk5K1cE8oPdB9mteEp5U64DBzZdglKlNc5U',
  envelope:
    'AgTmcUKkqCx53Oqz2i1ri__Vkyp-PFl4YJc4Lza8QSI0Ap4H-99MSR_PDe80GutQFLWqW9xOVlRURonu9dl5W5nNZWZnaGlqa2xtbm9w5X2e5aUA0LVELHfBm2lAap4P_ODHPWJluf5XjA2YRDyN4tz0IJSXr2144bHaKSikk9DYdz-ubXnSCdQ',
};
