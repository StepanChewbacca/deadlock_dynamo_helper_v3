import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OverwolfLiveBatchDto } from '@deadlock-live-probe/shared';
import { canonicalizeLiveBatchForStateV2 } from './canonical-live-batch';
import { InventoryShadowReplayService } from './inventory-shadow-replay.service';
import { LiveBuildRecommendationTraversalService } from './live-build-recommendation-traversal.service';
import { LiveInventoryEventNormalizerService } from './live-inventory-event-normalizer.service';
import { LiveMatchStateService } from './live-match-state.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';

@Controller('deadlock/live')
export class LiveIngestController {
  constructor(
    private readonly rawEventLogService: RawEventLogService,
    private readonly liveMatchStateService: LiveMatchStateService,
    private readonly inventoryShadowReplayService: InventoryShadowReplayService,
    private readonly recentLiveEventsService: RecentLiveEventsService,
    private readonly liveBuildRecommendationTraversalService:
      LiveBuildRecommendationTraversalService,
    private readonly liveInventoryEventNormalizerService:
      LiveInventoryEventNormalizerService,
  ) {}

  @Post('events')
  async ingestEvents(@Body() batch: OverwolfLiveBatchDto): Promise<{ ok: true }> {
    this.recentLiveEventsService.append(batch.events);
    const normalizedBatch = this.liveInventoryEventNormalizerService.normalizeBatch(batch);
    const stateBatch = canonicalizeLiveBatchForStateV2(normalizedBatch);
    const state = this.liveMatchStateService.applyBatch(stateBatch);
    this.inventoryShadowReplayService.applyBatch(normalizedBatch, state?.matchId);
    this.liveBuildRecommendationTraversalService.observeState(state);
    await this.rawEventLogService.appendEvents(batch.events);
    return { ok: true };
  }

  @Get('states')
  getStates() {
    return this.liveMatchStateService.getAllStates();
  }

  @Get('matches/:matchId/state')
  getState(@Param('matchId') matchId: string) {
    return this.liveMatchStateService.getState(matchId);
  }

  @Get('matches/:matchId/inventory-shadow')
  getInventoryShadow(@Param('matchId') matchId: string) {
    return this.inventoryShadowReplayService.getMatchTimelines(matchId);
  }

  @Get('matches/:matchId/inventory-shadow/:steamId')
  getPlayerInventoryShadow(
    @Param('matchId') matchId: string,
    @Param('steamId') steamId: string,
  ) {
    return this.inventoryShadowReplayService.getPlayerTimeline(matchId, steamId);
  }

  @Get('matches/:matchId/build-recommendation')
  getLiveBuildRecommendation(@Param('matchId') matchId: string) {
    return this.liveBuildRecommendationTraversalService.getMatchSnapshot(matchId);
  }

  @Get('build-recommendations/status')
  getLiveBuildRecommendationStatus() {
    return this.liveBuildRecommendationTraversalService.getStatus();
  }

  @Get('build-recommendations')
  getLiveBuildRecommendations() {
    return this.liveBuildRecommendationTraversalService.getAllSnapshots();
  }

  @Get('events/recent')
  getRecentEvents() {
    return this.recentLiveEventsService.getRecent();
  }
}
