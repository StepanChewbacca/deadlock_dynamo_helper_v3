import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { AdaptiveRecommendationRequestV1, AdaptiveRecommendationResultV1 } from '@deadlock-live-probe/shared';
import { AdaptiveRecommendationV1Service } from './adaptive-recommendation-v1.service';
import { StatlockerEvidenceService } from './statlocker-evidence.service';
import { StatlockerRefreshService, StatlockerRefreshStatusV1 } from './statlocker-refresh.service';

export interface AdaptiveRecommendationStatusV1 {
  refresh: StatlockerRefreshStatusV1;
  rulesetVersion?: string;
  catalogSha256?: string;
  statlockerPatchId?: string;
  activeSnapshotIds: readonly string[];
  families: ReturnType<StatlockerEvidenceService['getLocalStatus']>['families'];
}

@Controller('deadlock/adaptive/v1')
export class AdaptiveRecommendationV1Controller {
  constructor(
    private readonly recommendation: AdaptiveRecommendationV1Service,
    private readonly refresh: StatlockerRefreshService,
    private readonly evidence: StatlockerEvidenceService,
  ) {}

  @Post('recommend')
  async recommend(@Body() body: AdaptiveRecommendationRequestV1): Promise<AdaptiveRecommendationResultV1> {
    if (!body || typeof body.matchId !== 'string' || body.matchId.trim() === '') {
      throw new BadRequestException('matchId is required');
    }
    if (body.localSteamId !== undefined && (typeof body.localSteamId !== 'string' || body.localSteamId.trim() === '')) {
      throw new BadRequestException('localSteamId is invalid');
    }
    return this.recommendation.recommend({
      matchId: body.matchId.trim(),
      localSteamId: body.localSteamId?.trim(),
    });
  }

  @Get('status')
  status(): AdaptiveRecommendationStatusV1 {
    const refresh = this.refresh.getStatus();
    const local = this.evidence.getLocalStatus(refresh.identity);
    return {
      refresh,
      rulesetVersion: refresh.identity?.rulesetVersion,
      catalogSha256: refresh.identity?.catalogSha256,
      statlockerPatchId: local.statlockerPatchId,
      activeSnapshotIds: local.activeSnapshotIds,
      families: local.families,
    };
  }
}
