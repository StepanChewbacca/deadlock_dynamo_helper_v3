import { Injectable } from '@nestjs/common';
import {
  PlayerStateEventV8,
  RecommendationTelemetryEventType,
  RecommendationTelemetryEnvelopeV8,
} from '@deadlock-live-probe/shared';
import { RecommendationTelemetryStoreService } from './recommendation-telemetry-store.service';
import { SoulsAffordabilityEvidenceV2Service } from './souls-affordability-evidence-v2.service';

@Injectable()
export class RecommendationTelemetryIngestV8Service {
  constructor(
    private readonly telemetryStore: RecommendationTelemetryStoreService,
    private readonly soulsEvidence: SoulsAffordabilityEvidenceV2Service,
  ) {}

  async appendExternal(
    event: RecommendationTelemetryEnvelopeV8<RecommendationTelemetryEventType, unknown>,
  ) {
    if (event.eventType === 'RECOMMENDATION_DECISION' || event.eventType === 'RECOMMENDATION_RUNTIME_HEALTH') {
      await this.telemetryStore.reject(event as never, ['SERVER_OWNED_EVENT_TYPE']);
      throw new Error(`External ${event.eventType} events are forbidden; this telemetry is server-owned`);
    }
    if (event.eventType !== 'PLAYER_STATE') {
      return this.telemetryStore.append(event as never);
    }
    const playerState = event as PlayerStateEventV8;
    if (playerState.payload?.spendableSoulsVerified !== undefined) {
      await this.telemetryStore.reject(playerState, ['EXTERNAL_SPENDABLE_SOULS_VERIFICATION_FORBIDDEN']);
      throw new Error('External PLAYER_STATE events must not self-assert spendableSoulsVerified');
    }
    const verifiedEvent = await this.applyServerWalletVerification(playerState);
    return this.telemetryStore.append(verifiedEvent);
  }

  async appendInternal(
    event: RecommendationTelemetryEnvelopeV8<RecommendationTelemetryEventType, unknown>,
  ) {
    return this.telemetryStore.append(event as never);
  }

  private async applyServerWalletVerification(event: PlayerStateEventV8): Promise<PlayerStateEventV8> {
    if (event.payload?.soulsRaw === undefined) return event;
    const evidenceReport = await this.soulsEvidence.report();
    if (!evidenceReport.canMarkSpendableSoulsVerified) return event;
    return {
      ...event,
      payload: {
        ...event.payload,
        spendableSoulsVerified: {
          value: event.payload.soulsRaw,
          verificationContractVersion: `${evidenceReport.contractVersion}:PASS`,
        },
      },
    };
  }
}
