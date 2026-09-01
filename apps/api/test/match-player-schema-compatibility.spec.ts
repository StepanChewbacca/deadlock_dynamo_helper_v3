import { getMetadataArgsStorage } from 'typeorm';
import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';

describe('MatchPlayer production schema compatibility', () => {
  it('maps the match relation to the existing matchId column', () => {
    const joinColumn = getMetadataArgsStorage().joinColumns.find(
      (column) => column.target === MatchPlayer && column.propertyName === 'match',
    );

    expect(joinColumn?.name).toBe('matchId');
    expect(joinColumn?.referencedColumnName).toBe('matchId');
  });
});
