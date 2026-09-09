export interface StatlockerHeroPoolEntryV1 {
  heroId: number;
  name: string;
}

export const STATLOCKER_HERO_POOL_V1: readonly StatlockerHeroPoolEntryV1[] = [
  { heroId: 1, name: 'Infernus' },
  { heroId: 2, name: 'Seven' },
  { heroId: 3, name: 'Vindicta' },
  { heroId: 4, name: 'Lady Geist' },
  { heroId: 6, name: 'Abrams' },
  { heroId: 7, name: 'Wraith' },
  { heroId: 8, name: 'McGinnis' },
  { heroId: 10, name: 'Paradox' },
  { heroId: 11, name: 'Dynamo' },
  { heroId: 12, name: 'Kelvin' },
  { heroId: 13, name: 'Haze' },
  { heroId: 14, name: 'Holliday' },
  { heroId: 15, name: 'Bebop' },
  { heroId: 16, name: 'Calico' },
  { heroId: 17, name: 'Grey Talon' },
  { heroId: 18, name: 'Mo & Krill' },
  { heroId: 19, name: 'Shiv' },
  { heroId: 20, name: 'Ivy' },
  { heroId: 25, name: 'Warden' },
  { heroId: 27, name: 'Yamato' },
  { heroId: 31, name: 'Lash' },
  { heroId: 35, name: 'Viscous' },
  { heroId: 50, name: 'Pocket' },
  { heroId: 52, name: 'Mirage' },
  { heroId: 58, name: 'Vyper' },
  { heroId: 60, name: 'Sinclair' },
  { heroId: 63, name: 'Mina' },
  { heroId: 64, name: 'Drifter' },
  { heroId: 65, name: 'Venator' },
  { heroId: 66, name: 'Victor' },
  { heroId: 67, name: 'Paige' },
  { heroId: 69, name: 'The Doorman' },
  { heroId: 72, name: 'Billy' },
  { heroId: 76, name: 'Graves' },
  { heroId: 77, name: 'Apollo' },
  { heroId: 79, name: 'Rem' },
  { heroId: 80, name: 'Silver' },
  { heroId: 81, name: 'Celeste' },
] as const;

export const STATLOCKER_HERO_IDS_V1: readonly number[] = STATLOCKER_HERO_POOL_V1.map(
  (hero) => hero.heroId,
);
