import { Body, Controller, Post } from '@nestjs/common';
import {
  InventorySnapshotEventV8,
  PlayerStateEventV8,
  RecommendationDecisionEventV8,
  RecommendationExposureAckEventV8,
  RecommendationOutcomeEventV8,
} from '@deadlock-live-probe/shared';
import { RecommendationTelemetryStoreService } from './recommendation-telemetry-store.service';

type RecommendationTelemetryInputV8 =
  | PlayerStateEventV8
  | InventorySnapshotEventV8
  | RecommendationDecisionEventV8
  | RecommendationExposureAckEventV8
  | RecommendationOutcomeEventV8;

@Controller('deadlock-live/recommendation-telemetry/v8')
export class RecommendationTelemetryController {
  constructor(private readonly store: RecommendationTelemetryStoreService) {}

  @Post()
  append(@Body() event: RecommendationTelemetryInputV8) {
    return this.store.append(event);
  }
}
