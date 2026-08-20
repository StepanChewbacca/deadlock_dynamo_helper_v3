import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  RecommendationDecisionTelemetryService,
  RecommendationExposureSurface,
} from './recommendation-decision-telemetry.service';

export class RecordRecommendationMatchOutcomeDto {
  matchId!: string;
  steamId!: string;
  heroId!: number;
  teamId?: number;
  playerWon!: boolean;
}

export class RecordRecommendationExposureDto {
  decisionId!: string;
  matchId!: string;
  steamId!: string;
  exposedActionKeys!: string[];
  acknowledgedAtMs!: number;
  surface!: RecommendationExposureSurface;
}

@Controller('deadlock/analysis/recommendation-telemetry')
export class RecommendationDecisionTelemetryController {
  constructor(
    private readonly telemetryService:
      RecommendationDecisionTelemetryService,
  ) {}

  @Get('status')
  getStatus() {
    return this.telemetryService.getStatus();
  }

  @Post('exposure')
  @HttpCode(200)
  recordExposure(@Body() dto: RecordRecommendationExposureDto) {
    validateExposureRequest(dto);
    try {
      const recorded = this.telemetryService.recordDecisionExposure({
        decisionId: dto.decisionId.trim(),
        matchId: dto.matchId.trim(),
        steamId: dto.steamId.trim(),
        exposedActionKeys: dto.exposedActionKeys,
        acknowledgedAtMs: dto.acknowledgedAtMs,
        surface: dto.surface,
      });
      return {
        recorded,
        status: this.telemetryService.getStatus(),
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  @Post('outcome')
  @HttpCode(200)
  recordOutcome(@Body() dto: RecordRecommendationMatchOutcomeDto) {
    validateOutcomeRequest(dto);
    const recorded = this.telemetryService.recordMatchOutcome({
      matchId: dto.matchId.trim(),
      steamId: dto.steamId.trim(),
      heroId: dto.heroId,
      teamId: dto.teamId,
      playerWon: dto.playerWon,
      source: 'MANUAL',
    });
    return {
      recorded,
      status: this.telemetryService.getStatus(),
    };
  }
}

function validateExposureRequest(dto: RecordRecommendationExposureDto): void {
  if (typeof dto?.decisionId !== 'string' || !dto.decisionId.trim()) {
    throw new BadRequestException('decisionId must be a non-empty string.');
  }
  if (typeof dto.matchId !== 'string' || !dto.matchId.trim()) {
    throw new BadRequestException('matchId must be a non-empty string.');
  }
  if (typeof dto.steamId !== 'string' || !dto.steamId.trim()) {
    throw new BadRequestException('steamId must be a non-empty string.');
  }
  if (
    !Array.isArray(dto.exposedActionKeys) ||
    dto.exposedActionKeys.length === 0 ||
    dto.exposedActionKeys.some(
      (actionKey) => typeof actionKey !== 'string' || !actionKey.trim(),
    )
  ) {
    throw new BadRequestException(
      'exposedActionKeys must contain at least one non-empty action key.',
    );
  }
  if (
    !Number.isSafeInteger(dto.acknowledgedAtMs) ||
    dto.acknowledgedAtMs < 0
  ) {
    throw new BadRequestException(
      'acknowledgedAtMs must be a non-negative safe integer.',
    );
  }
  if (dto.surface !== 'IN_GAME' && dto.surface !== 'DESKTOP') {
    throw new BadRequestException('surface must be IN_GAME or DESKTOP.');
  }
}

function validateOutcomeRequest(
  dto: RecordRecommendationMatchOutcomeDto,
): void {
  if (typeof dto?.matchId !== 'string' || !dto.matchId.trim()) {
    throw new BadRequestException('matchId must be a non-empty string.');
  }
  if (typeof dto.steamId !== 'string' || !dto.steamId.trim()) {
    throw new BadRequestException('steamId must be a non-empty string.');
  }
  if (!Number.isSafeInteger(dto.heroId) || dto.heroId <= 0) {
    throw new BadRequestException(
      'heroId must be a positive safe integer.',
    );
  }
  if (
    dto.teamId !== undefined &&
    (!Number.isSafeInteger(dto.teamId) || dto.teamId < 0)
  ) {
    throw new BadRequestException(
      'teamId must be a non-negative safe integer.',
    );
  }
  if (typeof dto.playerWon !== 'boolean') {
    throw new BadRequestException('playerWon must be a boolean.');
  }
}
