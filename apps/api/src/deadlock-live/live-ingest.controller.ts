import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OverwolfLiveBatchDto } from '@deadlock-live-probe/shared';
import { canonicalizeLiveBatchForStateV2 } from './canonical-live-batch';
import { InventoryShadowReplayService } from './inventory-shadow-replay.service';
import { LiveMatchStateService } from './live-match-state.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { RecommendationProspectiveCollectorV8Service } from './recommendation-prospective-collector-v8.service';

@Controller('deadlock/live')
export class LiveIngestController {
  constructor(
    private readonly rawEventLogService: RawEventLogService,
    private readonly liveMatchStateService: LiveMatchStateService,
    private readonly inventoryShadowReplayService: InventoryShadowReplayService,
    private readonly recentLiveEventsService: RecentLiveEventsService,
    private readonly prospectiveCollector: RecommendationProspectiveCollectorV8Service,
  ) {}

  @Post('events')
  async ingestEvents(@Body() batch: OverwolfLiveBatchDto): Promise<{ ok: true }> {
    await this.rawEventLogService.appendEvents(batch.events);
    this.recentLiveEventsService.append(batch.events);
    const stateBatch = canonicalizeLiveBatchForStateV2(batch);
    const state = this.liveMatchStateService.applyBatch(stateBatch);
    this.inventoryShadowReplayService.applyBatch(batch, state?.matchId);
    this.prospectiveCollector.observeBatch(batch, state);
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

  @Get('events/recent')
  getRecentEvents() {
    return this.recentLiveEventsService.getRecent();
  }
}
