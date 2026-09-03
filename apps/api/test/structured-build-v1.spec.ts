import {
  candidateItemIdsV1,
  findConsensusCandidateV1,
  stableConsensusGroupIdV1,
} from '../src/statlocker-adaptive/structured-build-v1';
import { ConsensusSkeletonV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

describe('structured build v1', () => {
  it('creates a deterministic group id independent of candidate order', () => {
    expect(stableConsensusGroupIdV1(10, 'MID', 'CHOICE', [9, 4, 9]))
      .toBe('hero:10:MID:CHOICE:4,9');
  });

  it('supports required, choice and optional groups without flattening semantics', () => {
    const skeleton: ConsensusSkeletonV1 = {
      heroId: 10,
      profileCount: 8,
      groups: [
        {
          groupId: 'required',
          phase: 'EARLY',
          type: 'REQUIRED',
          minSelect: 1,
          maxSelect: 1,
          confidence: 0.9,
          inferred: false,
          candidates: [{
            itemId: 1,
            strength: 0.9,
            coverage: 0.9,
            purchaseRate: 0.9,
            medianBuyTimeS: 240,
            timingSpreadS: 20,
            sourceProfileCount: 8,
            frequencyTier: 'CORE',
            rushEvidence: false,
          }],
        },
        {
          groupId: 'choice',
          phase: 'MID',
          type: 'CHOICE',
          minSelect: 1,
          maxSelect: 1,
          confidence: 0.8,
          inferred: true,
          candidates: [2, 3].map((itemId) => ({
            itemId,
            strength: 0.7,
            coverage: 0.5,
            purchaseRate: 0.6,
            medianBuyTimeS: 800,
            timingSpreadS: 50,
            sourceProfileCount: 4,
            frequencyTier: 'FREQUENT' as const,
            rushEvidence: false,
          })),
        },
        {
          groupId: 'optional',
          phase: 'LATE',
          type: 'OPTIONAL',
          minSelect: 0,
          maxSelect: 1,
          confidence: 0.4,
          inferred: true,
          candidates: [{
            itemId: 4,
            strength: 0.35,
            coverage: 0.25,
            purchaseRate: 0.4,
            medianBuyTimeS: 1700,
            timingSpreadS: 100,
            sourceProfileCount: 2,
            frequencyTier: 'SOMETIMES',
            rushEvidence: false,
          }],
        },
      ],
    };

    expect(candidateItemIdsV1(skeleton.groups[1])).toEqual([2, 3]);
    expect(findConsensusCandidateV1(skeleton, 3)?.itemId).toBe(3);
  });
});
